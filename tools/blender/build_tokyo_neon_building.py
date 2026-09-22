"""
Build High-Fidelity Japanese Neon Boulevard Tower for Halstead Bay in Blender.
Directly replicates the architecture in user reference images:
- Ground-floor 24/7 Japanese Konbini (7-Eleven style) with illuminated green/white/orange striped canopy,
  panoramic glass storefront, sliding doors, and sidewalk vending machines.
- Multi-storey modern commercial tower with horizontal ribbon windows, floor slab reveals, and dark composite panels.
- Massive cantilevered vertical Japanese neon blade signs (cyan, magenta, yellow, red lightboxes on structural steel outriggers).
- Rooftop steel billboard gantry, chiller units, and communications mast.
"""

import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)

def make_mat(name, color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emissive=(0, 0, 0, 1), emissive_strength=0.0):
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

def create_materials(neon_rot=0):
    mats = {}
    # Dark composite architectural panels
    mats['wall_dark'] = make_mat('wall_dark', color=(0.10, 0.12, 0.14, 1.0), metallic=0.35, roughness=0.40)
    # Concrete floor slabs & spandrels
    mats['concrete_slab'] = make_mat('concrete_slab', color=(0.65, 0.64, 0.62, 1.0), metallic=0.0, roughness=0.70)
    # Reflective curtain wall glass
    mats['glass_curtain'] = make_mat('glass_curtain', color=(0.04, 0.08, 0.14, 1.0), metallic=0.20, roughness=0.04)
    # Shopfront clear glass
    mats['glass_shop'] = make_mat('glass_shop', color=(0.05, 0.08, 0.10, 1.0), metallic=0.05, roughness=0.02)
    # Steel frame & outriggers
    mats['steel_dark'] = make_mat('steel_dark', color=(0.15, 0.16, 0.18, 1.0), metallic=0.85, roughness=0.25)
    
    # --- VIBRANT NEON & LIGHTBOX MATERIALS (Exact match to reference photos) ---
    # Konbini 3-Stripe Canopy
    mats['konbini_green'] = make_mat('konbini_green', color=(0.10, 0.82, 0.38, 1.0), emissive=(0.10, 0.82, 0.38, 1.0), emissive_strength=10.0)
    mats['konbini_orange'] = make_mat('konbini_orange', color=(1.0, 0.48, 0.08, 1.0), emissive=(1.0, 0.48, 0.08, 1.0), emissive_strength=10.0)
    mats['konbini_white'] = make_mat('konbini_white', color=(0.95, 0.98, 1.0, 1.0), emissive=(0.95, 0.98, 1.0, 1.0), emissive_strength=12.0)
    
    # Japanese Vertical Blade Neon Signs
    NEON = [(0.15, 0.92, 1.0), (1.0, 0.12, 0.65), (1.0, 0.86, 0.10), (1.0, 0.16, 0.16)]
    NEON = NEON[neon_rot % 4:] + NEON[:neon_rot % 4]
    mats['neon_cyan'] = make_mat('neon_cyan', color=(*NEON[0], 1.0), emissive=(*NEON[0], 1.0), emissive_strength=16.0)
    mats['neon_magenta'] = make_mat('neon_magenta', color=(*NEON[1], 1.0), emissive=(*NEON[1], 1.0), emissive_strength=16.0)
    mats['neon_yellow'] = make_mat('neon_yellow', color=(*NEON[2], 1.0), emissive=(*NEON[2], 1.0), emissive_strength=15.0)
    mats['neon_red'] = make_mat('neon_red', color=(*NEON[3], 1.0), emissive=(*NEON[3], 1.0), emissive_strength=18.0)
    
    # Warm Interior Store Lighting
    mats['interior_warm'] = make_mat('interior_warm', color=(1.0, 0.82, 0.58, 1.0), emissive=(1.0, 0.82, 0.58, 1.0), emissive_strength=6.0)
    return mats

