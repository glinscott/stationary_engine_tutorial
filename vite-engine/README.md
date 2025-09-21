```
npm run dev
```

TODO:
```
     model.traverse((child) => {
       if (child.isMesh) {
         child.material = material;
         child.renderOrder = 0;
-        /*
-        BufferGeometryUtils.computeMikkTSpaceTangents(child.geometry); // optional
-        BufferGeometryUtils.computeVertexNormalsWithAreaWeight(
-            child.geometry, THREE.MathUtils.degToRad(60));
-        */
```
