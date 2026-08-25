import bpy
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--') + 1])
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    materials = [m.name for m in obj.data.materials if m]
    if not any('SignBoard' in name for name in materials):
        continue
    corners = [obj.matrix_world @ __import__('mathutils').Vector(corner) for corner in obj.bound_box]
    lower = [min(point[i] for point in corners) for i in range(3)]
    upper = [max(point[i] for point in corners) for i in range(3)]
    print(obj.name, 'bounds', lower, upper, 'dims', [round(upper[i]-lower[i], 3) for i in range(3)], 'loc', list(obj.location), 'rot', list(obj.rotation_euler))
