
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="public/models/props/traffic_signal.glb")
for obj in bpy.data.objects:
    print("Object:", obj.name, "Dimensions:", obj.dimensions, "Location:", obj.location)
