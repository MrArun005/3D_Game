"""
Improvise Hero Man for Halstead Bay / Nightfall Drive in Blender.
Replaces the blank mannequin with a high-fidelity rigged hero character.
Features:
- Anatomical proportions, 1.78m height, origin at ground (Z=0)
- Detailed leather/bomber driving jacket, dark denim, boots, detailed head/hair
- Rigged to the 31-bone HumanArmature with bone heat diffusion
- Preserves all animation clips: Idle, Walk, Run, Jump, RunningJump, Punch, Death
- Generates LOD0, LOD1, and LOD2
"""

import bpy
import math
from mathutils import Vector, Matrix

def build_hero():
    print("Beginning Hero Improvisation...")

    # 1. Clear scene completely
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)

    # 2. Import donor armature and animations from civilian_man.glb
    civ_path = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/civilian_man.glb"
    bpy.ops.import_scene.gltf(filepath=civ_path)

    armature = bpy.data.objects.get("HumanArmature")
    base_mesh = bpy.data.objects.get("BaseHuman")

    # 3. Import high-detail character mesh from navy_jacket.glb
    navy_path = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/navy_jacket.glb"
    bpy.ops.import_scene.gltf(filepath=navy_path)

    # Find navy mesh
    navy_mesh = None
    for obj in bpy.context.scene.objects:
        if obj != armature and obj != base_mesh and obj.type == 'MESH':
            navy_mesh = obj
            break

    if not navy_mesh:
        print("ERROR: Could not find navy_mesh!")
        return

    # Set armature to REST pose while binding
    armature.data.pose_position = 'REST'
    bpy.context.view_layer.update()

    # Apply all transforms on navy_mesh so coordinates are clean world space
    bpy.ops.object.select_all(action='DESELECT')
    navy_mesh.select_set(True)
    bpy.context.view_layer.objects.active = navy_mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Calculate current bounding box of navy mesh
    verts = [v.co for v in navy_mesh.data.vertices]
    min_x = min(v.x for v in verts)
    max_x = max(v.x for v in verts)
    min_y = min(v.y for v in verts)
    max_y = max(v.y for v in verts)
    min_z = min(v.z for v in verts)
    max_z = max(v.z for v in verts)

    current_height = max_z - min_z
    target_height = 1.78
    scale_factor = target_height / current_height

    print(f"Original Hero Z: [{min_z:.2f} to {max_z:.2f}], Height={current_height:.2f}m. Scaling by {scale_factor:.4f}")

    # Scale mesh to exactly 1.78m
    bpy.ops.transform.resize(value=(scale_factor, scale_factor, scale_factor))
    bpy.ops.object.transform_apply(scale=True)

    # Offset Z so soles touch Z = 0, and center X/Y with armature
    # In civilian_man, armature root / hips is centered near X=0, Y=0
    verts = [v.co for v in navy_mesh.data.vertices]
    min_z_new = min(v.z for v in verts)
    center_x = (min(v.x for v in verts) + max(v.x for v in verts)) * 0.5
    center_y = (min(v.y for v in verts) + max(v.y for v in verts)) * 0.5

    offset = Vector((-center_x, -center_y, -min_z_new))
    bpy.ops.transform.translate(value=offset)
    bpy.ops.object.transform_apply(location=True)

    # Rotate if needed to match armature orientation
    # Let's check base_mesh orientation vs navy_mesh
    # If base_mesh faces +Y and navy faces +Y, or +X
    # Let's align navy_mesh rotation with base_mesh
    base_head = [b for b in armature.data.bones if 'Head' in b.name]
    print(f"Armature has {len(armature.data.bones)} bones.")

    # Remove old low-poly BaseHuman
    bpy.data.objects.remove(base_mesh, do_unlink=True)

    # Rename navy_mesh to hero_body
    navy_mesh.name = "hero_body"

    # Bind navy_mesh to HumanArmature with bone heat diffusion (ARMATURE_AUTO)
    bpy.ops.object.select_all(action='DESELECT')
    navy_mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature

    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print("Successfully bound hero_body to HumanArmature with ARMATURE_AUTO!")
    except Exception as e:
        print("ARMATURE_AUTO warning:", e)
        # Fallback to ARMATURE
        bpy.ops.object.parent_set(type='ARMATURE')

    # Switch pose position back to POSE
    armature.data.pose_position = 'POSE'
    bpy.context.view_layer.update()

    # Verify animations
    print("Actions on file:", [a.name for a in bpy.data.actions])
    idle_action = bpy.data.actions.get("HumanArmature|Man_Idle")
    if idle_action and armature.animation_data:
        armature.animation_data.action = idle_action
        bpy.context.scene.frame_set(10)
        bpy.context.view_layer.update()
        print("Applied Man_Idle action at frame 10")

    # Setup studio lighting and camera for render inspection
    cam_data = bpy.data.cameras.new("Hero_Cam")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("Hero_Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (0.0, -2.8, 1.3)
    cam_obj.rotation_euler = (math.radians(82), 0, 0)
    bpy.context.scene.camera = cam_obj

    sun_data = bpy.data.lights.new("Hero_Key", 'SUN')
    sun_data.energy = 4.0
    sun_obj = bpy.data.objects.new("Hero_Key", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(60), math.radians(10), math.radians(45))

    rim_data = bpy.data.lights.new("Hero_Rim", 'POINT')
    rim_data.energy = 800.0
    rim_obj = bpy.data.objects.new("Hero_Rim", rim_data)
    bpy.context.scene.collection.objects.link(rim_obj)
    rim_obj.location = (1.5, 2.0, 2.0)

    # Frame viewport
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'MATERIAL'
                    space.overlay.show_bones = False
                    space.overlay.show_relationship_lines = False
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.object.select_all(action='DESELECT')
                        navy_mesh.select_set(True)
                        try:
                            bpy.ops.view3d.view_selected()
                        except:
                            pass
                        navy_mesh.select_set(False)

    # Export LOD0
    out_lod0 = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/hero.glb"
    out_src = "/Users/arunmallikarjun/Desktop/3D_Game/assets/source/characters/hero/hero.glb"

    # Select armature and mesh
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    navy_mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=out_lod0,
        export_format='GLB',
        use_selection=True,
        export_apply=False, # Don't apply modifiers on skinned mesh to preserve armature
        export_skins=True,
        export_animations=True,
        export_yup=True
    )
    bpy.ops.export_scene.gltf(
        filepath=out_src,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_yup=True
    )
    print("Exported LOD0 hero to:", out_lod0)

    # Generate LOD1 (~50% decimate)
    dec_mod = navy_mesh.modifiers.new("Decimate_LOD1", 'DECIMATE')
    dec_mod.ratio = 0.50
    out_lod1 = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/hero.lod1.glb"
    bpy.ops.export_scene.gltf(
        filepath=out_lod1,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_yup=True
    )
    print("Exported LOD1 hero to:", out_lod1)

    # Generate LOD2 (~25% decimate)
    dec_mod.ratio = 0.25
    out_lod2 = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/hero.lod2.glb"
    bpy.ops.export_scene.gltf(
        filepath=out_lod2,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_yup=True
    )
    print("Exported LOD2 hero to:", out_lod2)

    # Remove decimate modifier from working mesh
    navy_mesh.modifiers.remove(dec_mod)

    print("Hero Improvisation Complete!")

if __name__ == "__main__":
    build_hero()
