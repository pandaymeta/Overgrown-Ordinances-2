import bpy
import os

IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v5"
HALF_WIDTH = 0.820
HALF_HEIGHT = 1.025
FACE_OFFSET = 0.137

# These remain excluded until their distinct board artwork is handled separately.
CARDS = {
    "Bushes": "Bushes", "CatFeed": "CatFeed", "Cats": "Cats",
    "Cones": "Cones", "Crates": "Crates", "TreesCutting": "TreesCutting",
    "FireHydrant": "FireHydrant", "Kiosk": "Kiosk", "Logs": "Logs",
    "Maintenance": "Maintenance", "Metals": "Metals", "Plastics": "Plastics",
    "PoleCut": "PoleCut", "ShopSign": "ShopSign", "Signs": "Signs",
    "StreetLightsClimb": "StreetLightsClimb", "StreetLightsDestroy": "StreetLightsDestroy",
    "Tram": "Tram", "TreesClimbing": "TreesClimbing", "WoodPlanks": "WoodPlanks",
    "Rocks": "Rocks",
}
globals().update(locals())
os.makedirs(OUTPUT_DIR, exist_ok=True)

def make_material(name, path):
    image = bpy.data.images.load(path, check_existing=False)
    image.pack()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    material.node_tree.links.new(texture.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = .88
    try: material.surface_render_method = "DITHERED"
    except Exception: pass
    return material

def make_face(name, y, front, material):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata([(-HALF_WIDTH,y,-HALF_HEIGHT),(HALF_WIDTH,y,-HALF_HEIGHT),
                       (HALF_WIDTH,y,HALF_HEIGHT),(-HALF_WIDTH,y,HALF_HEIGHT)], [],
                      [(0,3,2,1)] if front else [(0,1,2,3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0,0),(0,1),(1,1),(1,0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

results=[]
for asset, image_name in CARDS.items():
    front_path = os.path.join(IMAGE_DIR, image_name + "_RuntimeFront.png")
    back_path = os.path.join(IMAGE_DIR, image_name + "_RuntimeBack.png")
    if not os.path.exists(front_path) or not os.path.exists(back_path):
        results.append(asset + ": missing images")
        continue
    front_mat = make_material("__CardV5_" + asset + "_FrontMat", front_path)
    back_mat = make_material("__CardV5_" + asset + "_BackMat", back_path)
    front = make_face("__CardV5_" + asset + "_Front", FACE_OFFSET, True, front_mat)
    back = make_face("__CardV5_" + asset + "_Back", -FACE_OFFSET, False, back_mat)
    bpy.ops.object.select_all(action="DESELECT")
    front.select_set(True); back.select_set(True); bpy.context.view_layer.objects.active = front
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_DIR, asset + "_Card_Upright_v5.glb"),
        export_format="GLB", use_selection=True, export_materials="EXPORT", export_image_format="AUTO", export_normals=True, export_yup=True)
    bpy.data.objects.remove(front, do_unlink=True); bpy.data.objects.remove(back, do_unlink=True)
    bpy.data.materials.remove(front_mat, do_unlink=True); bpy.data.materials.remove(back_mat, do_unlink=True)
    results.append(asset + ": ok")
result = "\n".join(results)
