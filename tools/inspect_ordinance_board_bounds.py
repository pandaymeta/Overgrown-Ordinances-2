import bpy
import os
from mathutils import Vector

ROOT = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules"
MODELS = {
    "JayWalking": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "JayWalking_Clean.glb"),
    "HighVoltage": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "HighVoltage_Clean.glb"),
    "DoNotStep": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "DoNotStep_Clean.glb"),
    "StreetLightsClimb": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "StreetLightsClimb_Clean.glb"),
    "StreetLightsDestroy": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "StreetLightsDestroy_Clean.glb"),
    "PoleCut": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "PoleCut_Clean.glb"),
    "TreesCutting": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "TreesCutting_Clean.glb"),
    "TreesClimbing": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "TreesClimbing_Clean.glb"),
    "ShopSign": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "ShopSign_Clean.glb"),
    "CatFeed": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "CatFeed_Clean.glb"),
    "Cones": os.path.join(ROOT, "assets", "OrdinanceCards", "Clean", "Cones_Clean.glb"),
}

for name, path in MODELS.items():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        local = [o.matrix_world @ Vector(corner) for corner in o.bound_box]
        low_mesh = [min(v[i] for v in local) for i in range(3)]
        high_mesh = [max(v[i] for v in local) for i in range(3)]
        print("  mesh", o.name, "size", [high_mesh[i]-low_mesh[i] for i in range(3)], "min", low_mesh)
    coords = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
    low = [min(v[i] for v in coords) for i in range(3)]
    high = [max(v[i] for v in coords) for i in range(3)]
    print(name, "min", low, "max", high, "size", [high[i]-low[i] for i in range(3)])
