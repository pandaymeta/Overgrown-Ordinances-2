import bpy
import os

IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT_DIR = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v7"
OUTPUT = os.path.join(OUTPUT_DIR, "PoleCut_Card_White_v7.glb")

# Measured directly from PoleCut_Clean.glb's front/back board meshes.  These
# are intentionally not the generic Bench card dimensions: PoleCut's board is
# offset on its local X axis.
X_MIN, X_MAX = -0.887272, 0.752728
# The overlay node is already positioned at the board centre. Keep the
# measured horizontal offset, but express vertical bounds around that origin.
Z_MIN, Z_MAX = -1.025, 1.025
# PoleCut's actual board surfaces sit at roughly +/- 0.202.  Keep both baked
# images unchanged and move their existing planes just outside those surfaces.
FACE_OFFSET = 0.214

def make_material(name, image_path, flip_vertical=False, flip_horizontal=False):
    image = white_art(image_path, name + "Image", flip_vertical, flip_horizontal)
    image.pack()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    material.node_tree.links.new(texture.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.88
    try:
        material.surface_render_method = "DITHERED"
    except Exception:
        pass
    return material

def white_art(image_path, name, flip_vertical=False, flip_horizontal=False):
    """Bake artwork into white ink; all orientation changes are pixel data."""
    source = bpy.data.images.load(image_path, check_existing=False)
    pixels = list(source.pixels[:])
    if flip_vertical or flip_horizontal:
        # Reorder raster pixels only. The mesh geometry and the UV map below
        # deliberately remain unchanged, so Sandbox cannot reinterpret this
        # correction as a UV orientation change.
        width, height = source.size
        transformed = [0.0] * len(pixels)
        for y in range(height):
            for x in range(width):
                source_index = (y * width + x) * 4
                target_y = height - 1 - y if flip_vertical else y
                target_x = width - 1 - x if flip_horizontal else x
                target_index = (target_y * width + target_x) * 4
                transformed[target_index:target_index + 4] = pixels[source_index:source_index + 4]
        pixels = transformed
    # The ordinance bitmaps use transparency around the black lettering and
    # outline. Preserve each pixel's alpha but make the visible ink white.
    for i in range(0, len(pixels), 4):
        if pixels[i + 3] > 0.01:
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 1.0
    # Save a physically new PNG first.  Merely packing a modified source image
    # lets some GLB consumers resolve the old file URI and show black ink.
    # A new bitmap path guarantees the white artwork is the encoded source.
    source.pixels.foreach_set(pixels)
    source.update()
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    source.filepath_raw = os.path.join(OUTPUT_DIR, name + ".png")
    source.file_format = "PNG"
    source.save()
    baked = bpy.data.images.load(source.filepath_raw, check_existing=False)
    bpy.data.images.remove(source)
    baked.name = name
    baked.pack()
    return baked

def make_face(name, y, front, material):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(
        [(X_MIN, y, Z_MIN), (X_MAX, y, Z_MIN),
         (X_MAX, y, Z_MAX), (X_MIN, y, Z_MAX)], [],
        [(0, 3, 2, 1)] if front else [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0, 0), (0, 1), (1, 1), (1, 0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

front_path = os.path.join(IMAGE_DIR, "PoleCut_RuntimeFront.png")
back_path = os.path.join(IMAGE_DIR, "PoleCut_RuntimeBack.png")
# The back bitmap is now correct. Correct only the front's mirror by flipping
# the baked bitmap horizontally; UVs and geometry remain fixed.
front_mat = make_material("__PoleCutFrontMat", front_path, flip_horizontal=True)
back_mat = make_material("__PoleCutBackMat", back_path, flip_vertical=True, flip_horizontal=True)
front = make_face("__PoleCutFront", FACE_OFFSET, True, front_mat)
back = make_face("__PoleCutBack", -FACE_OFFSET, False, back_mat)
bpy.ops.object.select_all(action="DESELECT")
front.select_set(True)
back.select_set(True)
bpy.context.view_layer.objects.active = front
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format="GLB", use_selection=True,
                          export_materials="EXPORT", export_image_format="AUTO",
                          export_normals=True, export_yup=True)
print("Exported", OUTPUT)