def build_tower(name="tokyo_neon_tower", width=14.0, depth=12.0, floors=7, neon_rot=0):
    print("Building Tokyo Neon Boulevard Tower in Blender...", name)
    clear_scene()
    mats = create_materials(neon_rot)

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Register all materials on object
    mat_order = [
        'wall_dark',        # 0
        'concrete_slab',    # 1
        'glass_curtain',    # 2
        'glass_shop',       # 3
        'steel_dark',       # 4
        'konbini_green',    # 5
        'konbini_orange',   # 6
        'konbini_white',    # 7
        'neon_cyan',        # 8
        'neon_magenta',     # 9
        'neon_yellow',      # 10
        'neon_red',         # 11
        'interior_warm',    # 12
    ]
    for key in mat_order:
        obj.data.materials.append(mats[key])

    bm = bmesh.new()

    # Building Dimensions
    W = width  # Width along street
    D = depth  # Depth back from street (front face at Y=0)
    H_ground = 4.5
    H_floor = 3.4
    num_floors = floors
    H_total = H_ground + (num_floors - 1) * H_floor # 24.9m to roof

    def add_box(center, size, mat_idx):
        res = bmesh.ops.create_cube(
            bm,
            size=1.0,
            matrix=Matrix.Translation(center) @
                   Matrix.Scale(size[0], 4, Vector((1, 0, 0))) @
                   Matrix.Scale(size[1], 4, Vector((0, 1, 0))) @
                   Matrix.Scale(size[2], 4, Vector((0, 0, 1)))
        )
        for v in res['verts']:
            for f in v.link_faces:
                f.material_index = mat_idx
        return res

    # 1. MAIN BUILDING CORE MASS (Z: 0 to H_total, X: -W/2 to W/2, Y: 0 to -D)
    add_box(Vector((0.0, -D/2, H_total/2)), Vector((W, D, H_total)), 0)

    # 2. GROUND-FLOOR 24/7 JAPANESE KONBINI STORE (Matching reference images)
    # Recessed shopfront under overhang (recess = 1.4m back from street line)
    recess = 1.4
    # Warm glowing interior store cavity
    add_box(Vector((0.0, -recess - 1.5, H_ground/2)), Vector((W - 0.8, 3.0, H_ground - 0.2)), 12)
    
    # Panoramic Shopfront Glass Panes (Z: 0.2 to 3.4m at Y = -recess)
    add_box(Vector((0.0, -recess, 1.8)), Vector((W - 1.0, 0.05, 3.2)), 3)

    # Concrete Side Framing Pillars
    add_box(Vector((-W/2 + 0.35, -recess/2, H_ground/2)), Vector((0.7, recess, H_ground)), 0)
    add_box(Vector(( W/2 - 0.35, -recess/2, H_ground/2)), Vector((0.7, recess, H_ground)), 0)

    # Center Sliding Automatic Glass Doors & Stainless Frame
    add_box(Vector((0.0, -recess + 0.05, 1.4)), Vector((2.2, 0.08, 2.6)), 4)
    # Warm door handle push bars
    add_box(Vector((-0.15, -recess + 0.12, 1.2)), Vector((0.05, 0.05, 0.7)), 4)
    add_box(Vector(( 0.15, -recess + 0.12, 1.2)), Vector((0.05, 0.05, 0.7)), 4)

    # THE ICONIC KONBINI 3-STRIPE ILLUMINATED FASCIA CANOPY (Z: 3.5 to 4.4m, juts out 1.6m past shopfront)
    canopy_y = -recess/2 + 0.1
    canopy_depth = recess + 0.6
    # Top Green Stripe (0.30m tall)
    add_box(Vector((0.0, canopy_y, 4.25)), Vector((W + 0.2, canopy_depth, 0.30)), 5)
    # Middle White Illuminated Band with Logo Face (0.35m tall)
    add_box(Vector((0.0, canopy_y, 3.925)), Vector((W + 0.2, canopy_depth, 0.35)), 7)
    # Bottom Orange Stripe (0.25m tall)
    add_box(Vector((0.0, canopy_y, 3.625)), Vector((W + 0.2, canopy_depth, 0.25)), 6)

    # Sidewalk Drink Vending Machines (Right of entrance)
    add_box(Vector((W/2 - 1.8, -0.6, 1.0)), Vector((1.0, 0.8, 2.0)), 0) # Machine body
    add_box(Vector((W/2 - 1.8, -0.18, 1.25)), Vector((0.85, 0.04, 1.3)), 8) # Cyan/blue drink display glow

    # 3. UPPER FLOORS (Floors 2 to 7): RIBBON WINDOWS & ARCHITECTURAL ACCENTS
    for f in range(1, num_floors):
        z_floor = H_ground + (f - 1) * H_floor
        # Horizontal Floor Slab Reveal Beam (Z: z_floor to z_floor + 0.45m)
        add_box(Vector((0.0, 0.08, z_floor + 0.225)), Vector((W + 0.15, 0.30, 0.45)), 1)
        # Embedded Horizontal Neon Tube Accent Line (glows cyan/magenta along floor edge)
        neon_choice = 8 if f % 2 == 0 else 9
        add_box(Vector((0.0, 0.24, z_floor + 0.40)), Vector((W + 0.18, 0.04, 0.06)), neon_choice)

        # Horizontal Ribbon Window Band (Z: z_floor + 0.6m to z_floor + 2.8m)
        window_h = 2.2
        # Reflective Glass Strip across front facade
        add_box(Vector((0.0, -0.05, z_floor + 0.6 + window_h/2)), Vector((W - 1.2, 0.04, window_h)), 2)

        # Vertical Dark Aluminum Mullions (5 vertical dividers per floor)
        for mx in [-4.8, -2.4, 0.0, 2.4, 4.8]:
            add_box(Vector((mx, 0.04, z_floor + 0.6 + window_h/2)), Vector((0.14, 0.22, window_h + 0.1)), 0)

        # Some floors have illuminated interior office spaces (glowing behind glass)
        if f in [2, 4, 5]:
            add_box(Vector(((f % 3 - 1) * 3.0, -1.2, z_floor + 1.8)), Vector((5.0, 2.0, 2.0)), 12)

    # 4. MASSIVE CANTILEVERED VERTICAL NEON BLADE SIGNS (KANBAN)
    # (Left side: The giant Cyan/Red Japanese Blade Sign as seen in reference image 1)
    blade_x = -W/2 - 0.4 # Out to the left
    blade_y = 0.9        # Projecting out toward oncoming traffic
    blade_z_start = 5.0
    blade_h = 16.0       # Runs up 5 storeys!
    blade_w = 1.8        # 1.8m wide blade

    # Structural Steel Outrigger Trusses (mounting blade to building)
    for truss_z in [6.5, 11.5, 16.5, 20.5]:
        # Horizontal steel beam
        add_box(Vector((-W/2 + 0.4, blade_y/2, truss_z)), Vector((1.6, blade_y + 0.2, 0.12)), 4)
        # Diagonal brace
        add_box(Vector((-W/2 + 0.2, blade_y/2, truss_z - 0.5)), Vector((1.2, 0.10, 1.0)), 4)

    # Giant Vertical Cyan Lightbox Body
    add_box(Vector((blade_x, blade_y, blade_z_start + blade_h/2)), Vector((0.35, blade_w, blade_h)), 8)
    # Perimeter Glowing Ruby Red Neon Border Frame
    add_box(Vector((blade_x + 0.20, blade_y, blade_z_start + blade_h/2)), Vector((0.08, blade_w + 0.16, blade_h + 0.16)), 11)
    # Central Japanese Kanji / Text Panels (simulated bold illuminated signage)
    for panel_i in range(5):
        pz = blade_z_start + 1.2 + panel_i * 3.0
        # Red and White illuminated kanji signboard face
        sign_mat = 11 if panel_i % 2 == 0 else 7
        add_box(Vector((blade_x + 0.19, blade_y, pz)), Vector((0.04, blade_w * 0.78, 2.2)), sign_mat)

    # (Right side: Stacked Multi-Storey Lightboxes as seen in reference image 1 & 2)
    # Right building corner: 4 stacked commercial lightboxes
    box_x = W/2 - 0.2
    box_y = 0.85
    # Box 1: Hot Magenta (Floor 2-3)
    add_box(Vector((box_x, box_y, 7.5)), Vector((1.2, 0.28, 2.8)), 9)
    # Steel mounting arm
    add_box(Vector((box_x, box_y/2, 7.5)), Vector((0.10, box_y, 0.10)), 4)

    # Box 2: Canary Yellow (Floor 4)
    add_box(Vector((box_x, box_y, 11.5)), Vector((1.2, 0.28, 2.8)), 10)
    add_box(Vector((box_x, box_y/2, 11.5)), Vector((0.10, box_y, 0.10)), 4)

    # Box 3: Electric Cyan (Floor 5)
    add_box(Vector((box_x, box_y, 15.5)), Vector((1.2, 0.28, 2.8)), 8)
    add_box(Vector((box_x, box_y/2, 15.5)), Vector((0.10, box_y, 0.10)), 4)

    # Box 4: Vivid Red (Floor 6)
    add_box(Vector((box_x, box_y, 19.5)), Vector((1.2, 0.28, 2.8)), 11)
    add_box(Vector((box_x, box_y/2, 19.5)), Vector((0.10, box_y, 0.10)), 4)

    # 5. ROOFTOP MECHANICALS & BILLBOARD GANTRY (Z = H_total to H_total + 4.5m)
    # Perimeter Parapet Wall
    add_box(Vector((0.0, 0.05, H_total + 0.45)), Vector((W + 0.1, 0.25, 0.90)), 0)
    add_box(Vector((-W/2 + 0.1, -D/2, H_total + 0.45)), Vector((0.25, D, 0.90)), 0)
    add_box(Vector(( W/2 - 0.1, -D/2, H_total + 0.45)), Vector((0.25, D, 0.90)), 0)

    # Heavy Steel Rooftop Billboard Truss Gantry (Center-right of roof)
    board_x = 1.5
    board_z = H_total + 2.8
    # Steel truss legs
    for leg_x in [-2.5, 2.5]:
        add_box(Vector((board_x + leg_x, -1.5, H_total + 1.2)), Vector((0.20, 0.20, 2.4)), 4)
        add_box(Vector((board_x + leg_x, -3.5, H_total + 1.2)), Vector((0.20, 0.20, 2.4)), 4)
    # Billboard Display Board (5.6m wide x 3.2m tall)
    add_box(Vector((board_x, -1.5, board_z)), Vector((5.8, 0.35, 3.2)), 0)
    # Front Illuminated Advertising Face (Glowing yellow/cyan skyline billboard)
    add_box(Vector((board_x, -1.3, board_z)), Vector((5.4, 0.05, 2.8)), 10)

    # Air-Con Chiller Units (Left side of roof)
    add_box(Vector((-4.0, -3.5, H_total + 0.8)), Vector((1.8, 1.4, 1.6)), 0)
    add_box(Vector((-4.0, -3.5, H_total + 1.62)), Vector((1.4, 1.0, 0.1)), 4) # Exhaust grille

    # Communications Antenna Mast & Aircraft Warning Red Light
    add_box(Vector((-5.5, -1.5, H_total + 3.0)), Vector((0.15, 0.15, 6.0)), 4) # Steel mast
    add_box(Vector((-5.5, -1.5, H_total + 6.05)), Vector((0.25, 0.25, 0.25)), 11) # Red warning beacon

    # Recalculate normals & clean geometry
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    for p in mesh.polygons:
        p.use_smooth = True

    # UV Unwrap
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Export to public/models/buildings and landmarks
    out_public = "/Users/arunmallikarjun/Desktop/3D_Game/public/models/buildings/%s.glb" % name

    bpy.ops.export_scene.gltf(
        filepath=out_public,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    print("Exported Tokyo Neon Boulevard Tower to:", out_public)
    return obj

def setup_viewport_and_lights():
    # Studio lighting matching the sunset / twilight golden hour in reference images
    # Golden Hour Low Sun
    sun_data = bpy.data.lights.new("Sunset_Sun", 'SUN')
    sun_data.energy = 3.5
    sun_data.color = (1.0, 0.65, 0.35) # warm golden hour sunlight
    sun_obj = bpy.data.objects.new("Sunset_Sun", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(72), math.radians(10), math.radians(-55))

    # Cool Twilight Ambient Sky Fill
    sky_data = bpy.data.lights.new("Twilight_Sky", 'SUN')
    sky_data.energy = 1.0
    sky_data.color = (0.45, 0.60, 0.95) # cool blue twilight sky
    sky_obj = bpy.data.objects.new("Twilight_Sky", sky_data)
    bpy.context.scene.collection.objects.link(sky_obj)
    sky_obj.rotation_euler = (math.radians(45), math.radians(0), math.radians(120))

    # Camera looking up at the tower from street level (dramatic low angle matching chase view)
    cam_data = bpy.data.cameras.new("Street_Cam")
    cam_data.lens = 28 # wide angle dramatic lens
    cam_obj = bpy.data.objects.new("Street_Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (2.0, 18.0, 1.4) # 1.4m driver eye height, 18m back
    cam_obj.rotation_euler = (math.radians(78), 0, math.radians(175))
    bpy.context.scene.camera = cam_obj

    # Configure 3D viewport
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'MATERIAL'
                    space.overlay.show_relationship_lines = False
                    space.overlay.show_extras = False
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.object.select_all(action='SELECT')
                        bpy.ops.view3d.view_selected()
                        bpy.ops.object.select_all(action='DESELECT')

# ponytail: variety comes from footprint + neon palette only; per-variant sign
# layouts would need the sign block parameterised too -- do that if they read as clones.
VARIANTS = [
    dict(name="tokyo_neon_tower",    width=14.0, depth=12.0, floors=7,  neon_rot=0),
    dict(name="tokyo_neon_tower_b",  width=10.0, depth=11.0, floors=5,  neon_rot=1),
    dict(name="tokyo_neon_tower_c",  width=18.0, depth=14.0, floors=9,  neon_rot=2),
    dict(name="tokyo_neon_tower_d",  width=12.0, depth=10.0, floors=12, neon_rot=3),
]

def main():
    for v in VARIANTS:
        build_tower(**v)
    setup_viewport_and_lights()
    print("Tokyo Neon Boulevard Tower Build Complete!")

if __name__ == "__main__":
    main()
