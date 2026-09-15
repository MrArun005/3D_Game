"""
Rig High-Fidelity Hero Character for Halstead Bay / Nightfall Drive.
- Fits into 12,000 triangle budget for characters (docs/BUDGETS.md)
- Exactly 1.78m height, ground origin Z=0
- High-quality jacket, pants, head, shoes
- Weight transfer from Quaternius reference rig
- Preserves all 11 animation actions
"""

import bpy
import os
import math
from mathutils import Vector

def rig_hero():
    print("Starting Hero Rigging Process...")

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 1. Import reference donor with rig and animations
    donor_path = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/civilian_man.glb"
    bpy.ops.import_scene.gltf(filepath=donor_path)

    armature = bpy.data.objects.get("HumanArmature")
    base_mesh = bpy.data.objects.get("BaseHuman")

    # Set to rest pose
    armature.data.pose_position = 'REST'
    bpy.context.view_layer.update()

    # 2. Import high detail hero mesh
    navy_path = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/navy_jacket.glb"
    bpy.ops.import_scene.gltf(filepath=navy_path)

    navy_mesh = None
    for obj in bpy.context.scene.objects:
        if obj != armature and obj != base_mesh and obj.type == 'MESH':
            navy_mesh = obj
            break

    print(f"Found hero mesh: {navy_mesh.name}, verts: {len(navy_mesh.data.vertices)}")

    # Apply transform on navy mesh
    bpy.ops.object.select_all(action='DESELECT')
    navy_mesh.select_set(True)
    bpy.context.view_layer.objects.active = navy_mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Calculate height and scale to 1.78m
    verts = [v.co for v in navy_mesh.data.vertices]
    min_z = min(v.z for v in verts)
    max_z = max(v.z for v in verts)
    h = max_z - min_z
    scale_factor = 1.78 / h

    navy_mesh.scale = (scale_factor, scale_factor, scale_factor)
    bpy.ops.object.transform_apply(scale=True)

    # Center in X and Y, and place feet at Z = 0
    verts = [v.co for v in navy_mesh.data.vertices]
    min_z_new = min(v.z for v in verts)
    mid_x = (min(v.x for v in verts) + max(v.x for v in verts)) * 0.5
    mid_y = (min(v.y for v in verts) + max(v.y for v in verts)) * 0.5

    offset = Vector((-mid_x, -mid_y, -min_z_new))
    navy_mesh.location = offset
    bpy.ops.object.transform_apply(location=True)

    # Decimate to fit budget (target: ~11,500 tris)
    current_polys = len(navy_mesh.data.polygons)
    print(f"Current polygons: {current_polys}")
    target_polys = 6000 # ~12,000 tris
    if current_polys > target_polys:
        ratio = target_polys / current_polys
        dec = navy_mesh.modifiers.new("Decimate_Budget", 'DECIMATE')
        dec.ratio = ratio
        bpy.ops.object.modifier_apply(modifier="Decimate_Budget")
        print(f"Decimated to: {len(navy_mesh.data.polygons)} polygons (~{len(navy_mesh.data.polygons)*2} tris)")

    # Transfer vertex weights from BaseHuman to navy_mesh
    # First create vertex groups on navy_mesh matching base_mesh
    for vg in base_mesh.vertex_groups:
        navy_mesh.vertex_groups.new(name=vg.name)

    dt = navy_mesh.modifiers.new("Weights_Transfer", 'DATA_TRANSFER')
    dt.object = base_mesh
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    
    # Generate data layout and apply
    bpy.ops.object.datalayout_transfer(modifier="Weights_Transfer")
    bpy.ops.object.modifier_apply(modifier="Weights_Transfer")
    print("Transferred all vertex groups and weights!")

    # Parent to armature
    arm_mod = navy_mesh.modifiers.new("Armature", 'ARMATURE')
    arm_mod.object = armature
    navy_mesh.parent = armature

    # Delete reference BaseHuman
    bpy.data.objects.remove(base_mesh, do_unlink=True)

    # Set pose back to POSE
    armature.data.pose_position = 'POSE'
    bpy.context.view_layer.update()

    # Rename mesh
    navy_mesh.name = "hero_body"

    # Fix material name for ART_BIBLE compliance
    if len(navy_mesh.data.materials) > 0 and navy_mesh.data.materials[0]:
        mat = navy_mesh.data.materials[0]
        mat.name = "cloth_shirt"
    else:
        mat = bpy.data.materials.new(name="cloth_shirt")
        navy_mesh.data.materials.append(mat)

    # Export LOD0
    out_lod0 = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/characters/hero.glb"
    out_src = "/Users/arunmallikarjun/Desktop/3D_Game/assets/source/characters/hero/hero.glb"

    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    navy_mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature

    print("Exporting LOD0...")
    bpy.ops.export_scene.gltf(
        filepath=out_lod0,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
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

    # Create LOD1 (~6,000 tris)
    print("Creating and exporting LOD1...")
    lod1_mesh = navy_mesh.copy()
    lod1_mesh.data = navy_mesh.data.copy()
    bpy.context.scene.collection.objects.link(lod1_mesh)

    bpy.ops.object.select_all(action='DESELECT')
    lod1_mesh.select_set(True)
    bpy.context.view_layer.objects.active = lod1_mesh
    dec1 = lod1_mesh.modifiers.new("Decimate_LOD1", 'DECIMATE')
    dec1.ratio = 0.50
    bpy.ops.object.modifier_apply(modifier="Decimate_LOD1")

    lod1_mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
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
    bpy.data.objects.remove(lod1_mesh, do_unlink=True)

    # Create LOD2 (~3,000 tris)
    print("Creating and exporting LOD2...")
    lod2_mesh = navy_mesh.copy()
    lod2_mesh.data = navy_mesh.data.copy()
    bpy.context.scene.collection.objects.link(lod2_mesh)

    bpy.ops.object.select_all(action='DESELECT')
    lod2_mesh.select_set(True)
    bpy.context.view_layer.objects.active = lod2_mesh
    dec2 = lod2_mesh.modifiers.new("Decimate_LOD2", 'DECIMATE')
    dec2.ratio = 0.25
    bpy.ops.object.modifier_apply(modifier="Decimate_LOD2")

    lod2_mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
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
    bpy.data.objects.remove(lod2_mesh, do_unlink=True)

    print("SUCCESS: Hero character rigged, skinned, and exported for LOD0, LOD1, and LOD2!")

if __name__ == "__main__":
    rig_hero()
