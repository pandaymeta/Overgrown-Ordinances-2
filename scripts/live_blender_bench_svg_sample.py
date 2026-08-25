"""Attach the user-supplied Bench.svg as raised mesh art in the live Blender scene.

This is deliberately a Blender-only sample: it does not export or touch Studio.
"""

from pathlib import Path
import bpy
import math
from mathutils import Vector

SVG = Path(r"C:\Users\Reyjhon Entenia\Downloads\png2svg\Bench.svg")
ROOT_NAME = 'Bench'
ART_PREFIX = 'Bench svg ink '


def image_material_indices(obj):
    indices = []
    for index, material in enumerate(obj.data.materials):
        if material and material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    indices.append(index)
                    break
    return indices


def uv_affine(board):
    indices = image_material_indices(board) or list(range(len(board.data.materials)))
    uv = board.data.uv_layers.active
    if uv is None:
        raise RuntimeError(f'{board.name} has no UV map.')
    candidates = []
    for polygon in board.data.polygons:
        if polygon.material_index in indices and len(polygon.vertices) >= 3:
            candidates.append(polygon)
    if not candidates:
        raise RuntimeError(f'No mapped front face found on {board.name}.')
    polygon = max(candidates, key=lambda item: item.area)
    loops = list(polygon.loop_indices)
    for i in range(1, len(loops) - 1):
        ia, ib, ic = loops[0], loops[i], loops[i + 1]
        ua, ub, uc = [uv.data[index].uv.copy() for index in (ia, ib, ic)]
        determinant = (ub.x - ua.x) * (uc.y - ua.y) - (ub.y - ua.y) * (uc.x - ua.x)
        if abs(determinant) > 1e-6:
            pa, pb, pc = [board.data.vertices[board.data.loops[index].vertex_index].co.copy() for index in (ia, ib, ic)]
            du = ((pb - pa) * (uc.y - ua.y) - (pc - pa) * (ub.y - ua.y)) / determinant
            dv = ((pc - pa) * (ub.x - ua.x) - (pb - pa) * (ub.y - ua.y)) / determinant
            return pa - du * ua.x - dv * ua.y, du, dv, polygon.normal.normalized()
    raise RuntimeError(f'Cannot calculate mapped face for {board.name}.')


def import_svg():
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=str(SVG))
    objects = []
    for obj in bpy.data.objects:
        if obj not in before and obj.type in {'CURVE', 'MESH'}:
            objects.append(obj)
    if not objects:
        raise RuntimeError('Blender did not import Bench.svg.')
    corners = []
    for obj in objects:
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    minimum_x = min(point.x for point in corners)
    maximum_x = max(point.x for point in corners)
    minimum_y = min(point.y for point in corners)
    maximum_y = max(point.y for point in corners)
    # The largest path is the raster-traced outer border. Its uneven pixels
    # are what made the top/right edge look skewed. Keep the supplied SVG
    # lettering exactly as-is, but replace only that non-text contour below.
    frame = max(objects, key=lambda obj: (obj.dimensions.x * obj.dimensions.y))
    objects.remove(frame)
    bpy.data.objects.remove(frame, do_unlink=True)
    converted = []
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if obj.type == 'CURVE':
            bpy.ops.object.convert(target='MESH')
        obj = bpy.context.view_layer.objects.active
        obj.select_set(False)
        converted.append(obj)
    return converted, minimum_x, minimum_y, max(maximum_x - minimum_x, 1e-6), max(maximum_y - minimum_y, 1e-6)


def remove_image_nodes(board):
    for material in board.data.materials:
        if material and material.use_nodes:
            for node in list(material.node_tree.nodes):
                if node.type == 'TEX_IMAGE':
                    material.node_tree.nodes.remove(node)
            shader = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
            if shader:
                shader.inputs['Base Color'].default_value = (0.90, 0.90, 0.88, 1.0)
                shader.inputs['Roughness'].default_value = 0.82


def add_board_derived_outline(board):
    material = bpy.data.materials.get('Bench precise black frame')
    if material is None:
        material = bpy.data.materials.new('Bench precise black frame')
        material.use_nodes = True
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        shader.inputs['Base Color'].default_value = (0.006, 0.006, 0.006, 1.0)
        shader.inputs['Roughness'].default_value = 0.76

    # Use an enlarged copy of the actual rounded board mesh as the outline.
    # The white board stays in front; this black copy appears only around its
    # edge, exactly following every original corner and bevel.
    outline = board.copy()
    outline.data = board.data.copy()
    outline.name = 'Bench board-derived outline ' + board.name
    outline.parent = board.parent
    outline.matrix_parent_inverse = board.matrix_parent_inverse.copy()
    outline.matrix_world = board.matrix_world.copy()
    outline.scale.x *= 1.012
    outline.scale.z *= 1.012
    outline.data.materials.clear()
    outline.data.materials.append(material)
    bpy.context.collection.objects.link(outline)
    # Offset each backing toward the sign centre. The original white board
    # remains in front, exposing only the enlarged black perimeter.
    outline.location.y += -0.015 if board.name.endswith('front') else 0.015
    return outline


def apply_svg_to_board(board):
    origin, du, dv, normal = uv_affine(board)
    parts, min_x, min_y, span_x, span_y = import_svg()
    for part in parts:
        for vertex in part.data.vertices:
            source = part.matrix_world @ vertex.co
            # The imported SVG's outer stroke extends beyond the board's
            # nominal rectangle.  Fit that measured contour to the board face
            # itself so its black rim ends exactly at the physical edge.
            source_u = (source.x - min_x) / span_x
            source_v = (source.y - min_y) / span_y
            u = 0.01315 + 0.97370 * source_u
            v = 0.01785 + 0.96430 * source_v
            vertex.co = origin + du * u + dv * v + normal * 0.004
        part.matrix_world.identity()
        part.parent = board
        part.name = ART_PREFIX + board.name
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    art = bpy.context.view_layer.objects.active
    art.name = ART_PREFIX + board.name
    solidify = art.modifiers.new('Raised SVG depth', 'SOLIDIFY')
    solidify.thickness = 0.006
    solidify.offset = 1
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    remove_image_nodes(board)
    add_board_derived_outline(board)
    return art


root = bpy.data.objects.get(ROOT_NAME)
if root is None:
    raise RuntimeError(f'{ROOT_NAME} is not loaded.')
for obj in list(root.children_recursive):
    if obj.name.startswith(ART_PREFIX) or obj.name.startswith('Bench precise frame ') or obj.name.startswith('Bench board-derived outline '):
        bpy.data.objects.remove(obj, do_unlink=True)
boards = [obj for obj in root.children_recursive if obj.type == 'MESH' and obj.name in {'Bench-board-front', 'Bench-board-back'}]
if len(boards) != 2:
    raise RuntimeError(f'Expected two Bench boards, found {[obj.name for obj in boards]}.')
art = []
for board in boards:
    art.append(apply_svg_to_board(board).name)
result = {'boards': [board.name for board in boards], 'art': art}
