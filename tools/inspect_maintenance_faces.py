import bpy
from collections import defaultdict
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'assets/OrdinanceCards/Clean/Maintenance_Clean.glb')
for o in bpy.context.scene.objects:
 if o.type!='MESH': continue
 print('\n',o.name)
 groups=defaultdict(list)
 for p in o.data.polygons:
  n=p.normal
  key=(round(n.x,2),round(n.y,2),round(n.z,2))
  c=o.matrix_world@p.center
  groups[key].append(c)
 for k,cs in sorted(groups.items(),key=lambda kv:-len(kv[1])):
  if len(cs)>3:
   print(k,len(cs),'centroid',tuple(round(sum(c[i] for c in cs)/len(cs),4) for i in range(3)))
