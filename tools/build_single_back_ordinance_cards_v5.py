import bpy
import os

IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v5"
CARDS = ("TreesClimbing", "TreesCutting", "ShopSign", "Birds")

# All four clean boards measure 1.64 x 2.05. Their board is offset left by
# 0.067272 in model space, while their backing face is at -0.012 depth.
X_MIN, X_MAX = -0.887272, 0.752728
HALF_HEIGHT = 1.025
BACK_FACE_DEPTH = -0.018

def material(name, path):
    image = bpy.data.images.load(path, check_existing=False)
    image.pack()
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = False
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    texture = result.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    result.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    result.node_tree.links.new(texture.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.88
    try:
        result.surface_render_method = "DITHERED"
    except Exception:
        pass
    return result

def back_face(name, mat):
    mesh = bpy.data.meshes.new(name + "Mesh")
    # Match the original standard-card back face exactly: only its physical
    # depth and model-space horizontal placement are corrected.
    mesh.from_pydata(
        [(X_MIN, BACK_FACE_DEPTH, -HALF_HEIGHT), (X_MAX, BACK_FACE_DEPTH, -HALF_HEIGHT),
         (X_MAX, BACK_FACE_DEPTH, HALF_HEIGHT), (X_MIN, BACK_FACE_DEPTH, HALF_HEIGHT)],
        [], [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0, 0), (0, 1), (1, 1), (1, 0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

os.makedirs(OUTPUT_DIR, exist_ok=True)
for card in CARDS:
    mat = material("__" + card + "BackMat", os.path.join(IMAGE_DIR, card + "_RuntimeBack.png"))
    face = back_face("__" + card + "BackOnly", mat)
    bpy.ops.object.select_all(action="DESELECT")
    face.select_set(True)
    bpy.context.view_layer.objects.active = face
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUTPUT_DIR, card + "_Card_BackOnly_v5.glb"),
        export_format="GLB", use_selection=True, export_materials="EXPORT",
        export_image_format="AUTO", export_normals=True, export_yup=True)
    bpy.data.objects.remove(face, do_unlink=True)
    bpy.data.materials.remove(mat, do_unlink=True)
    print("Exported", card)
