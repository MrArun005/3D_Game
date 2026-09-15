"""
Build Widebody Hero Supercar for Halstead Bay / Nightfall Drive in Blender.
Complies with docs/PIPELINE.md and docs/ART_BIBLE.md:
- Units: Metres (Blender default)
- Forward: +X, Up: +Z
- Origin: Base on ground (Z=0), centred in X/Y
- Materials: car_paint, car_glass, alloy_polished, metal_painted, tyre_rubber, sign_emissive
- Collections: LOD0
"""

import bpy
import bmesh
import math
from mathutils import Vector, Matrix

def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)

def get_or_create_material(name, color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emissive=(0, 0, 0, 1), emissive_strength=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Metallic'].default_value = metallic
            bsdf.inputs['Roughness'].default_value = roughness
            if 'Emission Color' in bsdf.inputs:
                bsdf.inputs['Emission Color'].default_value = emissive
                bsdf.inputs['Emission Strength'].default_value = emissive_strength
            elif 'Emission' in bsdf.inputs:
                bsdf.inputs['Emission'].default_value = emissive
            if alpha < 1.0:
                bsdf.inputs['Alpha'].default_value = alpha
                mat.blend_method = 'BLEND'
    return mat

def setup_materials():
    mats = {}
    # Hero Electric Cyber Blue / Midnight Sapphire metallic
    mats['car_paint'] = get_or_create_material(
        'car_paint',
        color=(0.02, 0.10, 0.38, 1.0),
        metallic=0.92,
        roughness=0.18
    )
    # Tinted dark glass
    mats['car_glass'] = get_or_create_material(
        'car_glass',
        color=(0.02, 0.03, 0.04, 0.85),
        metallic=0.2,
        roughness=0.05,
        alpha=0.85
    )
    # Gunmetal / Forged alloy
    mats['alloy_polished'] = get_or_create_material(
        'alloy_polished',
        color=(0.42, 0.45, 0.48, 1.0),
        metallic=0.95,
        roughness=0.15
    )
    # Matte satin carbon aero components
    mats['metal_painted'] = get_or_create_material(
        'metal_painted',
        color=(0.04, 0.04, 0.045, 1.0),
        metallic=0.4,
        roughness=0.35
    )
    # Tyre rubber
    mats['tyre_rubber'] = get_or_create_material(
        'tyre_rubber',
        color=(0.03, 0.03, 0.03, 1.0),
        metallic=0.0,
        roughness=0.75
    )
    # Headlight LED blade (bright ice-cyan / xenon)
    mats['sign_emissive_front'] = get_or_create_material(
        'sign_emissive_front',
        color=(0.8, 0.95, 1.0, 1.0),
        emissive=(0.5, 0.9, 1.0, 1.0),
        emissive_strength=12.0
    )
    # Taillight LED blade (deep ruby red)
    mats['sign_emissive_rear'] = get_or_create_material(
        'sign_emissive_rear',
        color=(1.0, 0.05, 0.05, 1.0),
        emissive=(1.0, 0.02, 0.02, 1.0),
        emissive_strength=15.0
    )
    # Brake caliper accent (neon red/orange)
    mats['caliper_accent'] = get_or_create_material(
        'caliper_accent',
        color=(0.90, 0.08, 0.02, 1.0),
        metallic=0.6,
        roughness=0.28
    )
    return mats

def build_supercar_body(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_body")
    obj = bpy.data.objects.new("supercar_body", mesh)
    lod_col.objects.link(obj)
    
    obj.data.materials.append(mats['car_paint'])
    obj.data.materials.append(mats['metal_painted'])

    bm = bmesh.new()

    stations = [
        # Front splitter nose
        [2.35, 0.12, 0.28, 0.58, 0.58, 0.65, 0.82, 0.86, 0.50],
        # Front bumper & headlights
        [2.15, 0.14, 0.32, 0.64, 0.66, 0.72, 0.88, 0.92, 0.58],
        # Front wheel arch peak (X = 1.40)
        [1.40, 0.28, 0.38, 0.72, 0.74, 0.82, 0.98, 1.01, 0.64],
        # Base of windscreen / hood base
        [0.85, 0.18, 0.34, 0.74, 0.85, 0.78, 0.92, 0.96, 0.66],
        # A-pillar & windscreen crest (Cabin peak)
        [0.05, 0.16, 0.32, 0.76, 1.18, 0.76, 0.90, 0.94, 0.62],
        # Mid-cabin & roof
        [-0.45, 0.16, 0.32, 0.76, 1.16, 0.76, 0.91, 0.95, 0.62],
        # C-pillar / B-pillar / Engine air intake scoop
        [-0.95, 0.18, 0.35, 0.76, 1.05, 0.80, 0.96, 1.02, 0.58],
        # Rear muscular flared wheel arch (X = -1.30)
        [-1.30, 0.30, 0.40, 0.82, 0.94, 0.84, 1.02, 1.04, 0.52],
        # Rear engine deck & haunches
        [-1.80, 0.24, 0.42, 0.84, 0.88, 0.80, 0.98, 1.00, 0.48],
        # Rear tail / diffuser upper edge
        [-2.20, 0.28, 0.46, 0.86, 0.88, 0.75, 0.92, 0.94, 0.42]
    ]

    rings = []
    for s in stations:
        x, zb, zs, zsh, zr, wb, ws, wsh, wr = s
        pts = [
            Vector((x, 0.0, zb)),            # 0: bottom center
            Vector((x, wb, zb)),             # 1: bottom right
            Vector((x, ws, zs)),             # 2: sill / lower door
            Vector((x, wsh, zsh)),           # 3: widebody shoulder
            Vector((x, wr, (zsh + zr)*0.5)), # 4: window beltline
            Vector((x, wr * 0.7, zr)),       # 5: roof edge
            Vector((x, 0.0, zr + 0.01)),     # 6: roof center
            # Symmetrical left side
            Vector((x, -wr * 0.7, zr)),      # 7: left roof edge
            Vector((x, -wr, (zsh + zr)*0.5)),# 8: left beltline
            Vector((x, -wsh, zsh)),          # 9: left shoulder
            Vector((x, -ws, zs)),            # 10: left sill
            Vector((x, -wb, zb)),            # 11: left bottom
        ]
        v_ring = [bm.verts.new(p) for p in pts]
        rings.append(v_ring)

    for i in range(len(rings) - 1):
        r1 = rings[i]
        r2 = rings[i + 1]
        n_pts = len(r1)
        for j in range(n_pts):
            j_next = (j + 1) % n_pts
            try:
                face = bm.faces.new([r1[j], r1[j_next], r2[j_next], r2[j]])
                face.material_index = 0
            except:
                pass

    # Front cap
    front_r = rings[0]
    front_center = bm.verts.new(Vector((2.42, 0.0, 0.38)))
    for j in range(len(front_r)):
        j_next = (j + 1) % len(front_r)
        try:
            face = bm.faces.new([front_center, front_r[j_next], front_r[j]])
            face.material_index = 1
        except:
            pass

    # Rear cap
    rear_r = rings[-1]
    rear_center = bm.verts.new(Vector((-2.25, 0.0, 0.55)))
    for j in range(len(rear_r)):
        j_next = (j + 1) % len(rear_r)
        try:
            face = bm.faces.new([rear_center, rear_r[j], rear_r[j_next]])
            face.material_index = 1
        except:
            pass

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    sub_mod = obj.modifiers.new("Subsurf", 'SUBSURF')
    sub_mod.levels = 1
    sub_mod.render_levels = 1

    return obj

def build_aero_kit(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_aero")
    obj = bpy.data.objects.new("supercar_aero", mesh)
    lod_col.objects.link(obj)
    obj.data.materials.append(mats['metal_painted'])

    bm = bmesh.new()

    # Front Carbon Splitter
    spl_pts = [
        Vector((2.00, -0.98, 0.10)),
        Vector((2.45, -0.72, 0.09)),
        Vector((2.45, 0.72, 0.09)),
        Vector((2.00, 0.98, 0.10)),
    ]
    bm.faces.new([bm.verts.new(p) for p in spl_pts])

    # Canards / dive planes
    for side in [1.0, -1.0]:
        canard_pts = [
            Vector((2.10, side * 0.98, 0.12)),
            Vector((2.38, side * 0.98, 0.14)),
            Vector((2.32, side * 1.02, 0.30)),
            Vector((2.12, side * 1.01, 0.24))
        ]
        can_v = [bm.verts.new(p) for p in canard_pts]
        bm.faces.new(can_v if side == 1.0 else reversed(can_v))

    # Side Skirts
    for side in [1.0, -1.0]:
        skirt_pts = [
            Vector((1.10, side * 0.93, 0.12)),
            Vector((-1.00, side * 0.98, 0.12)),
            Vector((-1.00, side * 1.04, 0.13)),
            Vector((1.10, side * 0.99, 0.13)),
        ]
        sk_v = [bm.verts.new(p) for p in skirt_pts]
        bm.faces.new(sk_v if side == 1.0 else reversed(sk_v))

    # Rear Diffuser Tunnel
    diff_pts = [
        Vector((-1.60, -0.80, 0.12)),
        Vector((-1.60, 0.80, 0.12)),
        Vector((-2.32, 0.86, 0.35)),
        Vector((-2.32, -0.86, 0.35)),
    ]
    bm.faces.new([bm.verts.new(p) for p in diff_pts])

    # 4 Vertical Diffuser Fins
    for y_fin in [-0.60, -0.20, 0.20, 0.60]:
        fin_pts = [
            Vector((-1.65, y_fin, 0.11)),
            Vector((-2.33, y_fin, 0.33)),
            Vector((-2.33, y_fin, 0.08)),
            Vector((-1.65, y_fin, 0.05)),
        ]
        bm.faces.new([bm.verts.new(p) for p in fin_pts])

    # Swan-Neck GT Aero Wing
    foil_x_front = -1.95
    foil_x_rear = -2.35
    foil_z = 1.15
    wing_pts = [
        Vector((foil_x_front, -0.86, foil_z)),
        Vector((foil_x_front, 0.86, foil_z)),
        Vector((foil_x_rear, 0.86, foil_z + 0.06)),
        Vector((foil_x_rear, -0.86, foil_z + 0.06)),
    ]
    bm.faces.new([bm.verts.new(p) for p in wing_pts])

    # Wing Endplates
    for side in [1.0, -1.0]:
        endplate = [
            Vector((foil_x_front - 0.05, side * 0.87, foil_z - 0.08)),
            Vector((foil_x_rear + 0.06, side * 0.87, foil_z - 0.04)),
            Vector((foil_x_rear + 0.06, side * 0.87, foil_z + 0.18)),
            Vector((foil_x_front - 0.05, side * 0.87, foil_z + 0.12)),
        ]
        ep_v = [bm.verts.new(p) for p in endplate]
        bm.faces.new(ep_v if side == 1.0 else reversed(ep_v))

    # Swan-neck mounting pylons
    for y_pylon in [-0.35, 0.35]:
        pylon_pts = [
            Vector((-1.75, y_pylon, 0.86)),
            Vector((-1.82, y_pylon, 0.86)),
            Vector((-2.10, y_pylon, foil_z + 0.04)),
            Vector((-2.04, y_pylon, foil_z + 0.05)),
        ]
        bm.faces.new([bm.verts.new(p) for p in pylon_pts])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    sol_mod = obj.modifiers.new("Solidify", 'SOLIDIFY')
    sol_mod.thickness = 0.02
    return obj

def build_glass_canopy(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_glass")
    obj = bpy.data.objects.new("supercar_glass", mesh)
    lod_col.objects.link(obj)
    obj.data.materials.append(mats['car_glass'])

    bm = bmesh.new()

    # Windscreen
    windscreen_pts = [
        Vector((0.82, -0.66, 0.83)),
        Vector((0.82, 0.66, 0.83)),
        Vector((0.08, 0.58, 1.17)),
        Vector((0.08, -0.58, 1.17)),
    ]
    bm.faces.new([bm.verts.new(p) for p in windscreen_pts])

    # Panoramic Glass Roof
    roof_pts = [
        Vector((0.08, -0.58, 1.17)),
        Vector((0.08, 0.58, 1.17)),
        Vector((-0.46, 0.57, 1.15)),
        Vector((-0.46, -0.57, 1.15)),
    ]
    bm.faces.new([bm.verts.new(p) for p in roof_pts])

    # Side Windows
    for side in [1.0, -1.0]:
        side_win = [
            Vector((0.74, side * 0.67, 0.84)),
            Vector((0.05, side * 0.61, 1.16)),
            Vector((-0.80, side * 0.60, 1.05)),
            Vector((-0.80, side * 0.72, 0.81)),
            Vector((0.00, side * 0.74, 0.82)),
        ]
        sw_v = [bm.verts.new(p) for p in side_win]
        bm.faces.new(sw_v if side == 1.0 else reversed(sw_v))

    # Rear Glass Engine Cover
    rear_glass = [
        Vector((-0.46, -0.56, 1.14)),
        Vector((-0.46, 0.56, 1.14)),
        Vector((-1.32, 0.44, 0.90)),
        Vector((-1.32, -0.44, 0.90)),
    ]
    bm.faces.new([bm.verts.new(p) for p in rear_glass])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    sol_mod = obj.modifiers.new("Solidify", 'SOLIDIFY')
    sol_mod.thickness = 0.015
    return obj

def build_lighting_system(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_lights")
    obj = bpy.data.objects.new("supercar_lights", mesh)
    lod_col.objects.link(obj)
    
    obj.data.materials.append(mats['sign_emissive_front'])
    obj.data.materials.append(mats['sign_emissive_rear'])

    bm = bmesh.new()

    # Front Headlight LED Blades
    for side in [1.0, -1.0]:
        blade_pts = [
            Vector((2.22, side * 0.62, 0.58)),
            Vector((2.05, side * 0.85, 0.64)),
            Vector((1.95, side * 0.88, 0.65)),
            Vector((2.12, side * 0.65, 0.59)),
        ]
        bv = [bm.verts.new(p) for p in blade_pts]
        face = bm.faces.new(bv if side == 1.0 else reversed(bv))
        face.material_index = 0

    # Rear Full-Width LED Lightbar
    rear_light_pts = [
        Vector((-2.21, -0.82, 0.76)),
        Vector((-2.21, 0.82, 0.76)),
        Vector((-2.20, 0.82, 0.82)),
        Vector((-2.20, -0.82, 0.82)),
    ]
    rv = [bm.verts.new(p) for p in rear_light_pts]
    rear_face = bm.faces.new(rv)
    rear_face.material_index = 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    sol_mod = obj.modifiers.new("Solidify", 'SOLIDIFY')
    sol_mod.thickness = 0.02
    return obj

def build_titanium_exhausts(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_exhaust")
    obj = bpy.data.objects.new("supercar_exhaust", mesh)
    lod_col.objects.link(obj)
    obj.data.materials.append(mats['alloy_polished'])

    bm = bmesh.new()
    pipe_radius = 0.052
    pipe_len = 0.18
    y_positions = [-0.18, -0.06, 0.06, 0.18]
    z_pos = 0.52

    for y in y_positions:
        rot = Matrix.Rotation(math.radians(90), 4, 'Y')
        trans = Matrix.Translation(Vector((-2.15, y, z_pos)))
        mat = trans @ rot
        bmesh.ops.create_cone(
            bm,
            cap_ends=False,
            cap_tris=False,
            segments=16,
            radius1=pipe_radius,
            radius2=pipe_radius * 0.98,
            depth=pipe_len,
            matrix=mat
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    sol_mod = obj.modifiers.new("Solidify", 'SOLIDIFY')
    sol_mod.thickness = 0.008
    return obj

def build_wheel_assembly(mats, lod_col, name, x_pos, y_pos, radius=0.34, width=0.29):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    lod_col.objects.link(obj)

    obj.data.materials.append(mats['tyre_rubber'])      # 0
    obj.data.materials.append(mats['alloy_polished'])    # 1
    obj.data.materials.append(mats['caliper_accent'])    # 2

    bm = bmesh.new()
    is_left = (y_pos > 0)
    outward_dir = 1.0 if is_left else -1.0

    rot_tyre = Matrix.Rotation(math.radians(90), 4, 'X')
    trans_wheel = Matrix.Translation(Vector((x_pos, y_pos, radius)))
    
    # 1. Tyre
    res_tyre = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=28,
        radius1=radius,
        radius2=radius,
        depth=width,
        matrix=trans_wheel @ rot_tyre
    )
    for v in res_tyre['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # 2. Deep Dish Rim Barrel
    rim_radius = radius * 0.68
    rim_width = width * 0.88
    rim_mat = trans_wheel @ Matrix.Translation(Vector((0, outward_dir * 0.02, 0))) @ rot_tyre
    res_rim = bmesh.ops.create_cone(
        bm,
        cap_ends=False,
        segments=24,
        radius1=rim_radius,
        radius2=rim_radius * 0.85,
        depth=rim_width,
        matrix=rim_mat
    )
    for v in res_rim['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # 3. Concave 5-Spoke Star Face
    spoke_depth = outward_dir * (width * 0.46)
    center_hub = Vector((x_pos, y_pos + spoke_depth * 0.6, radius))
    hub_vert = bm.verts.new(center_hub)

    for i in range(5):
        angle = (i * 2.0 * math.pi) / 5.0
        r_outer = rim_radius * 0.95
        spoke_tip_z = radius + math.cos(angle) * r_outer
        spoke_tip_x = x_pos + math.sin(angle) * r_outer
        spoke_tip = Vector((spoke_tip_x, y_pos + spoke_depth, spoke_tip_z))

        angle2 = angle + (2.0 * math.pi / 20.0)
        spoke_tip2_z = radius + math.cos(angle2) * r_outer
        spoke_tip2_x = x_pos + math.sin(angle2) * r_outer
        spoke_tip2 = Vector((spoke_tip2_x, y_pos + spoke_depth, spoke_tip2_z))

        v1 = bm.verts.new(spoke_tip)
        v2 = bm.verts.new(spoke_tip2)
        try:
            face = bm.faces.new([hub_vert, v1, v2])
            face.material_index = 1
        except:
            pass

    # 4. Drilled Brake Rotor Disc
    rotor_radius = rim_radius * 0.78
    rotor_mat = trans_wheel @ Matrix.Translation(Vector((0, -outward_dir * 0.02, 0))) @ rot_tyre
    res_rotor = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=20,
        radius1=rotor_radius,
        radius2=rotor_radius,
        depth=0.02,
        matrix=rotor_mat
    )
    for v in res_rotor['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # 5. Racing Brake Caliper
    caliper_mat = trans_wheel @ Matrix.Translation(Vector((0.08, -outward_dir * 0.01, rotor_radius * 0.75)))
    res_caliper = bmesh.ops.create_cube(
        bm,
        size=1.0,
        matrix=caliper_mat @ Matrix.Scale(0.14, 4, Vector((1, 0, 0))) @ Matrix.Scale(0.06, 4, Vector((0, 1, 0))) @ Matrix.Scale(0.09, 4, Vector((0, 0, 1)))
    )
    for v in res_caliper['verts']:
        for f in v.link_faces:
            f.material_index = 2

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    return obj

def build_interior_cockpit(mats, lod_col):
    mesh = bpy.data.meshes.new("supercar_interior")
    obj = bpy.data.objects.new("supercar_interior", mesh)
    lod_col.objects.link(obj)
    
    obj.data.materials.append(mats['metal_painted'])
    obj.data.materials.append(mats['sign_emissive_front'])

    bm = bmesh.new()

    # Dashboard
    dash_mat = Matrix.Translation(Vector((0.55, 0.0, 0.78)))
    res_dash = bmesh.ops.create_cube(bm, size=1.0, matrix=dash_mat @ Matrix.Scale(0.40, 4, Vector((1, 0, 0))) @ Matrix.Scale(1.24, 4, Vector((0, 1, 0))) @ Matrix.Scale(0.22, 4, Vector((0, 0, 1))))
    for v in res_dash['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # Digital Instrument Screen (emissive HUD)
    screen_mat = Matrix.Translation(Vector((0.42, 0.32, 0.84))) @ Matrix.Rotation(math.radians(-25), 4, 'Y')
    res_screen = bmesh.ops.create_cube(bm, size=1.0, matrix=screen_mat @ Matrix.Scale(0.02, 4, Vector((1, 0, 0))) @ Matrix.Scale(0.25, 4, Vector((0, 1, 0))) @ Matrix.Scale(0.12, 4, Vector((0, 0, 1))))
    for v in res_screen['verts']:
        for f in v.link_faces:
            f.material_index = 1

    # Racing Bucket Seats
    for side in [0.32, -0.32]:
        base_mat = Matrix.Translation(Vector((-0.15, side, 0.42)))
        res_base = bmesh.ops.create_cube(bm, size=1.0, matrix=base_mat @ Matrix.Scale(0.48, 4, Vector((1, 0, 0))) @ Matrix.Scale(0.44, 4, Vector((0, 1, 0))) @ Matrix.Scale(0.16, 4, Vector((0, 0, 1))))
        for v in res_base['verts']:
            for f in v.link_faces:
                f.material_index = 0

        back_mat = Matrix.Translation(Vector((-0.42, side, 0.72))) @ Matrix.Rotation(math.radians(-18), 4, 'Y')
        res_back = bmesh.ops.create_cube(bm, size=1.0, matrix=back_mat @ Matrix.Scale(0.14, 4, Vector((1, 0, 0))) @ Matrix.Scale(0.42, 4, Vector((0, 1, 0))) @ Matrix.Scale(0.56, 4, Vector((0, 0, 1))))
        for v in res_back['verts']:
            for f in v.link_faces:
                f.material_index = 0

    # Steering Wheel
    wheel_mat = Matrix.Translation(Vector((0.28, 0.32, 0.78))) @ Matrix.Rotation(math.radians(-20), 4, 'Y')
    res_sw = bmesh.ops.create_cone(
        bm,
        cap_ends=False,
        segments=16,
        radius1=0.16,
        radius2=0.14,
        depth=0.03,
        matrix=wheel_mat @ Matrix.Rotation(math.radians(90), 4, 'Y')
    )
    for v in res_sw['verts']:
        for f in v.link_faces:
            f.material_index = 0

    # Rear Roll Cage Crossbar
    bar_mat = Matrix.Translation(Vector((-0.70, 0.0, 0.92))) @ Matrix.Rotation(math.radians(90), 4, 'X')
    res_bar = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.025, radius2=0.025, depth=1.10, matrix=bar_mat)
    for v in res_bar['verts']:
        for f in v.link_faces:
            f.material_index = 0

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True
    return obj

def setup_studio_environment():
    cam_data = bpy.data.cameras.new("Hero_Camera")
    cam_data.lens = 52
    cam_obj = bpy.data.objects.new("Hero_Camera", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (5.2, -4.6, 2.3)
    cam_obj.rotation_euler = (math.radians(72), 0, math.radians(48))
    bpy.context.scene.camera = cam_obj

    # Key Sun
    sun_data = bpy.data.lights.new("Studio_Key", 'SUN')
    sun_data.energy = 4.5
    sun_data.color = (0.96, 0.98, 1.0)
    sun_obj = bpy.data.objects.new("Studio_Key", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(52), math.radians(14), math.radians(38))

    # Rim light for edge specular highlights
    rim_data = bpy.data.lights.new("Studio_Rim", 'POINT')
    rim_data.energy = 1600.0
    rim_data.color = (0.3, 0.75, 1.0) # cool cyan rim
    rim_obj = bpy.data.objects.new("Studio_Rim", rim_data)
    bpy.context.scene.collection.objects.link(rim_obj)
    rim_obj.location = (-4.2, 3.8, 2.4)

    # Warm street reflection fill
    warm_data = bpy.data.lights.new("Studio_Fill", 'POINT')
    warm_data.energy = 900.0
    warm_data.color = (1.0, 0.78, 0.50) # sodium warm fill
    warm_obj = bpy.data.objects.new("Studio_Fill", warm_data)
    bpy.context.scene.collection.objects.link(warm_obj)
    warm_obj.location = (3.8, 3.2, 1.6)

def uv_unwrap_all(lod_col):
    for obj in lod_col.objects:
        if obj.type == 'MESH':
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            try:
                bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
            except Exception as e:
                print("UV unwrap warning for", obj.name, e)
            bpy.ops.object.mode_set(mode='OBJECT')
            obj.select_set(False)

def export_hero_model():
    out_source = "/Users/arunmallikarjun/Desktop/3D_Game/assets/source/vehicles/hero_supercar/hero_supercar.glb"
    out_assets = "/Users/arunmallikarjun/Desktop/3D_Game/assets/models/player_car.glb"

    bpy.ops.export_scene.gltf(
        filepath=out_source,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True
    )
    bpy.ops.export_scene.gltf(
        filepath=out_assets,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True
    )
    print("Exported Hero Supercar to:", out_source, "and", out_assets)

def main():
    print("Building Widebody Hero Supercar in Blender...")
    reset_scene()

    lod0_col = bpy.data.collections.new("LOD0")
    bpy.context.scene.collection.children.link(lod0_col)

    mats = setup_materials()

    body = build_supercar_body(mats, lod0_col)
    aero = build_aero_kit(mats, lod0_col)
    glass = build_glass_canopy(mats, lod0_col)
    lights = build_lighting_system(mats, lod0_col)
    exhaust = build_titanium_exhausts(mats, lod0_col)
    interior = build_interior_cockpit(mats, lod0_col)

    wheel_fl = build_wheel_assembly(mats, lod0_col, "wheel_fl", 1.40, 0.86, radius=0.34, width=0.28)
    wheel_fr = build_wheel_assembly(mats, lod0_col, "wheel_fr", 1.40, -0.86, radius=0.34, width=0.28)
    wheel_rl = build_wheel_assembly(mats, lod0_col, "wheel_rl", -1.30, 0.88, radius=0.35, width=0.32)
    wheel_rr = build_wheel_assembly(mats, lod0_col, "wheel_rr", -1.30, -0.88, radius=0.35, width=0.32)

    setup_studio_environment()
    uv_unwrap_all(lod0_col)
    export_hero_model()
    print("Hero Supercar Build Complete!")

if __name__ == "__main__":
    main()
