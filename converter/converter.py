import argparse
import base64
import json
import os
import sys
from typing import Dict, List, Tuple

import numpy as np
import requests
import trimesh
import re

# Use the keys from the developer portal (already configured for uv run)
with open(".secrets", "r") as f:
    lines = f.readlines()
    access_key = lines[0].strip()
    secret_key = lines[1].strip()

# Define the header for the request
headers = {'Accept': 'application/json;charset=UTF-8;qs=0.09',
           'Content-Type': 'application/json'}

def onshape_request(url, params=None):
    """Make a request to the Onshape API and return the JSON response."""
    response = requests.get(
        url,
        params=params,
        auth=(access_key, secret_key),
        headers=headers,
    )
    if response.status_code == 200:
        return response.json()
    else:
        response.raise_for_status()

def load_part_studio_features():
  response = onshape_request(f"https://cad.onshape.com/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/bodydetails?rollbackBarIndex=-1")
  with open("features.json", "w") as f:
    json.dump(response, f, indent=2)

def load_faces():
  response = onshape_request(f"https://cad.onshape.com/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/tessellatedfaces?rollbackBarIndex=-1&outputFaceAppearances=true&outputVertexNormals=true&outputFacetNormals=false&outputTextureCoordinates=false&outputIndexTable=false&outputErrorFaces=false&combineCompositePartConstituents=false&chordTolerance=0.0001&angleTolerance=1")
  with open("faces.json", "w") as f:
    json.dump(response, f, indent=2)

def load_edges():
  print("loading edges")
  response = onshape_request(f"https://cad.onshape.com/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/tessellatededges?rollbackBarIndex=-1&chordTolerance=0.0001&angleTolerance=1")
  with open("edges.json", "w") as f:
    json.dump(response, f, indent=2)

def fetch_assembly(configuration=None):
  params = {}
  if configuration is not None:
     params["configuration"] = configuration
  response = onshape_request(
     f"https://cad.onshape.com/api/assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/",
     params=params
  )
  return response

def get_theta_param_id():
    url = f"https://cad.onshape.com/api/v6/elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration"
    cfg = onshape_request(url)
    for p in cfg.get("configurationParameters", []):
        if p.get("parameterName") == "thetaDeg":
            return p["parameterId"]
    raise RuntimeError("thetaDeg not found")

def encode_theta(param_id, deg):
    url = f"https://cad.onshape.com/api/v6/elements/d/{did}/e/{eid}/configurationencodings"
    body = {"parameters":[{"parameterId": param_id, "parameterValue": f"{deg} degree"}]}
    r = requests.post(url, json=body, auth=(access_key, secret_key), headers=headers)
    r.raise_for_status()
    return r.json()["encodedId"]

document = "https://cad.onshape.com/documents/ebc9190f428cf30153c06148/w/8e27fa4d26837b5b136fb4a1/e/d2f73f6396ee11d44c08fc80"
chunks = document.split('/')
did = chunks[chunks.index("documents") + 1]
wvm = "w"
wvmid = chunks[chunks.index("w") + 1]
eid = chunks[chunks.index("e") + 1]

def base64_to_rgba(b64str):
  # Decode base64 to bytes
  rgba_bytes = base64.b64decode(b64str)
  # Convert bytes to numpy array of 4 uint8 values
  srgb = np.frombuffer(rgba_bytes, dtype=np.uint8) / 255.0
  # Return as tuple of ints
  rgb  = srgb[:3]
  linear_rgb = np.where(rgb <= 0.04045,
                        rgb / 12.92,
                        ((rgb + 0.055) / 1.055) ** 2.4)
  return np.concatenate((linear_rgb, srgb[3:4]))

def _sanitize(name: str) -> str:
  # GLTF node names should avoid problematic characters for tooling; keep alnum and _.-
  return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


def build_scene_and_occmap(assembly: dict, faces: List[dict], edges: List[dict]) -> Tuple[trimesh.Scene, Dict[str, Dict[str, str]]]:
  scene = trimesh.Scene()

  # Edges geometry
  edge_geom = {}
  for part in edges:
    part_id = part["id"]
    edge_list = [np.asarray(edge["vertices"]) for edge in part.get("edges", [])]
    if not edge_list:
      continue
    segments_per_edge = [np.stack((edge[:-1], edge[1:]), axis=1) for edge in edge_list]
    segments = np.concatenate(segments_per_edge, axis=0)
    path = trimesh.load_path(segments)
    black = np.array([0, 0, 0, 255], dtype=np.uint8)
    path.colors = np.tile(black, (len(path.entities), 1))
    edge_geom[f"{part_id}_edges"] = path

  # Faces geometry
  solid_geom = {}
  for body in faces:
    triangle_list = []
    for face in body.get("faces", []):
      triangle_list.append(np.asarray([f["vertices"] for f in face.get("facets", [])], dtype=np.float32))
    if not triangle_list:
      continue
    triangles = np.concatenate(triangle_list, axis=0)
    V = triangles.reshape(-1, 3)
    F = np.arange(len(V)).reshape(-1, 3)
    mesh = trimesh.Trimesh(vertices=V, faces=F, process=False)
    if "color" in body:
      color = base64_to_rgba(body["color"])
      mesh.visual.vertex_colors = color
    solid_geom[body["id"]] = mesh

  # Place instances and record mapping
  instances = {inst["id"]: inst for inst in assembly["rootAssembly"]["instances"]}
  occ2node: Dict[str, Dict[str, str]] = {}
  for idx, occ in enumerate(assembly["rootAssembly"]["occurrences"]):
    leaf_id  = occ["path"][-1]
    if leaf_id not in instances:
      continue
    inst     = instances[leaf_id]
    if "partId" not in inst:
      continue
    part_id = inst["partId"]
    if part_id not in solid_geom:
      continue

    matrix44 = np.asarray(occ['transform'], float).reshape(4, 4)
    solid_node = _sanitize(f"{part_id}_{idx}")
    scene.add_geometry(solid_geom[part_id], transform=matrix44, node_name=solid_node)

    edge_node = None
    ek = f"{part_id}_edges"
    if ek in edge_geom:
      edge_node = _sanitize(f"{part_id}_edges_{idx}")
      scene.add_geometry(edge_geom[ek], transform=matrix44, node_name=edge_node)

    occ_key = "/".join(occ["path"])
    occ2node[occ_key] = {"solid": solid_node}
    if edge_node:
      occ2node[occ_key]["edges"] = edge_node

  return scene, occ2node


