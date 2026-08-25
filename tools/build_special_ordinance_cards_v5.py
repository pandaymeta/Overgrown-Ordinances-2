import bpy
import os

# The three special ordinance faces are supplied directly by the user.  Build
# them using the exact plane size, face separation and UV convention used by
# the regular v5 cards so they can share the same scene placement.
IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v5"
# Dimensions and offsets are measured from each clean board mesh, not copied
# from Bench. Values are half extents in Blender's X/Z card plane.
CARDS = {
    "JayWalking": {"half_width": 0.820, "half_height": 1.025, "face_offset": 0.137},
    # Keep the image size intact; lower it slightly to expose the requested
    # lower-edge gap on the triangular High Voltage board.
    "HighVoltage": {"half_width": 0.627155, "half_height": 0.525, "face_offset": 0.018, "z_shift": -0.040},
    "DoNotStep": {"half_width": 0.525, "half_height": 0.525, "face_offset": 0.032},
}

os.makedirs(OUTPUT_DIR, exist_ok=True)

def material(name, image_path):
    image = bpy.data.images.load(image_path, check_existing=False)
    image.pack()
    result = bpy.data.materials.new(name)
    result.use_nodes = True
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

def face(name, y, front, mat, half_width, half_height, z_shift=0.0):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(
        [(-half_width, y, -half_height + z_shift), (half_width, y, -half_height + z_shift),
         (half_width, y, half_height + z_shift), (-half_width, y, half_height + z_shift)],
        [], [(0, 3, 2, 1)] if front else [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0, 0), (0, 1), (1, 1), (1, 0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

results = []
for card, size in CARDS.items():
    # Prepared by prepare_special_ordinance_card_images.py. Both files are
    # pixel-baked; their UVs remain the standard static card layout.
    front_path = os.path.join(IMAGE_DIR, card + "_RuntimeFront.png")
    back_path = os.path.join(IMAGE_DIR, card + "_RuntimeBack.png")
    front_mat = material("__CardV5_" + card + "_FrontMat", front_path)
    back_mat = material("__CardV5_" + card + "_BackMat", back_path)
    front = face("__CardV5_" + card + "_Front", size["face_offset"], True, front_mat,
                 size["half_width"], size["half_height"], size.get("z_shift", 0.0))
    back = face("__CardV5_" + card + "_Back", -size["face_offset"], False, back_mat,
                size["half_width"], size["half_height"], size.get("z_shift", 0.0))
    bpy.ops.object.select_all(action="DESELECT")
    front.select_set(True)
    back.select_set(True)
    bpy.context.view_layer.objects.active = front
    output = os.path.join(OUTPUT_DIR, card + "_Card_Upright_v5.glb")
    bpy.ops.export_scene.gltf(
        filepath=output, export_format="GLB", use_selection=True,
        export_materials="EXPORT", export_image_format="AUTO",
        export_normals=True, export_yup=True)
    bpy.data.objects.remove(front, do_unlink=True)
    bpy.data.objects.remove(back, do_unlink=True)
    bpy.data.materials.remove(front_mat, do_unlink=True)
    bpy.data.materials.remove(back_mat, do_unlink=True)
    results.append(card + ": " + output)

result = "\n".join(results)
