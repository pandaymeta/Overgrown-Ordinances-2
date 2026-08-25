"""Replace No Jaywalking's image artwork with raised ink-only mesh in live Blender.

Run through the Codex Blender bridge.  The physical board stays in place; its
image node is removed and only black/red SVG contours become geometry.
"""

from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(r"C:\Users\Reyjhon Entenia\Documents\LittleFish\Overgrown Rules")
SVG = Path(r"C:\Users\Reyjhon Entenia\Downloads\png2svg\JayWalking.svg")


def image_material_indices(obj):
    return [
        index for index, material in enumerate(obj.data.materials)
        if material and material.use_nodes and any(
            node.type == 'TEX_IMAGE' and node.image for node in material.node_tree.nodes
        )
    ]


def board_triangle(obj, material_indices):
    uv_layer = obj.data.uv_layers.active
    if uv_layer is None:
        return None
    polygons = [
        polygon for polygon in obj.data.polygons
        if polygon.material_index in material_indices and len(polygon.vertices) >= 3
    ]
    if not polygons:
        return None
    polygon = max(polygons, key=lambda candidate: candidate.area)
    loops = list(polygon.loop_indices)
    for offset in range(1, len(loops) - 1):
        a, b, c = loops[0], loops[offset], loops[offset + 1]
        ua, ub, uc = (uv_layer.data[index].uv.copy() for index in (a, b, c))
        determinant = (ub.x - ua.x) * (uc.y - ua.y) - (ub.y - ua.y) * (uc.x - ua.x)
        if abs(determinant) > 1e-6:
            points = [obj.data.vertices[obj.data.loops[index].vertex_index].co.copy() for index in (a, b, c)]
            return (*points, ua, ub, uc, polygon.normal.copy(), determinant)
    return None


def uv_affine(triangle):
    pa, pb, pc, ua, ub, uc, normal, determinant = triangle
    du = ((pb - pa) * (uc.y - ua.y) - (pc - pa) * (ub.y - ua.y)) / determinant
    dv = ((pc - pa) * (ub.x - ua.x) - (pb - pa) * (ub.y - ua.y)) / determinant
    return pa - du * ua.x - dv * ua.y, du, dv, normal.normalized()


def import_svg_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=str(path))
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type in {'CURVE', 'MESH'}]
    points = [obj.matrix_world @ Vector(corner) for obj in imported for corner in obj.bound_box]
    minimum_x, maximum_x = min(point.x for point in points), max(point.x for point in points)
    minimum_y, maximum_y = min(point.y for point in points), max(point.y for point in points)
    span_x, span_y = max(maximum_x - minimum_x, 1e-6), max(maximum_y - minimum_y, 1e-6)
    # Keep the existing board as the sign paper.  The supplied SVG's white
    # path is only its raster background, so it must not become another mesh.
    for obj in list(imported):
        materials = list(getattr(obj.data, 'materials', []))
        if materials and all(
            material and all(channel > 0.97 for channel in material.diffuse_color[:3])
            for material in materials
        ):
            bpy.data.objects.remove(obj, do_unlink=True)
            imported.remove(obj)
    result = []
    for obj in imported:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if obj.type == 'CURVE':
            bpy.ops.object.convert(target='MESH')
        obj = bpy.context.view_layer.objects.active
        obj.select_set(False)
        result.append(obj)
    return result, minimum_x, minimum_y, span_x, span_y


def create_ink_mesh(board):
    material_indices = image_material_indices(board) or list(range(len(board.data.materials)))
    triangle = board_triangle(board, material_indices)
    if triangle is None:
        raise RuntimeError(f'No textured board face found on {board.name}')
    origin, du, dv, normal = uv_affine(triangle)
    imported, min_x, min_y, span_x, span_y = import_svg_meshes(SVG)
    for overlay in imported:
        for vertex in overlay.data.vertices:
            source = overlay.matrix_world @ vertex.co
            source_x = (source.x - min_x) / span_x
            source_y = (source.y - min_y) / span_y
            # Preserve the SVG's authored orientation, while leaving a small,
            # even paper margin between its black frame and the board edge.
            # The supplied SVG already contains a built-in border margin.
            # Add only a hairline gap to keep that frame close to the paper edge.
            inset = 0.012
            u = inset + (1.0 - 2.0 * inset) * source_x
            v = inset + (1.0 - 2.0 * inset) * source_y
            vertex.co = origin + du * u + dv * v + normal * 0.004
        overlay.matrix_world.identity()
        overlay.parent = board
        # The imported board faces point inward in this source model. Put the
        # ink just beyond the physical board, rather than inside its thickness.
        overlay.location.y += 0.022 if board.location.y > 0 else -0.022
        overlay.name = f'NoJaywalking ink {board.name}'
        for material in overlay.data.materials:
            if material:
                material.use_nodes = True
                material.metallic = 0.0
                material.roughness = 0.78
    bpy.ops.object.select_all(action='DESELECT')
    for overlay in imported:
        overlay.select_set(True)
    bpy.context.view_layer.objects.active = imported[0]
    bpy.ops.object.join()
    ink = bpy.context.view_layer.objects.active
    ink.name = f'NoJaywalking ink {board.name}'
    modifier = ink.modifiers.new('Raised ink depth', 'SOLIDIFY')
    modifier.thickness = 0.007
    modifier.offset = 1
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return ink


