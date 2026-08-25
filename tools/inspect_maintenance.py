import bpy
p=r'assets/OrdinanceCards/Clean/Maintenance_Clean.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=p)
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  vs=[o.matrix_world@v.co for v in o.data.vertices]
  mn=[min(v[i] for v in vs) for i in range(3)]; mx=[max(v[i] for v in vs) for i in range(3)]
  print(o.name, 'verts',len(vs),'bounds',mn,mx)
  # normals group
  print(' normals', [(round(p.normal.x,3),round(p.normal.y,3),round(p.normal.z,3)) for p in list(o.data.polygons)[:8]])
