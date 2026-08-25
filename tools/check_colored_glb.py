import bpy
for f in ('assets/generated/OrdinanceCards/coloured/PoleCut_Board.glb','assets/generated/OrdinanceCards/coloured/Maintenance_Board.glb'):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=f)
 print('\n', f)
 for o in bpy.context.scene.objects:
  if o.type=='MESH':
   for m in o.data.materials:
    bsdf=m.node_tree.nodes.get('Principled BSDF')
    print(o.name,m.name, list(bsdf.inputs['Base Color'].default_value) if bsdf else None)
