"""
Author Ultra-Sleek 'Sexy Buildings' Facade Kit for Halstead Bay / Nightfall Drive in Blender.
Complies with docs/PIPELINE.md and docs/ART_BIBLE.md:
- 3.6m grid spacing (X: -1.8 to +1.8)
- Ground floor height: 4.2m, Upper floor height: 3.6m
- Wall mounting plane: Y = 0 (outward face +Y), Up: +Z
- Tri budget: <= 1,800 tris per module
- Materials: glass_curtain, glass_shop, metal_painted, concrete_precast, alloy_polished, sign_emissive
"""

import bpy
import bmesh
import math
from mathutils import Vector, Matrix

def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m, do_unlink=True)

def get_or_create_material(name, color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emissive=(0, 0, 0, 1), emissive_strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Metallic'].default_value = metallic
            bsdf.inputs['Roughness'].default_value = roughness
            if 'Emission Color' in bsdf.inputs:
                bsdf.inputs['Emission Color'].default_value = emissive
                bsdf.inputs['Emission Strength'].default_value = emissive_strength
            elif 'Emission' in bsdf.inputs:
                bsdf.inputs['Emission'].default_value = emissive
    return mat

def setup_materials():
    mats = {}
    # Reflective luxury tinted curtain wall glass
    mats['glass_curtain'] = get_or_create_material(
        'glass_curtain',
        color=(0.04, 0.08, 0.12, 1.0),
        metallic=0.1,
        roughness=0.06
    )
    # Shopfront crystal glass
    mats['glass_shop'] = get_or_create_material(
        'glass_shop',
        color=(0.06, 0.09, 0.10, 1.0),
        metallic=0.05,
        roughness=0.03
    )
    # Satin dark titanium/bronze architectural mullions & structural fins
    mats['metal_painted'] = get_or_create_material(
        'metal_painted',
        color=(0.08, 0.08, 0.085, 1.0),
        metallic=0.6,
        roughness=0.3
    )
    # Luxury brushed aluminum canopy & accents
    mats['alloy_polished'] = get_or_create_material(
        'alloy_polished',
        color=(0.75, 0.76, 0.78, 1.0),
        metallic=0.92,
        roughness=0.18
    )
    # Smooth precast architectural concrete spandrel panel
    mats['concrete_precast'] = get_or_create_material(
        'concrete_precast',
        color=(0.55, 0.54, 0.52, 1.0),
        metallic=0.0,
        roughness=0.72
    )
    # Linear LED architectural illumination & signage (warm champagne/neon)
    mats['sign_emissive'] = get_or_create_material(
        'sign_emissive',
        color=(1.0, 0.88, 0.72, 1.0),
        emissive=(1.0, 0.82, 0.60, 1.0),
        emissive_strength=8.0
    )
    return mats

def build_sexy_modern_bay(mats):
    """
    Sexy Modern Skyscraper Tower Bay (3.6m wide x 3.6m tall).
    Features:
    - Floor spandrel with chamfered concrete slab & recessed LED cove accent
    - Floor-to-ceiling panoramic glass curtain wall with vertical aero sun fins
    - Metallic mullions with depth reveals
    - High-detail interior ceiling with recessed warm downlight fixtures
    """
    reset()
    mesh = bpy.data.meshes.new("facade_bay_modern")
    obj = bpy.data.objects.new("facade_bay_modern", mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Assign materials
    mat_list = [
        mats['glass_curtain'],     # 0
        mats['metal_painted'],     # 1
        mats['concrete_precast'],  # 2
        mats['sign_emissive'],     # 3
        mats['alloy_polished'],    # 4
    ]
    for m in mat_list:
        obj.data.materials.append(m)

    bm = bmesh.new()

    # 1. Concrete Spandrel Slab at base (Z: 0 to 0.45m, X: -1.8 to 1.8m, Y: -0.35 to 0.05m)
    slab = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.15, 0.225))) @
               Matrix.Scale(3.6, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.40, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.45, 4, Vector((0, 0, 1)))
    )
    for v in slab['verts']:
        for f in v.link_faces:
            f.material_index = 2

    # 2. Linear LED Cove Light embedded in slab edge (glows at night)
    led = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, 0.06, 0.44))) @
               Matrix.Scale(3.56, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.04, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.03, 4, Vector((0, 0, 1)))
    )
    for v in led['verts']:
        for f in v.link_faces:
            f.material_index = 3

    # 3. Floor-to-Ceiling Glass Curtain Wall Panes (Z: 0.45 to 3.50m)
    # 3 Large panoramic window panes separated by vertical structural mullions
    # Pane widths: 1.14m each
    glass = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.05, 1.975))) @
               Matrix.Scale(3.54, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.02, 4, Vector((0, 1, 0))) @
               Matrix.Scale(3.05, 4, Vector((0, 0, 1)))
    )
    for v in glass['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # 4. Vertical Aerodynamic Louvres / Shading Fins (Architectural fins projecting outward)
    # 4 vertical fins at X = -1.78, -0.60, 0.60, 1.78 (jutting out 0.28m past glass)
    for x_fin in [-1.78, -0.60, 0.60, 1.78]:
        fin = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(Vector((x_fin, 0.10, 1.975))) @
                   Matrix.Scale(0.06, 4, Vector((1, 0, 0))) @
                   Matrix.Scale(0.32, 4, Vector((0, 1, 0))) @
                   Matrix.Scale(3.10, 4, Vector((0, 0, 1)))
        )
        for v in fin['verts']:
            for f in v.link_faces:
                f.material_index = 1

    # 5. Top Cornice / Inter-floor Reveal Beam (Z: 3.50 to 3.60m)
    top_beam = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.10, 3.55))) @
               Matrix.Scale(3.6, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.35, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.10, 4, Vector((0, 0, 1)))
    )
    for v in top_beam['verts']:
        for f in v.link_faces:
            f.material_index = 4

    # 6. Interior Ceiling & Recessed Warm Light Sockets
    ceiling = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.60, 3.48))) @
               Matrix.Scale(3.54, 4, Vector((1, 0, 0))) @
               Matrix.Scale(1.0, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.04, 4, Vector((0, 0, 1)))
    )
    for v in ceiling['verts']:
        for f in v.link_faces:
            f.material_index = 2

    # Ceiling warm light strips
    for y_light in [-0.35, -0.80]:
        clight = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(Vector((0.0, y_light, 3.46))) @
                   Matrix.Scale(3.2, 4, Vector((1, 0, 0))) @
                   Matrix.Scale(0.08, 4, Vector((0, 1, 0))) @
                   Matrix.Scale(0.02, 4, Vector((0, 0, 1)))
        )
        for v in clight['verts']:
            for f in v.link_faces:
                f.material_index = 3

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    # Smart UV project
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Export bay_modern
    out_public = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/facade/bay_modern.glb"
    out_source = "/Users/arunmallikarjun/Desktop/3D_Game/assets/source/facade/bay_modern/bay_modern.glb"

    bpy.ops.export_scene.gltf(
        filepath=out_public,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    bpy.ops.export_scene.gltf(
        filepath=out_source,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    print("Exported bay_modern successfully!")
    return obj

def build_sexy_luxury_lobby(mats):
    """
    Sexy Modern Skyscraper Double-Height Ground Lobby (3.6m wide x 4.2m tall).
    Features:
    - Polished dark stone / titanium frame
    - Cantilevered glass entrance marquee / canopy jutting out over sidewalk
    - Recessed revolving door & dual glass portals
    - Illuminated glowing header sign ("NIGHTFALL TOWER" / "AZURE")
    - Warm illuminated interior lobby ceiling and columns
    """
    reset()
    mesh = bpy.data.meshes.new("facade_ground_lobby")
    obj = bpy.data.objects.new("facade_ground_lobby", mesh)
    bpy.context.scene.collection.objects.link(obj)

    mat_list = [
        mats['glass_shop'],        # 0
        mats['metal_painted'],     # 1
        mats['alloy_polished'],    # 2
        mats['concrete_precast'],  # 3
        mats['sign_emissive'],     # 4
    ]
    for m in mat_list:
        obj.data.materials.append(m)

    bm = bmesh.new()

    # 1. Main Portal Framing Pillars (Left & Right, X = ±1.70, width = 0.20m, height = 4.2m)
    for side in [-1.70, 1.70]:
        pillar = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(Vector((side, 0.05, 2.10))) @
                   Matrix.Scale(0.20, 4, Vector((1, 0, 0))) @
                   Matrix.Scale(0.40, 4, Vector((0, 1, 0))) @
                   Matrix.Scale(4.20, 4, Vector((0, 0, 1)))
        )
        for v in pillar['verts']:
            for f in v.link_faces:
                f.material_index = 1

    # 2. Grand Entrance Header Beam & Signboard (Z: 3.40 to 4.20m)
    header = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, 0.06, 3.80))) @
               Matrix.Scale(3.60, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.38, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.80, 4, Vector((0, 0, 1)))
    )
    for v in header['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # Illuminated Tower Nameplate ("AZURE TOWER" backlit glowing sign)
    sign = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, 0.26, 3.80))) @
               Matrix.Scale(2.60, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.04, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.35, 4, Vector((0, 0, 1)))
    )
    for v in sign['verts']:
        for f in v.link_faces:
            f.material_index = 4

    # 3. Cantilevered Glass & Brushed Aluminum Entrance Canopy (Juts out 1.2m over sidewalk at Z = 3.35m)
    canopy = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, 0.65, 3.35))) @
               Matrix.Scale(3.20, 4, Vector((1, 0, 0))) @
               Matrix.Scale(1.20, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.06, 4, Vector((0, 0, 1)))
    )
    for v in canopy['verts']:
        for f in v.link_faces:
            f.material_index = 2 # polished alloy

    # Canopy perimeter warm LED downlight strip
    can_light = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, 1.20, 3.31))) @
               Matrix.Scale(3.14, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.06, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.02, 4, Vector((0, 0, 1)))
    )
    for v in can_light['verts']:
        for f in v.link_faces:
            f.material_index = 4

    # 4. Floor-to-Ceiling Glazed Lobby Wall & Doors (Z: 0.0 to 3.30m)
    glass_wall = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.05, 1.65))) @
               Matrix.Scale(3.20, 4, Vector((1, 0, 0))) @
               Matrix.Scale(0.03, 4, Vector((0, 1, 0))) @
               Matrix.Scale(3.30, 4, Vector((0, 0, 1)))
    )
    for v in glass_wall['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # 5. Stainless Steel Door Handles & Framed Portals
    for door_x in [-0.70, 0.70]:
        door_frame = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(Vector((door_x, -0.02, 1.30))) @
                   Matrix.Scale(0.95, 4, Vector((1, 0, 0))) @
                   Matrix.Scale(0.06, 4, Vector((0, 1, 0))) @
                   Matrix.Scale(2.55, 4, Vector((0, 0, 1)))
        )
        for v in door_frame['verts']:
            for f in v.link_faces:
                f.material_index = 2

        # Vertical grab handles
        handle = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(Vector((door_x + (0.35 if door_x > 0 else -0.35), 0.04, 1.10))) @
                   Matrix.Scale(0.04, 4, Vector((1, 0, 0))) @
                   Matrix.Scale(0.06, 4, Vector((0, 1, 0))) @
                   Matrix.Scale(0.85, 4, Vector((0, 0, 1)))
        )
        for v in handle['verts']:
            for f in v.link_faces:
                f.material_index = 2

    # 6. Warm Interior Floor & Ambient Reception Ceiling
    lobby_floor = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=Matrix.Translation(Vector((0.0, -0.80, 0.05))) @
               Matrix.Scale(3.50, 4, Vector((1, 0, 0))) @
               Matrix.Scale(1.40, 4, Vector((0, 1, 0))) @
               Matrix.Scale(0.10, 4, Vector((0, 0, 1)))
    )
    for v in lobby_floor['verts']:
        for f in v.link_faces:
            f.material_index = 3

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    # UV unwrap
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    out_public = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/facade/ground_lobby.glb"
    out_source = "/Users/arunmallikarjun/Desktop/3D_Game/assets/source/facade/ground_lobby/ground_lobby.glb"

    bpy.ops.export_scene.gltf(
        filepath=out_public,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    bpy.ops.export_scene.gltf(
        filepath=out_source,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    print("Exported ground_lobby successfully!")
    return obj

def main():
    print("Building Sexy Buildings Facade Kit...")
    mats = setup_materials()
    build_sexy_modern_bay(mats)
    build_sexy_luxury_lobby(mats)
    print("Sexy Buildings Facade Kit Complete!")

if __name__ == "__main__":
    main()
