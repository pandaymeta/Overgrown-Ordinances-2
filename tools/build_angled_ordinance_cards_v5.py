import bpy
import os
from mathutils import Vector

IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v5"

# Surface planes measured from the clean CatFeed and Cones board meshes.  Each
# has two sloped display surfaces, so their existing front/back artwork stays
# intact and is placed directly on those surfaces.
CARDS = {
    # These are deliberately offset 5 cm along the exterior face normals.
    # A zero/near-zero offset places the cards inside the A-frame board,
    # causing the opaque board mesh to hide them in Studio.
    "CatFeed": {"front": (-0.067272, 0.397, 0.96215), "back": (-0.067272, -0.397, 0.96739)},
    "Cones": {"front": (-0.067272, 0.403, 0.96411), "back": (-0.067272, -0.403, 0.96963)},
}
HALF_WIDTH = 0.820
HALF_HEIGHT = 1.025
FRONT_NORMAL = Vector((0.0, 0.935783, 0.352578))
# The second A-frame board's visible surface has the opposite normal.  It is
# deliberately separate from the already-correct first-board plane.
BACK_NORMAL = Vector((0.0, -0.935783, 0.352577))
FRONT_UP = Vector((0.0, -0.352578, 0.935783))
BACK_UP = Vector((0.0, 0.352577, 0.935783))

def make_material(name, path):
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

def make_plane(name, centre_tuple, up, front, material):
    centre = Vector(centre_tuple)
    right = Vector((1.0, 0.0, 0.0))
    p0 = centre - right * HALF_WIDTH - up * HALF_HEIGHT
    p1 = centre + right * HALF_WIDTH - up * HALF_HEIGHT
    p2 = centre + right * HALF_WIDTH + up * HALF_HEIGHT
    p3 = centre - right * HALF_WIDTH + up * HALF_HEIGHT
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata([p0, p1, p2, p3], [], [(0, 3, 2, 1)] if front else [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0, 0), (0, 1), (1, 1), (1, 0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

os.makedirs(OUTPUT_DIR, exist_ok=True)
for card, surfaces in CARDS.items():
    front_mat = make_material("__" + card + "FrontMat", os.path.join(IMAGE_DIR, card + "_RuntimeFront.png"))
    back_mat = make_material("__" + card + "BackMat", os.path.join(IMAGE_DIR, card + "_RuntimeBack.png"))
    front = make_plane("__" + card + "Front", surfaces["front"], FRONT_UP, True, front_mat)
    back = make_plane("__" + card + "Back", surfaces["back"], BACK_UP, False, back_mat)
    bpy.ops.object.select_all(action="DESELECT")
    front.select_set(True); back.select_set(True)
    bpy.context.view_layer.objects.active = front
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUTPUT_DIR, card + "_Card_Angled_v5.glb"),
        export_format="GLB", use_selection=True, export_materials="EXPORT",
        export_image_format="AUTO", export_normals=True, export_yup=True)
    bpy.data.objects.remove(front, do_unlink=True); bpy.data.objects.remove(back, do_unlink=True)
    bpy.data.materials.remove(front_mat, do_unlink=True); bpy.data.materials.remove(back_mat, do_unlink=True)
    print("Exported", card)
