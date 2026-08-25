import json
import struct
from pathlib import Path

ROOT = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\PolyforkAssets\Ordinances")


def load_glb(path: Path):
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len
    if bin_start % 4:
        bin_start += 4 - (bin_start % 4)
    bin_len, _ = struct.unpack_from("<I4s", data, bin_start)
    blob = bytearray(data[bin_start + 8 : bin_start + 8 + bin_len])
    return gltf, blob


def avg_normal(gltf, blob, accessor_idx: int):
    acc = gltf["accessors"][accessor_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or 12
    sx = sy = sz = 0.0
    for i in range(acc["count"]):
        x, y, z = struct.unpack_from("<fff", blob, off + i * stride)
        sx += x
        sy += y
        sz += z
    c = max(1, acc["count"])
    return (sx / c, sy / c, sz / c)


for name in ("PoleCut.glb", "Maintenance.glb", "JayWalking.glb", "Bench.glb"):
    path = ROOT / name
    gltf, blob = load_glb(path)
    print("===", name)
    for i, mat in enumerate(gltf.get("materials", [])):
        pbr = mat.get("pbrMetallicRoughness", {})
        print(" mat", i, mat.get("name"), "tex", pbr.get("baseColorTexture"))
    for ni, node in enumerate(gltf.get("nodes", [])):
        if node.get("mesh") is None:
            continue
        mesh = gltf["meshes"][node["mesh"]]
        print(" node", node.get("name"), "mesh", node["mesh"])
        for pi, prim in enumerate(mesh.get("primitives", [])):
            attrs = prim.get("attributes", {})
            mat_i = prim.get("material")
            mat_name = gltf["materials"][mat_i]["name"] if mat_i is not None else None
            nrm = avg_normal(gltf, blob, attrs["NORMAL"]) if "NORMAL" in attrs else None
            print("  prim", pi, mat_name, "avgN", tuple(round(v, 3) for v in nrm) if nrm else None)
    for i, img in enumerate(gltf.get("images", [])):
        bv = gltf["bufferViews"][img["bufferView"]]
        off = bv.get("byteOffset", 0)
        ln = bv["byteLength"]
        data = bytes(blob[off : off + ln])
        out = ROOT / f"_extract_{path.stem}_{i}.png"
        if data[:8].startswith(b"\x89PNG") or img.get("mimeType") == "image/png":
            out.write_bytes(data)
            print(" wrote", out.name, ln)
        elif data[:2] == b"\xff\xd8":
            out = out.with_suffix(".jpg")
            out.write_bytes(data)
            print(" wrote", out.name, ln)
        else:
            print(" img", i, "unknown", data[:8], ln)
