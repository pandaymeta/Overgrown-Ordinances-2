import bpy
import os

IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
# These are the assets the scene actually instantiates.  Rebuilding the
# unused v5 copies did not change the cards in play mode.
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\streetlights"

# Measured from StreetLightsClimb_Clean.glb and StreetLightsDestroy_Clean.glb.
# Their boards are not centred on local X=0, so use their actual extents.
X_MIN, X_MAX = -0.887272, 0.752728
HALF_HEIGHT = 1.025
BACK_FACE_DEPTH = -0.018
CARDS = ("StreetLightsClimb", "StreetLightsDestroy")

def material(name, image_path):
    image = bpy.data.images.load(image_path, check_existing=False)
    # Do not alter the UVs, transform, or source pixels.  The live card mesh
    # already presents this surface through the correct side; the prior
    # pixel-mirror pass caused the text to read backward in Studio.
    image.pack()
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = False
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    texture = result.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    result.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    result.node_tree.links.new(texture.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.88
    try:
        result.surface_render_method = "DITHERED"
    except Exception:
        pass
    return result

def single_back_face(name, mat):
    mesh = bpy.data.meshes.new(name + "Mesh")
    # One display surface only, exactly as used by ShopSign.  A closed solid
    # repeats the bitmap on its reverse face and produces the back-to-back art.
    y = BACK_FACE_DEPTH
    mesh.from_pydata(
        [(X_MIN, y, -HALF_HEIGHT), (X_MAX, y, -HALF_HEIGHT),
         (X_MAX, y, HALF_HEIGHT), (X_MIN, y, HALF_HEIGHT)],
        [],
        [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    # Fixed, untouched mapping. Orientation comes solely from RuntimeBack.
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0,0), (0,1), (1,1), (1,0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

os.makedirs(OUTPUT_DIR, exist_ok=True)
for card in CARDS:
    source = os.path.join(IMAGE_DIR, card + "_RuntimeBack.png")
    mat = material("__" + card + "SingleMat", source)
    face = single_back_face("__" + card + "SingleBackFace", mat)
    bpy.ops.object.select_all(action="DESELECT")
    face.select_set(True)
    bpy.context.view_layer.objects.active = face
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUTPUT_DIR, card + "_Card_ShopSignStyle.glb"),
        export_format="GLB", use_selection=True, export_materials="EXPORT",
        export_image_format="AUTO", export_normals=True, export_yup=True)
    bpy.data.objects.remove(face, do_unlink=True)
    bpy.data.materials.remove(mat, do_unlink=True)
    print("Exported", card)
