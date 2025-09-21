import * as THREE from 'three';

export class MotionPlayer {
  constructor(scene) {
    this.scene = scene;
    this.occToObjects = new Map();
    this.motion = undefined;
    this._decomposed = new Map(); // occKey -> { p: Vector3[], q: Quaternion[], s: Vector3[] }
  }

  attachOcc2Node(occ2node) {
    Object.entries(occ2node).forEach(([occKey, names]) => {
      const targets = [];
      const solid = this.scene.getObjectByName(names.solid);
      if (solid) targets.push(solid);
      if (names.edges) {
        const edges = this.scene.getObjectByName(names.edges);
        if (edges) targets.push(edges);
      }
      if (targets.length) this.occToObjects.set(occKey, targets);
      else {
        console.warn('MotionPlayer: no scene objects for occurrence', occKey, names);
      }
    });
  }

  loadMotion(motion) {
    this.motion = motion;
    const matrixTable = Array.isArray(motion.matrixTable)
      ? motion.matrixTable
      : Array.isArray(motion.matrices)
        ? motion.matrices
        : null;
    const resolveMatrix = (value, occKey) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'number' && matrixTable) {
        const resolved = matrixTable[value];
        if (!resolved) {
          console.warn(`MotionPlayer: missing matrixTable entry ${value} for ${occKey}`);
        }
        return resolved;
      }
      if (typeof value === 'number') {
        console.warn('MotionPlayer: matrix index without matrixTable', occKey, value);
      }
      return undefined;
    };

    if (matrixTable) this.matrixTable = matrixTable;
    else this.matrixTable = undefined;

    motion.frames.forEach((frame) => {
      Object.entries(frame.occurrences).forEach(([occKey, value]) => {
        const resolved = resolveMatrix(value, occKey);
        if (resolved) frame.occurrences[occKey] = resolved;
        else delete frame.occurrences[occKey];
      });
    });

    // Precompute decomposed transforms (pos/quaternion/scale) for each occurrence & frame
    const tmpM = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const decomposed = new Map();
    const frameCount = motion.frames.length;
    const keys = new Set();
    motion.frames.forEach(fr => Object.keys(fr.occurrences).forEach(k => keys.add(k)));
    keys.forEach((occKey) => {
      const ps = new Array(frameCount);
      const qs = new Array(frameCount);
      const ss = new Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        const arr = motion.frames[i].occurrences[occKey];
        if (!arr) { ps[i]=undefined; qs[i]=undefined; ss[i]=undefined; continue; }
        tmpM.fromArray(arr).transpose();
        tmpM.decompose(p, q, s);
        ps[i] = p.clone();
        qs[i] = q.clone();
        ss[i] = s.clone();
      }
      decomposed.set(occKey, { p: ps, q: qs, s: ss });
    });
    this._decomposed = decomposed;
  }

  setFrameByIndex(i) {
    if (!this.motion) return;
    const frame = this.motion.frames[i];
    if (!frame) return;

    const tmpM = new THREE.Matrix4();
    this.occToObjects.forEach((objs, occKey) => {
      const arr = frame.occurrences[occKey];
      if (!arr) return;
      // Onshape matrices are row-major; THREE expects column-major arrays.
      // Transpose to match THREE's internal convention.
      tmpM.fromArray(arr).transpose();
      objs.forEach(o => {
        o.matrix.copy(tmpM);
        o.matrixAutoUpdate = false;
        o.matrixWorldNeedsUpdate = true;
        o.updateMatrixWorld(true);
      });
    });
  }

  setNormalizedT(t) {
    if (!this.motion) return;
    const n = this.motion.frames.length;
    if (n === 0) return;
    const wrapped = ((t % 1) + 1) % 1; // [0,1)
    const fIndex = wrapped * n;
    const i0 = Math.floor(fIndex) % n;
    const i1 = (i0 + 1) % n;
    const alpha = fIndex - Math.floor(fIndex);

    const outM = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();

    this.occToObjects.forEach((objs, occKey) => {
      const dec = this._decomposed.get(occKey);
      if (!dec) return;
      const p0 = dec.p[i0], p1 = dec.p[i1];
      const q0 = dec.q[i0], q1 = dec.q[i1];
      const s0 = dec.s[i0], s1 = dec.s[i1];
      if (!p0 || !p1 || !q0 || !q1 || !s0 || !s1) return;

      p.copy(p0).lerp(p1, alpha);
      q.copy(q0).slerp(q1, alpha);
      s.copy(s0).lerp(s1, alpha);
      outM.compose(p, q, s);
      objs.forEach(o => {
        o.matrix.copy(outM);
        o.matrixAutoUpdate = false;
        o.matrixWorldNeedsUpdate = true;
      });
    });
  }
}
