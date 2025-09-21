import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MotionPlayer } from './motionPlayer.js';

// import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

function frameOrthoIsometric ( cam, ctrls, root, margin = 1.15 ) {

  /* 1 ─ bounding box & centre */
  const box    = new THREE.Box3().setFromObject( root );
  const size   = box.getSize( new THREE.Vector3() );
  const centre = box.getCenter( new THREE.Vector3() );

//  const dir = new THREE.Vector3(0, -1, 0).normalize();
  const dir = new THREE.Vector3(0, -1, 0)                                 // start: front view
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(15))   // yaw
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-25.264)) // pitch up
    .normalize();
  const dist = size.length();

  cam.position.copy( centre ).addScaledVector( dir, dist );
  cam.up.set( 0, 0, 1 ); // ensure camera is upright
  cam.lookAt( centre );

  ctrls.target.copy( centre );
  ctrls.update();

  /* 3 - Set Near and Far Clipping Planes ✨ */
  const modelRadius = size.divideScalar(2).length();
  const camToCenterDist = cam.position.distanceTo(centre);
  console.log(`Model radius: ${modelRadius}, Camera to center distance: ${camToCenterDist}`);

  cam.near = camToCenterDist - modelRadius;
  cam.far = camToCenterDist + modelRadius;
  console.log(`Camera near: ${cam.near}, far: ${cam.far}`);
}

const lineMat = new THREE.LineBasicMaterial({
  color: 0x000000,
  depthTest: true,        // still respect occlusion by other parts
  depthWrite: false,       // but never overwrite the depth buffer
});

lineMat.onBeforeCompile = function (shader) {
  // Modify the vertex shader to pull the line slightly towards the camera
  // This is necessary to ensure the line is always visible in the orthographic view
  const finalLine = shader.vertexShader.lastIndexOf('}');

  const injection = `
    // Pull the line slightly towards the camera
    // Scale by w to handle zoom nicely.
    gl_Position.z -= 0.0005 * gl_Position.w;
  `;

  shader.vertexShader = [
    shader.vertexShader.slice(0, finalLine),
    injection,
    shader.vertexShader.slice(finalLine)
  ].join('\n');
};

const tex_loader = new THREE.TextureLoader();
const BASE = import.meta.env.BASE_URL || '/';

const DEFAULT_OWNER = 'garylinscott';
const DEFAULT_REPO = 'stationary_engine_tutorial';
const owner = import.meta.env.VITE_GITHUB_OWNER ?? DEFAULT_OWNER;
const repo = import.meta.env.VITE_GITHUB_REPO ?? DEFAULT_REPO;
const tagConfig = import.meta.env.VITE_ASSET_TAG ?? 'latest';
const explicitAssetBase = import.meta.env.VITE_ASSET_BASE_URL;
const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

const ASSET_BASE = (() => {
  if (explicitAssetBase) {
    return explicitAssetBase.endsWith('/') ? explicitAssetBase : `${explicitAssetBase}/`;
  }
  if (import.meta.env.DEV || isLocalhost) {
    return `${BASE}assets/`;
  }
  const tagPath = tagConfig === 'latest' ? 'latest/download' : `download/${tagConfig}`;
  return `https://github.com/${owner}/${repo}/releases/${tagPath}/`;
})();

const matcapTex   = tex_loader.load(`${BASE}assets/onshape-matcap-128.png`);
matcapTex.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.MeshMatcapMaterial({
  matcap      : matcapTex,
  vertexColors: true,
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 1,
});

const app = document.querySelector('#app');

// Set up scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// Set up camera
const camera = new THREE.OrthographicCamera();

// Set up renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping      = THREE.NoToneMapping;
app.appendChild(renderer.domElement);

// Set up controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = true;
controls.zoomSpeed = 1.5;

const pmrem = new THREE.PMREMGenerator( renderer );
scene.environment = pmrem.fromScene( new RoomEnvironment(), 0.04 ).texture;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/'); // Use CDN or host locally

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.setCrossOrigin('anonymous');

