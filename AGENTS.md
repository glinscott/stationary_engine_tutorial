# Overview

This is a project to build a tutorial of a how a boulton and watt steam engine works, with detailed 3d animations.

The animations are built off a CAD model from onshape, which has a fully-defined assembly for the engine.

There are two main components so far, the converter and the web-page.

## Converter

In the `./converter` directory.

This downloads the CAD model from onshape, and exports it to GLB.  It also exports an animation in JSON format.

There is also a manual step to optimize the GLB, as it's very large.

## Web-page

Int the `/.vite-engine` directory.

The web-page is quite minimal currently, just prototyping the animation of the 3D CAD model.