def sample_motion(angles_deg: List[float]) -> dict:
  frames = []
  theta_param_id = get_theta_param_id()
  for angle in angles_deg:
    encoded_config = encode_theta(theta_param_id, angle)
    asm = fetch_assembly(configuration=encoded_config)
    frame = {"angleDeg": angle, "occurrences": {}}
    for occ in asm["rootAssembly"]["occurrences"]:
      key = "/".join(occ["path"])
      m = np.asarray(occ["transform"], float).reshape(4, 4)
      frame["occurrences"][key] = m.flatten().tolist()
    frames.append(frame)
  return {
    "metadata": {"did": did, "wvm": wvm, "wvmid": wvmid, "eid": eid},
    "anglesDeg": angles_deg,
    "frames": frames,
  }


def export_glb(scene: trimesh.Scene, out_path: str):
  glb = trimesh.exchange.gltf.export_glb(scene)
  with open(out_path, "wb") as f:
    f.write(glb)

def main():
  parser = argparse.ArgumentParser(description="Export GLB and bake motion frames from Onshape.")
  parser.add_argument("--partstudio", help="Comma-separated Part Studio element id(s) for tessellation (faces/edges)", required=False)
  parser.add_argument("--angles", help="Comma-separated degrees (overrides --count)", default=None)
  parser.add_argument("--count", type=int, help="Number of keyframes over 0..360 (exclusive)", default=20)
  args = parser.parse_args()

  if args.angles:
    angles = [float(x.strip()) for x in args.angles.split(",") if x.strip()]
  else:
    # Even sampling in [0, 360) for loop continuity
    step = 360.0 / float(args.count)
    angles = [i * step for i in range(args.count)]

  # OUT directory at repo root
  repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
  out_dir = os.path.join(repo_root, "out")
  os.makedirs(out_dir, exist_ok=True)

  # Build scene + occ map from first angle
  theta_param_id = get_theta_param_id()
  first_enc = encode_theta(theta_param_id, angles[0])
  assembly0 = fetch_assembly(configuration=first_enc)

  if args.partstudio:
    ids = [s.strip() for s in args.partstudio.split(',') if s.strip()]
  else:
    # Auto-discover Part Studio element IDs from assembly instances
    ids = sorted({inst["elementId"] for inst in assembly0["rootAssembly"]["instances"] if "partId" in inst})
    if not ids:
      print("ERROR: No Part Studio element IDs discovered in assembly. Provide --partstudio <PartStudioEID>.")
      sys.exit(1)
  print(ids)

  if os.path.exists("faces.json"):
    with open("faces.json") as f:
      faces = json.load(f)
  else:
    for ps_eid in ids:
      f = onshape_request(
        f"https://cad.onshape.com/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{ps_eid}/tessellatedfaces",
        params=dict(
          rollbackBarIndex=-1,
          outputFaceAppearances=True,
          outputVertexNormals=True,
          outputFacetNormals=False,
          outputTextureCoordinates=False,
          outputIndexTable=False,
          outputErrorFaces=False,
          combineCompositePartConstituents=False,
          chordTolerance=0.0001,
          angleTolerance=1,
        ),
      )
      faces.extend(f)
    with open("faces.json", "w") as f:
      f.write(json.dumps(faces, indent=2))

  if os.path.exists("edges.json"):
    with open("edges.json") as f:
      edges = json.load(f)
  else:
    edges = []
    for ps_eid in ids:
      e = onshape_request(
        f"https://cad.onshape.com/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{ps_eid}/tessellatededges",
        params=dict(rollbackBarIndex=-1, chordTolerance=0.0001, angleTolerance=1),
      )
      edges.extend(e)
    with open("edges.json", "w") as f:
      f.write(json.dumps(edges, indent=2))

  scene, occ2node = build_scene_and_occmap(assembly0, faces, edges)
  export_glb(scene, os.path.join(out_dir, "edges.glb"))

  with open(os.path.join(out_dir, "occ2node.json"), "w") as f:
    json.dump(occ2node, f, indent=2)

  motion = sample_motion(angles)
  with open(os.path.join(out_dir, "motion.json"), "w") as f:
    json.dump(motion, f, indent=2)

  print(f"Wrote: {out_dir}/edges.glb, {out_dir}/occ2node.json, {out_dir}/motion.json")


if __name__ == "__main__":
  main()
