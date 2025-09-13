import base64
import json
import numpy as np
import requests
import trimesh

# Use the keys from the developer portal
with open(".secrets", "r") as f:
    lines = f.readlines()
    access_key = lines[0].strip()
    secret_key = lines[1].strip()

# Define the header for the request
headers = {'Accept': 'application/json;charset=UTF-8;qs=0.09',
           'Content-Type': 'application/json'}

def onshape_request(url, params=None):
    """
    Make a request to the Onshape API and return the JSON response.
    """
    response = requests.get(
        url,
        params=params,
        auth=(access_key, secret_key),
        headers=headers,)
    if response.status_code == 200:
        return response.json()
    else:
        response.raise_for_status()

def load_part_studio_features():
  response = onshape_request(f"https://cad.onshape.com/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/bodydetails?rollbackBarIndex=-1")
  #response = onshape_request(f"https://cad.onshape.com/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features?rollbackBarIndex=-1&includeGeometryIds=true&noSketchGeometry=false")
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

def load_assembly(configuration=None):
  params = {}
  if configuration is not None:
     params["configuration"] = configuration
  print(params)
  response = onshape_request(
     f"https://cad.onshape.com/api/assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/",
     params=params
  )
  with open("assembly.json", "w") as f:
    json.dump(response, f, indent=2)

def get_theta_param_id():
    url = f"https://cad.onshape.com/api/v6/elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration"
    cfg = onshape_request(url)
    print(cfg)
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

def load_parts():
  scene = trimesh.Scene()

  with open("edges.json", "r") as f:
    edges = json.load(f)
  for part in edges:
    part_id = part["id"]
    edge_list = []
    for edge in part["edges"]:
      edge_id = edge["id"]
      edge_list.append(np.asarray(edge["vertices"]))
    segments_per_edge = [
      np.stack((edge[:-1], edge[1:]), axis=1)   # (Ni-1, 2, 3)
      for edge in edge_list
    ]
    segments = np.concatenate(segments_per_edge, axis=0)
    path = trimesh.load_path(segments)
    black = np.array([0, 0, 0, 255], dtype=np.uint8)
    path.colors = np.tile(black, (len(path.entities), 1))
    scene.geometry[f"{part_id}_edges"] = path

  with open("faces.json", "r") as f:
    faces = json.load(f)
  for body in faces:
    triangle_list = []
    for face in body["faces"]:
      triangle_list.append(np.asarray([f["vertices"] for f in face["facets"]], dtype=np.float32))
    triangles = np.concatenate(triangle_list, axis=0)  # (T, 3, 3)
    # triangles = triangles[:, [0, 2, 1], :]
    V = triangles.reshape(-1, 3)              # (T*3, 3)
    F = np.arange(len(V)).reshape(-1, 3)       # (T, 3)
    mesh = trimesh.Trimesh(vertices=V,
                           faces=F,
                           process=False)
    if "color" in body:
      color = base64_to_rgba(body["color"])
      mesh.visual.vertex_colors = color
    scene.geometry[body["id"]] = mesh

  with open("assembly.json", "r") as f:
    assembly = json.load(f)
  instances = {inst["id"]: inst for inst in assembly["rootAssembly"]["instances"]}
  for idx, occ in enumerate(assembly["rootAssembly"]["occurrences"]):
    # TODO: handle sub-assemblies
    leaf_id  = occ["path"][-1]
    if leaf_id not in instances:
      print(f"WARNING: instance {leaf_id} not found in assembly - skipped")
      continue
    inst     = instances[leaf_id]
    if "partId" not in inst:
      print(f"WARNING: instance {inst} has no partId - skipped")
      continue
    part_id = inst["partId"]
    if part_id not in scene.geometry:
      print(f"WARNING: geometry for {part_id} missing - skipped")
      continue

    #if inst['name'] != "BEAM <1>":
    #  continue
    # print(f"{inst['name']} {part_id}")

    matrix44 = np.asarray(occ['transform'], float).reshape(4, 4)
    scene.add_geometry(scene.geometry[part_id], transform=matrix44, node_name=f"{part_id}_{idx}")
    scene.add_geometry(scene.geometry[f"{part_id}_edges"], transform=matrix44, node_name=f"{part_id}_edges_{idx}")

  glb = trimesh.exchange.gltf.export_glb(scene)
  with open("edges.glb", "wb") as f:
    f.write(glb)

#load_edges()
#load_faces()
# load_part_studio_features()
#load_assembly()


def sample_at_angle(angle):
  theta_param_id = get_theta_param_id()
  encoded_config = encode_theta(theta_param_id, angle)
  load_assembly(encoded_config)

sample_at_angle(180.0)
load_parts()