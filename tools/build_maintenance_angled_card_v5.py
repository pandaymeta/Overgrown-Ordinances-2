import bpy
import os
from mathutils import Vector

# Maintenance is a landscape, two-board A-frame sign.  This script deliberately
# transforms source pixels (not UV coordinates), then uses the normal UV layout
# on two planes fitted to the clean board surfaces.
IMAGE_DIR = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\BenchStandardCardImages"
OUTPUT = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\OrdinanceCards\v5\Maintenance_Card_Angled_v5.glb"
FRONT_SOURCE = os.path.join(IMAGE_DIR, "Maintenance_RuntimeFront.png")
BACK_SOURCE = os.path.join(IMAGE_DIR, "Maintenance_RuntimeBack.png")

# Preserve the existing card art footprint, rotated for this landscape board:
# the original upright 1.64 x 2.05 card becomes 2.05 x 1.64 here.
# Preserve the existing artwork dimensions; only its placement is adjusted.
HALF_WIDTH = 1.025
HALF_HEIGHT = 0.820
# Measured from Maintenance_Clean.glb, then offset from each opaque board face.
# Shifted slightly left to match each board's visual centre, without scaling.
FRONT_CENTRE = Vector((0.0500, 0.3187, 0.7386))
BACK_CENTRE = Vector((0.0500, -0.3705, 0.7371))
FRONT_UP = Vector((0.0, -0.342, 0.940))
BACK_UP = Vector((0.0, 0.342, 0.940))

def rotate_bitmap(path, clockwise, name):
    source = bpy.data.images.load(path, check_existing=False)
    # Rotate source pixels only. The UV coordinates on the exported planes
    # remain the standard four-corner mapping.
    width, height = source.size
    pixels = list(source.pixels[:])
    output = bpy.data.images.new(name, height, width, alpha=True)
    result = [0.0] * len(pixels)
    for y in range(height):
        for x in range(width):
            src = (y * width + x) * 4
            if clockwise:
                # Clockwise: (x, y) -> (height - 1 - y, x).
                dx, dy = height - 1 - y, x
            else:
                # Counter-clockwise: (x, y) -> (y, width - 1 - x).
                dx, dy = y, width - 1 - x
            dst = (dy * height + dx) * 4
            result[dst:dst + 4] = pixels[src:src + 4]
    output.pixels.foreach_set(result)
    output.pack()
    bpy.data.images.remove(source, do_unlink=True)
    return output

def rotated_front_image():
    # The prior clockwise rotation displayed upside-down on the front board.
    # Counter-clockwise makes the final card upright.
    return rotate_bitmap(FRONT_SOURCE, False, "__MaintenanceFrontLandscape")

def rotated_back_image():
    # The current back is upright but upside-down. Counter-clockwise from the
    # source is a 180-degree correction from the previous clockwise output.
    return rotate_bitmap(BACK_SOURCE, False, "__MaintenanceBackLandscape")

def material(name, image):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.88
    try: mat.surface_render_method = "DITHERED"
    except Exception: pass
    return mat

def plane(name, centre, up, front, mat):
    right = Vector((1, 0, 0))
    verts = [centre - right*HALF_WIDTH - up*HALF_HEIGHT,
             centre + right*HALF_WIDTH - up*HALF_HEIGHT,
             centre + right*HALF_WIDTH + up*HALF_HEIGHT,
             centre - right*HALF_WIDTH + up*HALF_HEIGHT]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], [(0, 3, 2, 1)] if front else [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(mesh.polygons[0].loop_indices, [(0, 0), (0, 1), (1, 1), (1, 0)]):
        mesh.uv_layers.active.data[loop].uv = uv
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

front_image = rotated_front_image()
back_image = rotated_back_image()
front = plane("__MaintenanceAngledFront", FRONT_CENTRE, FRONT_UP, True, material("__MaintenanceAngledFrontMat", front_image))
back = plane("__MaintenanceAngledBack", BACK_CENTRE, BACK_UP, False, material("__MaintenanceAngledBackMat", back_image))
bpy.ops.object.select_all(action="DESELECT")
front.select_set(True); back.select_set(True); bpy.context.view_layer.objects.active = front
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format="GLB", use_selection=True,
    export_materials="EXPORT", export_image_format="AUTO", export_normals=True, export_yup=True)
print(OUTPUT)