async function fetchMotionJson() {
  const gzUrl = `${ASSET_BASE}motion.json.gz`;
  const tryLocalPlain = import.meta.env.DEV || isLocalhost;
  let lastError;
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const response = await fetch(gzUrl);
      if (response.ok && response.body) {
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        return JSON.parse(text);
      }
    } catch (err) {
      console.warn('Gzipped motion load failed, falling back to JSON:', err);
      lastError = err;
    }
  }

  if (tryLocalPlain) {
    const fallbackResponse = await fetch(`${ASSET_BASE}motion.json`);
    if (!fallbackResponse.ok) {
      throw new Error(`Failed to load motion.json (status ${fallbackResponse.status})`);
    }
    return fallbackResponse.json();
  }

  console.error('Unable to load motion.json.gz and no fallback available.', lastError);
  throw new Error('Motion data requires a browser with `DecompressionStream` support.');
}

const player = new MotionPlayer(scene);
let playing = true;
let tNorm = 0;
const playSpeed = 0.2; // cycles per second
const clock = new THREE.Clock();

loader.load(
  `${ASSET_BASE}edges.glb`,
  (gltf) => {
    let model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.material = material;
        child.renderOrder = 0;
        child.geometry.computeVertexNormals();
      }
      if (child.isLine) {
        child.material = lineMat;
        child.renderOrder = 1;
      }
    });
    scene.add(model);
    frameOrthoIsometric(camera, controls, model);
    updateCamera();

    Promise.all([
      fetch(`${ASSET_BASE}occ2node.json`).then(r => r.json()),
      fetchMotionJson(),
    ]).then(([occ2node, motion]) => {
      player.attachOcc2Node(occ2node);
      player.loadMotion(motion);
      player.setFrameByIndex(0);

      // Debug: compare frame 0 matrices to current to detect transpose issues
      try {
        const fr0 = motion.frames[0];
        const tmp = new THREE.Matrix4();
        let checked = 0, within = 0;
        Object.entries(occ2node).forEach(([occKey, names]) => {
          const solid = scene.getObjectByName(names.solid);
          const arr = fr0.occurrences[occKey];
          if (!solid || !arr) return;
          tmp.fromArray(arr).transpose();
          const a = tmp.elements;
          const b = solid.matrix.elements;
          let maxd = 0;
          for (let i=0;i<16;i++) maxd = Math.max(maxd, Math.abs(a[i]-b[i]));
          checked++;
          if (maxd < 1e-6) within++;
        });
        console.log(`Motion debug: compared ${checked} nodes, ${within} within tolerance to frame 0.`);
      } catch (e) {}

      const btns = document.querySelectorAll('[data-frame]');
      btns.forEach(btn => btn.addEventListener('click', () => {
        const i = Number(btn.dataset.frame);
        player.setFrameByIndex(i);
      }));

      window.addEventListener('keydown', (e) => {
        if (e.key === '1') player.setFrameByIndex(0);
        if (e.key === '2') player.setFrameByIndex(1);
        if (e.key === '3') player.setFrameByIndex(2);
      });
    }).catch(err => console.warn('Motion assets not loaded:', err));
  },
  undefined,
  (error) => {
    console.error('An error happened loading the GLB model:', error);
  }
);


// Animation loop
function animate() {
  requestAnimationFrame(animate);

  controls.update();
  // advance interpolation if playing
  if (playing) {
    const dt = clock.getDelta();
    tNorm = (tNorm + dt * playSpeed) % 1;
    player.setNormalizedT(tNorm);
    const slider = document.getElementById('t-slider');
    if (slider) slider.value = String(tNorm);
  }
  renderer.render(scene, camera);
}


animate();

function updateCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumSize = 0.5;

  camera.left   = -aspect * frustumSize / 2;
  camera.right  =  aspect * frustumSize / 2;
  camera.top    =  frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
}

// Handle window resize
window.addEventListener('resize', () => {
  updateCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// UI wiring for interpolation controls after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('t-slider');
  const playBtn = document.getElementById('play-toggle');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      tNorm = v;
      playing = false;
      player.setNormalizedT(tNorm);
    });
  }
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      playing = !playing;
      if (playing) clock.getDelta(); // reset delta when resuming
      playBtn.textContent = playing ? 'Pause' : 'Play';
    });
    playBtn.textContent = playing ? 'Pause' : 'Play';
  }
});
