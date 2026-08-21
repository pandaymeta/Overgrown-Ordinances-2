import struct, json, os

def full_bounds(path):
    with open(path, "rb") as f:
        data = f.read()
    clen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + clen].decode().rstrip(" "))
    print("===", os.path.basename(path), "size", os.path.getsize(path), "===")
    nodes = gltf["nodes"]

    def world_t(idx, cache={}):
        if idx in cache:
            return cache[idx]
        n = nodes[idx]
        t = n.get("translation") or [0, 0, 0]
        parent = None
        for pi, pn in enumerate(nodes):
            if pn.get("children") and idx in pn["children"]:
                parent = pi
                break
        if parent is None:
            cache[idx] = list(t)
        else:
            pt = world_t(parent)
            cache[idx] = [pt[0] + t[0], pt[1] + t[1], pt[2] + t[2]]
        return cache[idx]

    for i, n in enumerate(nodes):
        print(
            " node",
            i,
            n.get("name"),
            "local_t=",
            n.get("translation"),
            "world_t=",
            world_t(i),
            "mesh=",
            n.get("mesh"),
            "children=",
            n.get("children"),
        )
    print("scene root indices", gltf["scenes"][0]["nodes"])
    for i, acc in enumerate(gltf.get("accessors", [])):
        if acc.get("type") == "VEC3" and "min" in acc:
            mn = acc["min"]
            mx = acc["max"]
            if max(abs(mx[j] - mn[j]) for j in range(3)) > 0.05:
                print(
                    "  acc",
                    i,
                    "min",
                    [round(x, 3) for x in mn],
                    "max",
                    [round(x, 3) for x in mx],
                )
    print()


full_bounds(
    r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\PolyforkAssets\Ordinances\WoodPlanks.glb"
)
full_bounds(
    r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\PolyforkAssets\Ordinances\JayWalking.glb"
)
