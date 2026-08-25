import bpy, os
from mathutils import Vector

ROOT = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules"
for card in ("CatFeed", "Cones"):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", card + "_Clean.glb"))
    print("CARD", card)
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH" and "board" in o.name.lower()]:
        polygons = sorted(obj.data.polygons, key=lambda p: p.area, reverse=True)
        print(obj.name)
        for p in polygons[:6]:
            center = obj.matrix_world @ p.center
            normal = (obj.matrix_world.to_3x3() @ p.normal).normalized()
            print(" poly", "center", tuple(round(v, 6) for v in center),
                  "normal", tuple(round(v, 6) for v in normal), "area", round(p.area, 6))
