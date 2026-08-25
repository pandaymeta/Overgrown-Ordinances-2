import bpy
for f in ('assets/generated/OrdinanceCards/coloured/PoleCut_Board.glb','assets/generated/OrdinanceCards/coloured/Maintenance_Board.glb'):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=f)
 print(f)
 for o in bpy.context.scene.objects:
  if o.type=='MESH':
   a=o.data.color_attributes.active_color
   print(o.name, tuple(round(x,3) for x in a.data[0].color) if a else 'NO_COLOR')
