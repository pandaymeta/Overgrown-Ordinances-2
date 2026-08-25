import bpy
import os

SOURCE_IMAGE = r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances\JayWalking.png"
OUTPUT_GLB = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules\assets\generated\JayWalking_Card.glb"

# The existing JayWalking board is 1.64 m wide by 2.05 m high.  This card is
# intentionally inset on all four sides so its graphic never covers the frame.
HALF_WIDTH = 0.790
HALF_HEIGHT = 0.995
FACE_OFFSET = 0.136

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    pass

image = bpy.data.images.load(SOURCE_IMAGE, check_existing=False)
image.pack()

material = bpy.data.materials.new("JayWalking_PNG_Card_Material")
material.use_nodes = True
material.diffuse_color = (1.0, 1.0, 1.0, 1.0)
nodes = material.node_tree.nodes
links = material.node_tree.links
bsdf = nodes.get("Principled BSDF")
tex = nodes.new("ShaderNodeTexImage")
tex.image = image
tex.interpolation = "Linear"
links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
if "Roughness" in bsdf.inputs:
    bsdf.inputs["Roughness"].default_value = 0.88
if "Metallic" in bsdf.inputs:
    bsdf.inputs["Metallic"].default_value = 0.0

def make_face(name, y, front):
    # Local X/Z matches the original sign board. The two faces are deliberately
    # separate, with opposite normals and readable UVs from either side.
    verts = [
        (-HALF_WIDTH, y, -HALF_HEIGHT),
        ( HALF_WIDTH, y, -HALF_HEIGHT),
        ( HALF_WIDTH, y,  HALF_HEIGHT),
        (-HALF_WIDTH, y,  HALF_HEIGHT),
    ]
    faces = [(0, 3, 2, 1)] if front else [(0, 1, 2, 3)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    # Face-loop order mirrors faces above. Image top maps to +Z.
    uvs = [(0, 0), (0, 1), (1, 1), (1, 0)] if front else [(1, 0), (0, 0), (0, 1), (1, 1)]
    for loop, uv in zip(mesh.polygons[0].loop_indices, uvs):
        uv_layer[loop].uv = uv
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

make_face("JayWalking Card Front", FACE_OFFSET, True)
make_face("JayWalking Card Back", -FACE_OFFSET, False)

os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUTPUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_normals=True,
    export_tangents=False,
    export_yup=True,
)
print("EXPORTED", OUTPUT_GLB)
