import bpy
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
glb_path, output_path, side = args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)

target = Vector((0, 0, 2.55))
camera_data = bpy.data.cameras.new('Check Camera')
camera = bpy.data.objects.new('Check Camera', camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = Vector((0, -6 if side == 'back' else 6, 2.55))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
camera_data.lens = 55

world = bpy.data.worlds.new('World')
world.color = (0.05, 0.05, 0.05)
bpy.context.scene.world = world
light_data = bpy.data.lights.new('Key', 'AREA')
light_data.energy = 1200
light_data.shape = 'DISK'
light_data.size = 5
light = bpy.data.objects.new('Key', light_data)
light.location = (0, -3 if side == 'back' else 3, 4)
bpy.context.scene.collection.objects.link(light)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 600
scene.render.resolution_y = 700
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output_path
bpy.ops.wm.save_as_mainfile(filepath=output_path + '.blend')
bpy.ops.render.render(write_still=True)
