#!/bin/bash
gltf-transform optimize 'BEAM ENGINE ASSEMBLY parts - FLYWHEEL LARGE.gltf' tmp.glb --compress draco --simplify 0.4 --weld --join --prune