def add_red_prohibition(board):
    """Create the red ring/slash as real mesh; SVG fill holes are unreliable."""
    material_indices = image_material_indices(board) or list(range(len(board.data.materials)))
    triangle = board_triangle(board, material_indices)
    origin, du, dv, _normal = uv_affine(triangle)
    side = 1.0 if board.location.y > 0 else -1.0
    red = bpy.data.materials.get('NoJaywalking raised red') or bpy.data.materials.new('NoJaywalking raised red')
    red.diffuse_color = (0.88, 0.04, 0.03, 1.0)
    red.use_nodes = True
    principled = next(node for node in red.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    principled.inputs['Base Color'].default_value = (0.88, 0.04, 0.03, 1.0)
    principled.inputs['Roughness'].default_value = 0.72

    def point(u, v):
        value = origin + du * u + dv * v
        value.y += side * 0.026
        return value

    # A ring centered at the pictogram, composed as an annulus (with a true
    # hole) rather than overlapping SVG contour fills.
    import math
    vertices, faces = [], []
    cx, cy, outer, inner, steps = 0.5, 0.365, 0.345, 0.275, 64
    for index in range(steps):
        angle = math.tau * index / steps
        vertices.append(point(cx + outer * math.cos(angle), cy + outer * math.sin(angle)))
        vertices.append(point(cx + inner * math.cos(angle), cy + inner * math.sin(angle)))
    for index in range(steps):
        a, b = 2 * index, 2 * ((index + 1) % steps)
        faces.append((a, b, b + 1, a + 1))

    # Diagonal prohibition slash, expressed as a clean rectangle.
    dx, dy, half_width = 0.52, -0.52, 0.045
    length = (dx * dx + dy * dy) ** 0.5
    nx, ny = -dy / length * half_width, dx / length * half_width
    p1 = (cx - dx / 2, cy - dy / 2)
    p2 = (cx + dx / 2, cy + dy / 2)
    start = len(vertices)
    vertices.extend([point(p1[0] + nx, p1[1] + ny), point(p1[0] - nx, p1[1] - ny), point(p2[0] - nx, p2[1] - ny), point(p2[0] + nx, p2[1] + ny)])
    faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(f'NoJaywalking red art {board.name}')
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(red)
    art = bpy.data.objects.new(f'NoJaywalking red art {board.name}', mesh)
    bpy.context.collection.objects.link(art)
    art.parent = board
    return art


def make_board_paper(board):
    for material in board.data.materials:
        if not material or not material.use_nodes:
            continue
        for node in list(material.node_tree.nodes):
            if node.type == 'TEX_IMAGE':
                material.node_tree.nodes.remove(node)
        principled = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
        if principled:
            principled.inputs['Base Color'].default_value = (0.90, 0.90, 0.88, 1.0)
            principled.inputs['Roughness'].default_value = 0.82
            principled.inputs['Metallic'].default_value = 0.0
        material.diffuse_color = (0.90, 0.90, 0.88, 1.0)


root = bpy.data.objects.get('NoJaywalking')
if root is None:
    raise RuntimeError('NoJaywalking is not loaded in this Blender scene.')
boards = [
    obj for obj in root.children_recursive
    if obj.type == 'MESH' and obj.name.startswith('sign-post-board')
]
if len(boards) != 2:
    raise RuntimeError(f'Expected 2 NoJaywalking boards, found {len(boards)}.')

# Remove any earlier prototype overlays so this is repeatable in the live scene.
for obj in list(root.children_recursive):
    if (obj.name.startswith('NoJaywalking ink ')
            or obj.name.startswith('NoJaywalking red art ')
            or obj.name.startswith('NoJaywalking raised text ')):
        bpy.data.objects.remove(obj, do_unlink=True)

ink_meshes = [create_ink_mesh(board) for board in boards]
red_meshes = []
for board in boards:
    make_board_paper(board)

result = {
    'boards': [board.name for board in boards],
    'ink_meshes': [mesh.name for mesh in ink_meshes],
    'red_meshes': [mesh.name for mesh in red_meshes],
    'svg_has_white_base': '<rect' in SVG.read_text(encoding='utf-8'),
}
