"""Overlay SVG-derived mesh artwork on every ordinance signboard face.

Each source GLB is backed up before it is replaced. SVG artwork is mapped using
the signboard's authored UV triangle, then given small physical depth so its
letters and symbols are real geometry on both front and back boards.
"""

from datetime import datetime
from pathlib import Path
from shutil import copy2
import bpy
import sys
from mathutils import Vector

GLB_DIR = Path(sys.argv[sys.argv.index('--') + 1])
SVG_DIR = Path(sys.argv[sys.argv.index('--') + 2])
BACKUP_DIR = GLB_DIR.parent / f'_ordinance_vector_mesh_backup_{datetime.now():%Y%m%d_%H%M%S}'
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def texture_material_indices(obj):
    result = []
    for index, material in enumerate(obj.data.materials):
        if not material or not material.use_nodes:
            continue
        if any(node.type == 'TEX_IMAGE' and node.image for node in material.node_tree.nodes):
            result.append(index)
    return result


def largest_textured_triangle(obj, allowed_materials):
    uv_layer = obj.data.uv_layers.active
    if uv_layer is None:
        return None
    best = None
    for polygon in obj.data.polygons:
        if polygon.material_index not in allowed_materials or len(polygon.vertices) < 3:
            continue
        # Board front face is the largest image-mapped polygon.
        if best is None or polygon.area > best.area:
            best = polygon
    if best is None:
        return None
    loops = list(best.loop_indices)
    for offset in range(1, len(loops) - 1):
        a, b, c = loops[0], loops[offset], loops[offset + 1]
        ua = uv_layer.data[a].uv.copy()
        ub = uv_layer.data[b].uv.copy()
        uc = uv_layer.data[c].uv.copy()
        determinant = (ub.x - ua.x) * (uc.y - ua.y) - (ub.y - ua.y) * (uc.x - ua.x)
        if abs(determinant) > 1e-6:
            pa = obj.data.vertices[obj.data.loops[a].vertex_index].co.copy()
            pb = obj.data.vertices[obj.data.loops[b].vertex_index].co.copy()
            pc = obj.data.vertices[obj.data.loops[c].vertex_index].co.copy()
            return pa, pb, pc, ua, ub, uc, best.normal.copy(), determinant
    return None


def uv_affine(triangle):
    pa, pb, pc, ua, ub, uc, normal, determinant = triangle
    du = ((pb - pa) * (uc.y - ua.y) - (pc - pa) * (ub.y - ua.y)) / determinant
    dv = ((pc - pa) * (ub.x - ua.x) - (pb - pa) * (uc.x - ua.x)) / determinant
    origin = pa - du * ua.x - dv * ua.y
    return origin, du, dv, normal.normalized()


def import_svg_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=str(path))
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type in {'CURVE', 'MESH'}]
    if not imported:
        return []
    # Normalize all paths together against the SVG's view bounds before mapping.
    points = []
    for obj in imported:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    min_x, max_x = min(p.x for p in points), max(p.x for p in points)
    min_y, max_y = min(p.y for p in points), max(p.y for p in points)
    span_x, span_y = max(max_x - min_x, 1e-6), max(max_y - min_y, 1e-6)
    meshes = []
    for obj in imported:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if obj.type == 'CURVE':
            bpy.ops.object.convert(target='MESH')
        obj = bpy.context.view_layer.objects.active
        meshes.append((obj, min_x, min_y, span_x, span_y))
        obj.select_set(False)
    return meshes


def overlay_svg_on_board(board, svg_path):
    material_indices = texture_material_indices(board)
    triangle = largest_textured_triangle(board, material_indices)
    if triangle is None:
        return 0
    origin, du, dv, normal = uv_affine(triangle)
    created = []
    for overlay, min_x, min_y, span_x, span_y in import_svg_meshes(svg_path):
        overlay.name = f'Vector Sign Art {board.name}'
        # SVG's top-down y is inverted relative to glTF V.
        for vertex in overlay.data.vertices:
            point = overlay.matrix_world @ vertex.co
            u = (point.x - min_x) / span_x
            v = 1.0 - (point.y - min_y) / span_y
            vertex.co = origin + du * u + dv * v + normal * 0.003
        overlay.matrix_world.identity()
        overlay.parent = board
        for material in overlay.data.materials:
            if material:
                material.use_nodes = True
                material.diffuse_color[3] = 1.0
                material.metallic = 0.0
                material.roughness = 0.78
        created.append(overlay)
    if not created:
        return 0
    # One draw call per board face, rather than one per letter/icon contour.
    bpy.ops.object.select_all(action='DESELECT')
    for overlay in created:
        overlay.select_set(True)
    bpy.context.view_layer.objects.active = created[0]
    bpy.ops.object.join()
    combined = bpy.context.view_layer.objects.active
    combined.name = f'Vector Sign Art {board.name}'
    solidify = combined.modifiers.new('Printed Letter Depth', 'SOLIDIFY')
    solidify.thickness = 0.007
    solidify.offset = 1
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    return 1


def process(glb_path):
    svg = SVG_DIR / f'{glb_path.stem}.svg'
    if not svg.exists():
        print(f'SKIP {glb_path.name}: no SVG source')
        return False
    copy2(glb_path, BACKUP_DIR / glb_path.name)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    boards = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and texture_material_indices(obj)]
    added = sum(overlay_svg_on_board(board, svg) for board in boards)
    if not added:
        print(f'SKIP {glb_path.name}: no mappable signboard faces')
        return False
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', use_selection=True, export_materials='EXPORT')
    print(f'EXPORTED {glb_path.name}: {added} vector-art meshes')
    return True


processed = 0
for model in sorted(GLB_DIR.glob('*.glb')):
    if process(model):
        processed += 1
print(f'COMPLETE: {processed} GLBs exported; backups: {BACKUP_DIR}')
