
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="public/models/props/sign_gantry.glb")
for obj in bpy.data.objects:
    print("obj:", obj.name, "matrix_world:", obj.matrix_world)
    bbox = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [v.x for v in bbox]
    ys = [v.y for v in bbox]
    zs = [v.z for v in bbox]
    print("World X:", min(xs), "to", max(xs), "span:", max(xs) - min(xs))
    print("World Y:", min(ys), "to", max(ys), "span:", max(ys) - min(ys))
    print("World Z (Blender up):", min(zs), "to", max(zs), "span:", max(zs) - min(zs))
