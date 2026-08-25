import bpy
bpy.ops.import_scene.gltf(filepath='assets/PolyforkAssets/utilitypole/utility-pole-14.glb')
for o in bpy.context.scene.objects:
 if o.type=='MESH': print(o.name, [m.name if m else None for m in o.data.materials])
