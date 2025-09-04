import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

const matcapTex   = tex_loader.load('/assets/onshape-matcap-128.png');
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

loader.load(
  '/assets/edges.glb', // Update this path to your actual GLB file
  (gltf) => {
    let model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.material = material;
        child.renderOrder = 0;
        /*
        BufferGeometryUtils.computeMikkTSpaceTangents(child.geometry); // optional
        BufferGeometryUtils.computeVertexNormalsWithAreaWeight(
            child.geometry, THREE.MathUtils.degToRad(60));
        */

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