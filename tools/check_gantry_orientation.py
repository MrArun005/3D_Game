
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="public/models/props/sign_gantry.glb")
obj = bpy.data.objects["props_sign_gantry"]
mesh = obj.data
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print("X span:", min(xs), "to", max(xs), "length:", max(xs) - min(xs))
print("Y span:", min(ys), "to", max(ys), "length:", max(ys) - min(ys))
print("Z span:", min(zs), "to", max(zs), "length:", max(zs) - min(zs))
