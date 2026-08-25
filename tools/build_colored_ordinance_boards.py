import bpy
import os

ROOT = r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules"
CLEAN = os.path.join(ROOT, "assets", "OrdinanceCards", "Clean")
OUT = os.path.join(ROOT, "assets", "generated", "OrdinanceCards", "coloured")
UTILITY = os.path.join(ROOT, "assets", "PolyforkAssets", "utilitypole", "utility-pole-14.glb")

# Soft road-sign yellow rather than a fully saturated safety-yellow.  These are
# baked into copies of the clean models, so no runtime texture/UV transform is
# involved.
YELLOW = (0.93, 0.70, 0.12, 1.0)
WHITE = (0.96, 0.96, 0.94, 1.0)
LIGHT_RED = (0.78, 0.28, 0.28, 1.0)

os.makedirs(OUT, exist_ok=True)

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes):
        for item in list(block):
            if item.users == 0:
                block.remove(item)

def color(mat, rgba):
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        # These are the blank physical boards.  Artwork is supplied by the
        # separate, pixel-baked card GLB, so retaining an old image texture
        # here produces a second, offset copy of the sign graphic.
        for node in list(mat.node_tree.nodes):
            if node.type == "TEX_IMAGE":
                mat.node_tree.nodes.remove(node)
        # Do not leave a prior shader graph connected to the base colour or
        # alpha inputs after removing its image node.
        for input_name in ("Base Color", "Alpha"):
            for link in list(bsdf.inputs[input_name].links):
                mat.node_tree.links.remove(link)
        bsdf.inputs["Base Color"].default_value = rgba
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.88
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0

def color_mesh_vertices(obj, rgba):
    """The clean board material reads COLOR_0, so tint that data directly."""
    if obj.type != "MESH":
        return
    for attribute in obj.data.color_attributes:
        if attribute.data_type in {"FLOAT_COLOR", "BYTE_COLOR"}:
            for value in attribute.data:
                value.color = rgba

def export_selected(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_materials="EXPORT", export_image_format="AUTO",
                              export_normals=True, export_yup=True)

def make_board_copy(name, rgba):
    clear()
    clean_path = os.path.join(CLEAN, name + "_Clean.glb")
    # Some of the early clean-source files were intentionally removed during
    # asset cleanup.  Rebuild the active board in place from its existing
    # coloured copy, then strip its inherited artwork below.
    source_path = clean_path if os.path.exists(clean_path) else os.path.join(OUT, name + "_Board_v2.glb")
    bpy.ops.import_scene.gltf(filepath=source_path)
    # Every mesh in the clean sign file is a board face. Keep its original
    # geometry and material assignments; change only the material's base tint.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            color_mesh_vertices(obj, rgba)
            for mat in obj.data.materials:
                if mat:
                    color(mat, rgba)
    # Versioned output forces Sandbox Studio to reload the baked colour data.
    export_selected(os.path.join(OUT, name + "_Board_v2.glb"))

for sign in ("Maintenance", "HighVoltage", "DoNotStep"):
    make_board_copy(sign, YELLOW)

# PoleCut uses the requested light-red board. Its black artwork is separately
# converted to white in build_polecut_card_v5.py.
make_board_copy("PoleCut", LIGHT_RED)

# Make local red variants only for the utility poles that carry the PoleCut
# ordinance. Preserve each original pole model's geometry; only the pole mesh
# itself is recoloured (the base remains unchanged).
for source_name in ("utility-pole-14", "utility-pole-15", "utility-pole-16"):
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(UTILITY), source_name + ".glb"))
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and "utility-pole" in obj.name.lower():
            for mat in obj.data.materials:
                if mat:
                    color(mat, LIGHT_RED)
    export_selected(os.path.join(OUT, source_name + "_LightRed.glb"))

print("Created coloured ordinance board variants in", OUT)
