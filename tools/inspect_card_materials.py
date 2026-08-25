import bpy, os
for name in ('Maintenance','HighVoltage','DoNotStep','PoleCut'):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 p=os.path.join('assets','OrdinanceCards','Clean',name+'_Clean.glb')
 bpy.ops.import_scene.gltf(filepath=p)
 print('\n--',name)
 for o in bpy.context.scene.objects:
  if o.type=='MESH': print(o.name, [m.name if m else None for m in o.data.materials])
