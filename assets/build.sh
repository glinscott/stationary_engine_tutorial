#!/bin/bash
SRC=../out
TARGET=../vite-engine/public/assets

gltf-transform draco $SRC/edges.glb $TARGET/edges.glb
cp $SRC/motion* $TARGET/
cp $SRC/occ2node.json $TARGET/


# Different gltf-options
#gltf-transform optimize edges.glb tmp.glb --compress draco --simplify 0.4 --weld --join --prune
#gltf-transform optimize edges.glb tmp.glb --compress draco --weld --prune
