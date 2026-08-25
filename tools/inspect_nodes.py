import bpy
bpy.ops.import_scene.gltf(filepath='assets/OrdinanceCards/Clean/PoleCut_Clean.glb')
for m in bpy.data.materials:
 print(m.name)
 for n in m.node_tree.nodes: print(' ',n.bl_idname,n.name)
 for l in m.node_tree.links: print(' link',l.from_node.name,l.from_socket.name,'=>',l.to_node.name,l.to_socket.name)
