"""Print lightweight import facts for a GLB asset."""
import bpy
import sys

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.import_scene.gltf(filepath=path)
print('IMAGES', [(image.name, tuple(image.size)) for image in bpy.data.images])
print('MESHES', [
    (obj.name, len(obj.data.vertices), [material.name if material else None for material in obj.data.materials])
    for obj in bpy.context.scene.objects if obj.type == 'MESH'
])
