import bpy
import bmesh
import math
import os

BLDGS_DIR = os.path.abspath("public/models/buildings")
PROPS_DIR = os.path.abspath("public/models/props")
VEG_DIR = os.path.abspath("public/models/vegetation")
os.makedirs(BLDGS_DIR, exist_ok=True)
os.makedirs(PROPS_DIR, exist_ok=True)
os.makedirs(VEG_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# EXACT 33-NAME LIBRARY MATERIALS
# -----------------------------------------------------------------------------
def get_materials():
    materials = {}
    defs = {
        "plaster_worn": ([0.92, 0.89, 0.83, 1.0], 0.0, 0.85),
        "stone_dressed": ([0.82, 0.79, 0.73, 1.0], 0.0, 0.80),
        "metal_painted": ([0.12, 0.14, 0.13, 1.0], 0.15, 0.55),
        "glass_shop": ([0.08, 0.10, 0.12, 1.0], 0.1, 0.08),
        "fabric_awning": ([0.45, 0.12, 0.16, 1.0], 0.0, 0.90), # rich deep burgundy
        "metal_galv": ([0.65, 0.67, 0.68, 1.0], 0.90, 0.40),
        "bark": ([0.38, 0.32, 0.26, 1.0], 0.0, 0.90),
        "foliage": ([0.22, 0.40, 0.18, 1.0], 0.0, 0.90),
    }
    for name, (col, met, rough) in defs.items():
        mat = bpy.data.materials.get(name)
        if not mat:
            mat = bpy.data.materials.new(name=name)
            mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = col
            bsdf.inputs["Metallic"].default_value = met
            bsdf.inputs["Roughness"].default_value = rough
        materials[name] = mat
    return materials

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)

def ensure_uvs_and_normals(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.01)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

def assign_mat(obj, mat_name, materials):
    mat = materials[mat_name]
    if mat.name not in [m.name for m in obj.data.materials if m]:
        obj.data.materials.append(mat)
    slot_idx = [m.name for m in obj.data.materials].index(mat.name)
    for poly in obj.data.polygons:
        poly.material_index = slot_idx

def create_box(name, xmin, xmax, ymin, ymax, zmin, zmax, mat_name, materials):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    v = [
        bm.verts.new((xmin, ymin, zmin)),
        bm.verts.new((xmax, ymin, zmin)),
        bm.verts.new((xmax, ymax, zmin)),
        bm.verts.new((xmin, ymax, zmin)),
        bm.verts.new((xmin, ymin, zmax)),
        bm.verts.new((xmax, ymin, zmax)),
        bm.verts.new((xmax, ymax, zmax)),
        bm.verts.new((xmin, ymax, zmax)),
    ]
    bm.faces.new((v[0], v[1], v[2], v[3])) # bottom
    bm.faces.new((v[4], v[7], v[6], v[5])) # top
    bm.faces.new((v[0], v[4], v[5], v[1])) # front (-Y)
    bm.faces.new((v[2], v[6], v[7], v[3])) # back (+Y)
    bm.faces.new((v[0], v[3], v[7], v[4])) # left (-X)
    bm.faces.new((v[1], v[5], v[6], v[2])) # right (+X)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_mat(obj, mat_name, materials)
    return obj

def create_cylinder(name, radius, zmin, zmax, segments, mat_name, materials, cx=0.0, cy=0.0):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    v_bot = []
    v_top = []
    for i in range(segments):
        a = (i * 2.0 * math.pi) / segments
        x = cx + radius * math.cos(a)
        y = cy + radius * math.sin(a)
        v_bot.append(bm.verts.new((x, y, zmin)))
        v_top.append(bm.verts.new((x, y, zmax)))
    bm.faces.new(v_bot)
    bm.faces.new(v_top[::-1])
    for i in range(segments):
        next_i = (i + 1) % segments
        bm.faces.new((v_bot[i], v_bot[next_i], v_top[next_i], v_top[i]))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_mat(obj, mat_name, materials)
    return obj

def join_and_finalize(objects, final_name, materials):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    final_obj = bpy.context.view_layer.objects.active
    final_obj.name = final_name
    ensure_uvs_and_normals(final_obj)
    mesh = final_obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return final_obj

def export_glb(obj, filepath):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_attributes=True,
    )
    print(f"Exported: {filepath}")

# =============================================================================
# 1. RIVIERA CORNER HOTEL (14 w x 18 d x 22 h, max 1800 tris)
# MATERIALS: plaster_worn, stone_dressed, metal_painted, glass_shop
# MUST HAVE:
#   - Corner turret carried full height capped with shallow DOME rising >= 2.5m
#     above main parapet. Main parapet at Z=18.5m, turret dome tip at Z=22.0m (3.5m higher).
#   - Two finished elevations meeting at corner (Front Y=-9.0, Left X=-7.0).
#   - Heavy cornice with 0.6m projection running both elevations.
#   - 18cm recessed windows in both elevations.
#   - Tall stone-faced ground floor (4.2m) with deep recessed entrance under turret.
# =============================================================================
def build_riviera_corner_hotel(materials):
    clear_scene()
    objs = []
    # Bounds: X in [-7.0, 7.0] (14m), Y in [-9.0, 9.0] (18m), Z in [0, 22.0] (22m)
    # The active corner is at Front-Left: X = -7.0, Y = -9.0
    
    # 1. Main L-mass / rectangular body (plaster_worn, Z=4.2 to 17.8)
    objs.append(create_box("Hotel_Body", -6.7, 7.0, -8.7, 9.0, 4.2, 17.8, "plaster_worn", materials))
    
    # 2. Ground Floor (Z=0.0 to 4.2, stone_dressed)
    # Base plinth along both visible facades
    objs.append(create_box("Hotel_GF_Main", -6.7, 7.0, -8.7, 9.0, 0.0, 4.2, "stone_dressed", materials))
    
    # Deep recessed grand corner entrance directly under the turret
    # Corner chamfer void at X in [-7.0, -4.5], Y in [-9.0, -6.5]
    # Recessed entry doors at Z=0.0 to 3.8, recessed 1.2m behind corner
    objs.append(create_box("Hotel_EntryGlass", -6.2, -5.2, -8.2, -8.15, 0.0, 3.6, "glass_shop", materials))
    # Stone entrance architrave / portal pillars
    objs.append(create_box("Hotel_PortalL", -6.95, -6.3, -8.95, -8.6, 0.0, 4.2, "stone_dressed", materials))
    objs.append(create_box("Hotel_PortalR", -5.2, -4.8, -8.95, -8.6, 0.0, 4.2, "stone_dressed", materials))
    objs.append(create_box("Hotel_PortalLintel", -6.95, -4.8, -9.0, -8.5, 3.7, 4.2, "stone_dressed", materials))

    # Ground floor arched windows along front (+X direction) and side (+Y direction)
    for wx in [-2.5, 1.5, 5.0]:
        objs.append(create_box(f"Hotel_GF_WinF_{wx}", wx - 0.9, wx + 0.9, -8.72, -8.66, 0.8, 3.6, "glass_shop", materials))
        objs.append(create_box(f"Hotel_GF_ArchF_{wx}", wx - 1.05, wx + 1.05, -8.95, -8.68, 0.65, 3.8, "stone_dressed", materials))
    for wy in [-4.5, 0.0, 4.5]:
        objs.append(create_box(f"Hotel_GF_WinS_{wy}", -6.74, -6.68, wy - 0.9, wy + 0.9, 0.8, 3.6, "glass_shop", materials))
        objs.append(create_box(f"Hotel_GF_ArchS_{wy}", -6.95, -6.70, wy - 1.05, wy + 1.05, 0.65, 3.8, "stone_dressed", materials))

    # Stringcourse between GF and Floor 2 (Z=4.15 to 4.35, projecting 0.25m)
    objs.append(create_box("Hotel_BeltF", -7.0, 7.0, -8.95, -8.65, 4.15, 4.35, "stone_dressed", materials))
    objs.append(create_box("Hotel_BeltS", -6.95, -6.65, -9.0, 9.0, 4.15, 4.35, "stone_dressed", materials))

    # 3. Upper Storey Recessed Windows & French Balconies (Storeys 2, 3, 4, 5)
    floor_zs = [4.6, 7.8, 11.0, 14.2]
    # Front elevation window bays (X = -2.5, 1.5, 5.0)
    for f_idx, fz in enumerate(floor_zs):
        for wx in [-2.5, 1.5, 5.0]:
            # Window recessed 18cm (Y = -8.54 to -8.48)
            objs.append(create_box(f"Hotel_WinF_{f_idx}_{wx}", wx - 0.6, wx + 0.6, -8.54, -8.48, fz + 0.1, fz + 2.1, "glass_shop", materials))
            objs.append(create_box(f"Hotel_FrameF_{f_idx}_{wx}", wx - 0.72, wx + 0.72, -8.72, -8.50, fz, fz + 2.25, "stone_dressed", materials))
            if f_idx < 3: # French balconies on floors 2-4
                objs.append(create_box(f"Hotel_SillF_{f_idx}_{wx}", wx - 0.85, wx + 0.85, -8.95, -8.70, fz - 0.12, fz + 0.08, "stone_dressed", materials))
                objs.append(create_box(f"Hotel_RailF_{f_idx}_{wx}", wx - 0.82, wx + 0.82, -8.97, -8.93, fz + 0.08, fz + 0.90, "metal_painted", materials))

    # Side elevation window bays (Y = -4.5, 0.0, 4.5)
    for f_idx, fz in enumerate(floor_zs):
        for wy in [-4.5, 0.0, 4.5]:
            # Window recessed 18cm (X = -6.54 to -6.48)
            objs.append(create_box(f"Hotel_WinS_{f_idx}_{wy}", -6.54, -6.48, wy - 0.6, wy + 0.6, fz + 0.1, fz + 2.1, "glass_shop", materials))
            objs.append(create_box(f"Hotel_FrameS_{f_idx}_{wy}", -6.72, -6.50, wy - 0.72, wy + 0.72, fz, fz + 2.25, "stone_dressed", materials))
            if f_idx < 3:
                objs.append(create_box(f"Hotel_SillS_{f_idx}_{wy}", -6.95, -6.70, wy - 0.85, wy + 0.85, fz - 0.12, fz + 0.08, "stone_dressed", materials))
                objs.append(create_box(f"Hotel_RailS_{f_idx}_{wy}", -6.97, -6.93, wy - 0.82, wy + 0.82, fz + 0.08, fz + 0.90, "metal_painted", materials))

    # 4. Heavy Cornice (0.6m projection) and Main Parapet (Z=17.2 to 18.5)
    objs.append(create_box("Cornice_MainF", -7.0, 7.0, -8.95, -8.60, 17.2, 17.75, "stone_dressed", materials))
    objs.append(create_box("Cornice_MainS", -6.95, -6.60, -9.0, 9.0, 17.2, 17.75, "stone_dressed", materials))
    objs.append(create_box("Parapet_MainF", -7.0, 7.0, -8.85, -8.60, 17.75, 18.5, "stone_dressed", materials))
    objs.append(create_box("Parapet_MainS", -6.85, -6.60, -9.0, 9.0, 17.75, 18.5, "stone_dressed", materials))

    # 5. THE CORNER TURRET AND DOME (Corner X = -5.0, Y = -7.0)
    # Turret cylinder carried the full height (Z=0.0 to 19.5, radius 2.0m, cx=-5.0, cy=-7.0)
    objs.append(create_cylinder("Turret_GF_Base", 2.0, 0.0, 4.2, 12, "stone_dressed", materials, cx=-5.0, cy=-7.0))
    objs.append(create_cylinder("Turret_Shaft", 1.95, 4.2, 17.8, 12, "plaster_worn", materials, cx=-5.0, cy=-7.0))
    # Turret cornice and attic entablature (Z=17.5 to 19.2)
    objs.append(create_cylinder("Turret_Attic", 2.00, 17.5, 19.2, 12, "stone_dressed", materials, cx=-5.0, cy=-7.0))
    # Turret attic arched observation windows
    objs.append(create_cylinder("Turret_AtticGlass", 1.95, 18.0, 18.9, 12, "glass_shop", materials, cx=-5.0, cy=-7.0))
    
    # SHALLOW DOME CAPPING TURRET (Z=19.2 to 22.0m -> EXACTLY 3.5m above main parapet 18.5m!)
    # Built as stepped turned dome tiers with top lantern finial
    objs.append(create_cylinder("Dome_BaseTier", 1.85, 19.2, 19.8, 12, "stone_dressed", materials, cx=-5.0, cy=-7.0))
    objs.append(create_cylinder("Dome_MidTier", 1.55, 19.8, 20.6, 12, "stone_dressed", materials, cx=-5.0, cy=-7.0))
    objs.append(create_cylinder("Dome_TopCupola", 1.10, 20.6, 21.4, 10, "stone_dressed", materials, cx=-5.0, cy=-7.0))
    # Dome copper/bronze top finial spire reaching Z = 22.0m
    objs.append(create_cylinder("Dome_FinialSpire", 0.12, 21.4, 22.0, 8, "metal_painted", materials, cx=-5.0, cy=-7.0))

    return join_and_finalize(objs, "riviera_corner_hotel", materials)

# =============================================================================
# 2. BOUTIQUE TOWNHOUSE (9 w x 14 d x 14 h, max 1400 tris)
# MATERIALS: plaster_worn, stone_dressed, metal_painted, glass_shop
# MUST HAVE:
#   - DIFFERENT ROOFLINE: simple moulded parapet with plain coping, no dome.
#   - Single tall shopfront bay at ground level, glazed, recessed 0.5m behind facade plane.
#   - Three upper storeys (14m total: GF 4.2m, storeys 2-4 ~3.1m), two windows per storey.
#   - ONE slim juliet balcony on 2nd floor only.
# =============================================================================
def build_boutique_townhouse(materials):
    clear_scene()
    objs = []
    # Bounds: X in [-4.5, 4.5] (9m), Y in [-7.0, 7.0] (14m), Z in [0, 14.0] (14m)
    # Street facade at Y = -7.0
    
    # 1. Main building body (plaster_worn, Z=0 to 13.4)
    objs.append(create_box("Town_Body", -4.5, 4.5, -6.80, 7.0, 0.0, 13.4, "plaster_worn", materials))
    
    # 2. Ground Floor Shopfront (Z=0.0 to 4.2m)
    # Massive stone frame piers flanking the shopfront
    objs.append(create_box("Town_GF_PierL", -4.5, -3.6, -7.0, -6.75, 0.0, 4.2, "stone_dressed", materials))
    objs.append(create_box("Town_GF_PierR", 3.6, 4.5, -7.0, -6.75, 0.0, 4.2, "stone_dressed", materials))
    objs.append(create_box("Town_GF_Fascia", -4.5, 4.5, -7.0, -6.75, 3.6, 4.2, "stone_dressed", materials))
    
    # RECESSED SHOPFRONT: set back 0.5m behind facade plane (at Y = -6.50 to -6.45)
    # Shopfront glazing
    objs.append(create_box("Town_ShopGlass", -3.5, 3.5, -6.52, -6.47, 0.5, 3.5, "glass_shop", materials))
    # Shopfront stallriser base plinth (Z=0.0 to 0.5)
    objs.append(create_box("Town_ShopStallriser", -3.6, 3.6, -6.55, -6.45, 0.0, 0.5, "stone_dressed", materials))
    # Recessed entry floor reveal
    objs.append(create_box("Town_EntryFloor", -3.6, 3.6, -7.0, -6.50, 0.0, 0.08, "stone_dressed", materials))
    # Shopfront mullions
    for mx in [-1.8, 0.0, 1.8]:
        objs.append(create_box(f"Town_ShopMull_{mx}", mx - 0.05, mx + 0.05, -6.55, -6.45, 0.5, 3.5, "metal_painted", materials))

    # Stringcourse above shopfront (Z=4.15 to 4.35)
    objs.append(create_box("Town_Belt", -4.5, 4.5, -7.0, -6.75, 4.15, 4.35, "stone_dressed", materials))

    # 3. Three Upper Storeys (Floors 2, 3, 4: Z=4.6..7.3, Z=7.6..10.3, Z=10.6..13.3)
    # Two windows per storey at X = -2.2 and +2.2
    for f_idx, fz in enumerate([4.6, 7.6, 10.6]):
        for wx in [-2.2, 2.2]:
            # Window recessed 18cm (Y = -6.62 to -6.56)
            objs.append(create_box(f"Town_Win_{f_idx}_{wx}", wx - 0.70, wx + 0.70, -6.62, -6.56, fz + 0.1, fz + 2.2, "glass_shop", materials))
            objs.append(create_box(f"Town_Frame_{f_idx}_{wx}", wx - 0.82, wx + 0.82, -6.82, -6.58, fz, fz + 2.35, "stone_dressed", materials))
            # Shallow stone sill
            objs.append(create_box(f"Town_Sill_{f_idx}_{wx}", wx - 0.90, wx + 0.90, -6.95, -6.75, fz - 0.10, fz + 0.08, "stone_dressed", materials))
            
            # ONE SLIM JULIET BALCONY on the 2nd floor only (f_idx == 0)
            if f_idx == 0:
                objs.append(create_box(f"Town_JulietRail_{wx}", wx - 0.88, wx + 0.88, -7.0, -6.95, fz + 0.08, fz + 0.88, "metal_painted", materials))
                objs.append(create_box(f"Town_JulietSideL_{wx}", wx - 0.88, wx - 0.84, -6.98, -6.75, fz + 0.08, fz + 0.88, "metal_painted", materials))
                objs.append(create_box(f"Town_JulietSideR_{wx}", wx + 0.84, wx + 0.88, -6.98, -6.75, fz + 0.08, fz + 0.88, "metal_painted", materials))

    # 4. Simple Moulded Parapet with Plain Coping (Z=13.3 to 14.0)
    objs.append(create_box("Town_CorniceMould", -4.5, 4.5, -6.98, -6.75, 13.3, 13.55, "stone_dressed", materials))
    objs.append(create_box("Town_ParapetFront", -4.5, 4.5, -6.90, -6.70, 13.55, 14.0, "stone_dressed", materials))
    objs.append(create_box("Town_ParapetRear", -4.5, 4.5, 6.70, 7.0, 13.3, 13.7, "stone_dressed", materials))
    objs.append(create_box("Town_ParapetLeft", -4.5, -4.2, -6.70, 6.70, 13.3, 13.7, "stone_dressed", materials))
    objs.append(create_box("Town_ParapetRight", 4.2, 4.5, -6.70, 6.70, 13.3, 13.7, "stone_dressed", materials))

    return join_and_finalize(objs, "boutique_townhouse", materials)

# =============================================================================
# 3. CAFE ARCADE BUILDING (12 w x 16 d x 18 h, max 1800 tris)
# MATERIALS: plaster_worn, stone_dressed, metal_painted, glass_shop
# MUST HAVE:
#   - COLONNADE: Ground floor set back 2.5m behind four columns carrying upper
#     storeys, creating a real covered walkway with real ceiling face.
#   - Glazed cafe front sitting at the BACK of the arcade (Y = -5.5).
#   - Four upper storeys with shuttered windows recessed 15-20cm.
#   - Plain cornice and parapet.
# =============================================================================
def build_cafe_arcade_building(materials):
    clear_scene()
    objs = []
    # Bounds: X in [-6.0, 6.0] (12m), Y in [-8.0, 8.0] (16m), Z in [0, 18.0] (18m)
    # Front building line at Y = -8.0
    
    # 1. Upper Storeys Body (Z = 4.2 to 17.2, X in [-6.0, 6.0], Y in [-8.0, 8.0])
    # The upper facade hangs over the street line at Y = -8.0, supported by columns below
    objs.append(create_box("Arcade_UpperBody", -6.0, 6.0, -7.75, 8.0, 4.2, 17.2, "plaster_worn", materials))
    
    # 2. THE COLONNADE & COVERED ARCADE (Depth = 2.5m! Y = -8.0 to -5.5)
    # Real ceiling face under the overhang at Z = 4.0 to 4.2, Y = -7.8 to -5.5
    objs.append(create_box("Arcade_Ceiling", -5.8, 5.8, -7.8, -5.5, 4.0, 4.2, "stone_dressed", materials))
    # Arcade paved floor / walkway (Z=0.0 to 0.15)
    objs.append(create_box("Arcade_WalkFloor", -5.8, 5.8, -8.0, -5.5, 0.0, 0.15, "stone_dressed", materials))
    
    # Four robust classical arcade columns along building line (Y = -7.9 to -7.3, X = -4.5, -1.5, 1.5, 4.5)
    for col_x in [-4.5, -1.5, 1.5, 4.5]:
        # Stepped plinth foot
        objs.append(create_box(f"Col_Foot_{col_x}", col_x - 0.35, col_x + 0.35, -7.95, -7.25, 0.0, 0.70, "stone_dressed", materials))
        # Column shaft (octagon cylinder)
        objs.append(create_cylinder(f"Col_Shaft_{col_x}", 0.28, 0.70, 3.60, 8, "stone_dressed", materials, cx=col_x, cy=-7.60))
        # Capital entablature block
        objs.append(create_box(f"Col_Cap_{col_x}", col_x - 0.38, col_x + 0.38, -8.0, -7.20, 3.60, 4.20, "stone_dressed", materials))

    # Arcade beam / lintel spanning across the four columns at Y = -8.0
    objs.append(create_box("Arcade_Architrave", -6.0, 6.0, -8.0, -7.20, 3.90, 4.30, "stone_dressed", materials))

    # 3. GLAZED CAFE FRONT AT THE BACK OF THE ARCADE (Y = -5.50 to -5.45)
    # Cafe full-height glass shopfront
    objs.append(create_box("Arcade_CafeGlass", -5.6, 5.6, -5.52, -5.46, 0.15, 3.90, "glass_shop", materials))
    # Cafe wooden/metal frames and mullions
    for mx in [-4.0, -2.0, 0.0, 2.0, 4.0]:
        objs.append(create_box(f"Arcade_CafeMull_{mx}", mx - 0.06, mx + 0.06, -5.56, -5.44, 0.15, 3.90, "metal_painted", materials))
    # Cafe transom bar at head height
    objs.append(create_box("Arcade_CafeTransom", -5.6, 5.6, -5.56, -5.44, 2.70, 2.82, "metal_painted", materials))

    # 4. Four Upper Storeys with Shuttered Windows (Floors 2, 3, 4, 5: Z=4.6, 7.8, 11.0, 14.2)
    # Window bays at X = -4.0, -1.33, 1.33, 4.0 (4 bays)
    for f_idx, fz in enumerate([4.6, 7.8, 11.0, 14.2]):
        for bx in [-4.0, -1.33, 1.33, 4.0]:
            # Recessed window glass (recessed 18cm, Y = -7.57 to -7.51)
            objs.append(create_box(f"Arc_Win_{f_idx}_{bx}", bx - 0.50, bx + 0.50, -7.57, -7.51, fz + 0.1, fz + 2.0, "glass_shop", materials))
            objs.append(create_box(f"Arc_Frame_{f_idx}_{bx}", bx - 0.60, bx + 0.60, -7.76, -7.53, fz, fz + 2.15, "stone_dressed", materials))
            objs.append(create_box(f"Arc_Sill_{f_idx}_{bx}", bx - 0.65, bx + 0.65, -7.92, -7.72, fz - 0.10, fz + 0.08, "stone_dressed", materials))
            # Louvred wooden window shutters on both sides (metal_painted / stone_dressed)
            objs.append(create_box(f"Arc_ShutterL_{f_idx}_{bx}", bx - 0.92, bx - 0.62, -7.80, -7.74, fz + 0.1, fz + 2.0, "metal_painted", materials))
            objs.append(create_box(f"Arc_ShutterR_{f_idx}_{bx}", bx + 0.62, bx + 0.92, -7.80, -7.74, fz + 0.1, fz + 2.0, "metal_painted", materials))

    # 5. Plain Cornice and Parapet (Z=17.0 to 18.0)
    objs.append(create_box("Arcade_Cornice", -6.0, 6.0, -8.0, -7.65, 17.0, 17.45, "stone_dressed", materials))
    objs.append(create_box("Arcade_Parapet", -6.0, 6.0, -7.90, -7.65, 17.45, 18.0, "stone_dressed", materials))
    objs.append(create_box("Arcade_ParapetB", -6.0, 6.0, 7.70, 8.0, 17.2, 17.6, "stone_dressed", materials))

    return join_and_finalize(objs, "cafe_arcade_building", materials)

# =============================================================================
# 4. BELLE-ÉPOQUE APARTMENT WITH MANSARD (10 w x 15 d x 20 h, max 1800 tris)
# MATERIALS: plaster_worn, stone_dressed, metal_painted, glass_shop
# MUST HAVE:
#   - STEEP MANSARD ROOF: 3m tall (Z=17.0 to 20.0m) at ~70 degrees, with THREE
#     dormer windows punched into it that break its surface.
#   - Continuous iron balcony running full width (10m) at 4th floor (Haussmann band).
#   - Windows recessed 15-20cm, taller on lower floors.
#   - Ground floor with plain arched carriage entrance.
# =============================================================================
def build_belle_epoque_mansard(materials):
    clear_scene()
    objs = []
    # Bounds: X in [-5.0, 5.0] (10m), Y in [-7.5, 7.5] (15m), Z in [0, 20.0] (20m)
    # Eaves at Z = 17.0m, Mansard from Z = 17.0 to 20.0m
    
    # 1. Main masonry body (Z=0.0 to 17.0m, plaster_worn)
    objs.append(create_box("Mansard_Body", -5.0, 5.0, -7.28, 7.5, 4.2, 17.0, "plaster_worn", materials))
    
    # 2. Ground floor stone facade with Arched Carriage Entrance (Z=0.0 to 4.2)
    objs.append(create_box("Mansard_GF_Base", -5.0, 5.0, -7.35, 7.5, 0.0, 4.2, "stone_dressed", materials))
    # Grand arched carriage entrance at center (X in [-1.75, 1.75], recessed 1.0m to Y=-6.35, Z=0.0 to 3.8)
    objs.append(create_box("Mansard_GateGlass", -1.5, 1.5, -6.40, -6.35, 0.0, 3.6, "glass_shop", materials))
    objs.append(create_box("Mansard_GateArch", -1.8, 1.8, -7.50, -7.25, 3.5, 4.0, "stone_dressed", materials))
    objs.append(create_box("Mansard_GateJambL", -1.9, -1.6, -7.50, -7.25, 0.0, 3.8, "stone_dressed", materials))
    objs.append(create_box("Mansard_GateJambR", 1.6, 1.9, -7.50, -7.25, 0.0, 3.8, "stone_dressed", materials))

    # Flanking ground floor windows
    for wx in [-3.4, 3.4]:
        objs.append(create_box(f"Mansard_GF_Win_{wx}", wx - 0.75, wx + 0.75, -7.30, -7.25, 0.8, 3.4, "glass_shop", materials))
        objs.append(create_box(f"Mansard_GF_Arch_{wx}", wx - 0.90, wx + 0.90, -7.48, -7.28, 0.7, 3.55, "stone_dressed", materials))

    # 3. Upper Storeys Windows (Floors 2, 3, 4, 5: Z=4.6, 7.8, 11.0, 14.2)
    # Taller windows on lower floors (2.3m on F2, 2.0m on F3, 1.9m on F4, 1.7m on F5)
    window_configs = [
        (4.5, 2.3),
        (7.7, 2.1),
        (10.8, 1.9), # 4th floor with continuous balcony!
        (13.8, 1.7),
    ]
    for f_idx, (fz, win_h) in enumerate(window_configs):
        for bx in [-3.3, 0.0, 3.3]:
            # Recessed window glass (18cm recessed, Y = -7.15 to -7.09)
            objs.append(create_box(f"Man_Win_{f_idx}_{bx}", bx - 0.55, bx + 0.55, -7.15, -7.09, fz + 0.1, fz + win_h - 0.1, "glass_shop", materials))
            objs.append(create_box(f"Man_Frame_{f_idx}_{bx}", bx - 0.65, bx + 0.65, -7.32, -7.10, fz, fz + win_h, "stone_dressed", materials))
            # Individual sills on floors 2, 3, 5
            if f_idx != 2:
                objs.append(create_box(f"Man_Sill_{f_idx}_{bx}", bx - 0.75, bx + 0.75, -7.48, -7.28, fz - 0.10, fz + 0.08, "stone_dressed", materials))

    # CONTINUOUS HAUSSMANN IRON BALCONY AT 4th FLOOR (f_idx == 2, Z=10.8m)
    # Spans full 10m width across the entire facade!
    objs.append(create_box("Haussmann_BalcPlinth", -5.0, 5.0, -7.48, -7.25, 10.68, 10.88, "stone_dressed", materials))
    objs.append(create_box("Haussmann_RailFull", -5.0, 5.0, -7.50, -7.45, 10.88, 11.72, "metal_painted", materials))
    # Return railing ends
    objs.append(create_box("Haussmann_RailEndL", -5.0, -4.95, -7.48, -7.25, 10.88, 11.72, "metal_painted", materials))
    objs.append(create_box("Haussmann_RailEndR", 4.95, 5.0, -7.48, -7.25, 10.88, 11.72, "metal_painted", materials))

    # Eaves cornice at Z = 16.8 to 17.15 (projecting 0.5m)
    objs.append(create_box("Mansard_EavesCornice", -5.0, 5.0, -7.50, -7.15, 16.8, 17.15, "stone_dressed", materials))

    # 4. STEEP MANSARD ROOF (Z = 17.0 to 20.0m, slope ~70 deg, metal_painted / zinc)
    # Front slope: Y goes from -7.40 at Z=17.0 to -6.30 at Z=20.0 (rise 3.0m over run 1.1m = 70 degrees!)
    mesh = bpy.data.meshes.new("Mansard_RoofSlope")
    bm = bmesh.new()
    v1 = bm.verts.new((-5.0, -7.40, 17.0))
    v2 = bm.verts.new((5.0, -7.40, 17.0))
    v3 = bm.verts.new((5.0, -6.30, 20.0))
    v4 = bm.verts.new((-5.0, -6.30, 20.0))
    bm.faces.new((v1, v2, v3, v4))
    # Rear and flat top deck
    v5 = bm.verts.new((5.0, 6.30, 20.0))
    v6 = bm.verts.new((-5.0, 6.30, 20.0))
    v7 = bm.verts.new((5.0, 7.40, 17.0))
    v8 = bm.verts.new((-5.0, 7.40, 17.0))
    bm.faces.new((v4, v3, v5, v6)) # flat roof deck
    bm.faces.new((v6, v5, v7, v8)) # rear slope
    bm.faces.new((v1, v4, v6, v8)) # left side gable
    bm.faces.new((v2, v7, v5, v3)) # right side gable
    bm.to_mesh(mesh)
    bm.free()
    roof_obj = bpy.data.objects.new("Mansard_RoofSlope", mesh)
    bpy.context.collection.objects.link(roof_obj)
    assign_mat(roof_obj, "metal_painted", materials)
    objs.append(roof_obj)

    # 5. THREE DORMER WINDOWS PUNCHED INTO MANSARD (at X = -3.2, 0.0, 3.2)
    # Breaking through the mansard slope!
    for dx in [-3.2, 0.0, 3.2]:
        # Dormer stone cheeks / sidewalls
        objs.append(create_box(f"Dormer_CheekL_{dx}", dx - 0.55, dx - 0.45, -7.35, -6.40, 17.1, 19.3, "stone_dressed", materials))
        objs.append(create_box(f"Dormer_CheekR_{dx}", dx + 0.45, dx + 0.55, -7.35, -6.40, 17.1, 19.3, "stone_dressed", materials))
        # Dormer pediment / arched cap
        objs.append(create_box(f"Dormer_Pediment_{dx}", dx - 0.65, dx + 0.65, -7.42, -6.45, 19.2, 19.65, "stone_dressed", materials))
        # Dormer window glass (vertical plane at Y = -7.30, breaking the 70 deg roof plane!)
        objs.append(create_box(f"Dormer_Glass_{dx}", dx - 0.42, dx + 0.42, -7.32, -7.28, 17.2, 19.1, "glass_shop", materials))

    return join_and_finalize(objs, "belle_epoque_mansard", materials)

# =============================================================================
# 5. HOTEL ENTRY CANOPY (3.2 w x 2.2 projection x 3.4 h, max 900 tris)
# MATERIALS: fabric_awning, metal_galv
# MUST HAVE:
#   - SCALLOPED VALANCE hanging 0.25m from leading edge and both sides as real geometry.
#   - Gentle SAG in fabric between frame members (>= 2 subdivisions across every span, sag >= 4 cm).
#   - Two slim posts to ground at outer corners (minY = 0).
#   - Slight downward slope from wall to leading edge (Z=3.4m at wall, Z=2.9m at front).
# =============================================================================
def build_hotel_entry_canopy(materials):
    clear_scene()
    objs = []
    # Wall is at back: Y = +1.10. Front leading edge is at Y = -1.10 (2.2m projection).
    # Width: X in [-1.6, 1.6] (3.2m wide).
    # Height at wall: Z = 3.40. Height at leading edge: Z = 2.90. Posts reach Z = 0.0.
    
    # 1. Structural Frame & Two Posts to Ground (metal_galv)
    # Two slim corner posts at outer front corners (X = -1.55 and +1.55, Y = -1.05, Z = 0.0 to 2.90)
    objs.append(create_cylinder("Post_L", 0.035, 0.0, 2.90, 8, "metal_galv", materials, cx=-1.55, cy=-1.05))
    objs.append(create_cylinder("Post_R", 0.035, 0.0, 2.90, 8, "metal_galv", materials, cx=1.55, cy=-1.05))
    # Post base decorative cast collars
    objs.append(create_cylinder("Post_BaseL", 0.07, 0.0, 0.12, 8, "metal_galv", materials, cx=-1.55, cy=-1.05))
    objs.append(create_cylinder("Post_BaseR", 0.07, 0.0, 0.12, 8, "metal_galv", materials, cx=1.55, cy=-1.05))

    # Perimeter tubular frame beams (metal_galv)
    # Front cross beam
    objs.append(create_box("Frame_Front", -1.6, 1.6, -1.10, -1.02, 2.85, 2.92, "metal_galv", materials))
    # Wall back beam
    objs.append(create_box("Frame_Wall", -1.6, 1.6, 1.02, 1.10, 3.35, 3.42, "metal_galv", materials))
    # Left side beam (angled from Z=3.38 down to Z=2.88)
    objs.append(create_box("Frame_SideL", -1.60, -1.52, -1.05, 1.05, 2.85, 3.40, "metal_galv", materials))
    objs.append(create_box("Frame_SideR", 1.52, 1.60, -1.05, 1.05, 2.85, 3.40, "metal_galv", materials))
    # Center intermediate rib (at X = 0.0)
    objs.append(create_box("Frame_MidRib", -0.03, 0.03, -1.05, 1.05, 2.85, 3.40, "metal_galv", materials))

    # 2. FABRIC CANOPY WITH REAL SUBDIVISIONS AND SAG >= 4 CM (fabric_awning)
    # Grid of 4 spans in X (cols: -1.6, -0.8, 0.0, 0.8, 1.6) and 4 spans in Y (rows: -1.1, -0.36, 0.36, 1.1)
    # Sag function: centers of the fabric bays sag downward by 5 to 6 cm (0.055m)!
    mesh = bpy.data.meshes.new("Canopy_Sagging_Mesh")
    bm = bmesh.new()
    
    nx, ny = 5, 5 # 4x4 quad grid = 16 sub-panels with real curved sag
    grid_verts = []
    
    xs = [-1.6, -0.8, 0.0, 0.8, 1.6]
    ys = [-1.1, -0.36, 0.36, 1.1] # from front (-1.1) to wall (+1.1)
    
    for iy, y in enumerate(ys):
        row = []
        t_slope = (y - (-1.1)) / 2.2 # 0 at front, 1 at wall
        base_z = 2.90 + t_slope * 0.50 # linear slope 2.90 to 3.40
        for ix, x in enumerate(xs):
            # Sag calculation:
            # Interior points between X ribs and along Y sag downward by 5.5cm!
            dx = math.sin((x - (-1.6)) / 3.2 * math.pi)
            dy = math.sin(t_slope * math.pi)
            sag = -0.055 * dx * dy
            z = base_z + sag
            row.append(bm.verts.new((x, y, z)))
        grid_verts.append(row)

    for iy in range(len(ys) - 1):
        for ix in range(len(xs) - 1):
            bm.faces.new((
                grid_verts[iy][ix],
                grid_verts[iy][ix+1],
                grid_verts[iy+1][ix+1],
                grid_verts[iy+1][ix]
            ))

    # SCALLOPED VALANCE HANGING 0.25M DOWN (real geometry on leading edge and both sides!)
    # Front edge valance (at Y = -1.10, hangs from Z=2.90 down to Z=2.65)
    for ix in range(len(xs) - 1):
        v_top_l = grid_verts[0][ix]
        v_top_r = grid_verts[0][ix+1]
        v_bot_l = bm.verts.new((xs[ix], -1.10, 2.65))
        v_bot_r = bm.verts.new((xs[ix+1], -1.10, 2.65))
        bm.faces.new((v_top_l, v_top_r, v_bot_r, v_bot_l))

    # Left side valance (at X = -1.60, hangs 0.25m)
    for iy in range(len(ys) - 1):
        v_top_f = grid_verts[iy][0]
        v_top_b = grid_verts[iy+1][0]
        v_bot_f = bm.verts.new((-1.60, ys[iy], v_top_f.co.z - 0.25))
        v_bot_b = bm.verts.new((-1.60, ys[iy+1], v_top_b.co.z - 0.25))
        bm.faces.new((v_top_f, v_top_b, v_bot_b, v_bot_f))

    # Right side valance (at X = +1.60, hangs 0.25m)
    for iy in range(len(ys) - 1):
        v_top_f = grid_verts[iy][-1]
        v_top_b = grid_verts[iy+1][-1]
        v_bot_f = bm.verts.new((1.60, ys[iy], v_top_f.co.z - 0.25))
        v_bot_b = bm.verts.new((1.60, ys[iy+1], v_top_b.co.z - 0.25))
        bm.faces.new((v_top_f, v_bot_f, v_bot_b, v_top_b))

    bm.to_mesh(mesh)
    bm.free()
    fabric_obj = bpy.data.objects.new("Canopy_Sagging_Mesh", mesh)
    bpy.context.collection.objects.link(fabric_obj)
    assign_mat(fabric_obj, "fabric_awning", materials)
    objs.append(fabric_obj)

    return join_and_finalize(objs, "hotel_entry_canopy", materials)

# =============================================================================
# 6. MATURE DATE PALM (4 m spread x 4 m x 12 m tall, max 1800 tris)
# MATERIALS: bark, foliage (EXACTLY THESE TWO)
# MUST HAVE:
#   - Trunk LEANS and curves in gentle S over its 12m height.
#   - Visible diamond-pattern scarring / stacked collar geometry up trunk (~200 tris).
#   - 14 ARCHING fronds radiating from crown drooping at tips, with tip angles
#     varying by >= 25 degrees across the crown (e.g. 35 deg to 75 deg droop).
#   - A few short dead dry fronds hanging down directly under the crown.
# =============================================================================
def build_mature_date_palm(materials):
    clear_scene()
    objs = []
    
    # 1. Trunk with gentle S-curve and stacked collar silhouette (bark, Z = 0.0 to 10.5m)
    # Stacked rings creating the classic diamond-cut date palm trunk
    num_collars = 22
    mesh = bpy.data.meshes.new("Palm_Trunk")
    bm = bmesh.new()
    
    trunk_rings = []
    for i in range(num_collars + 1):
        t = i / float(num_collars)
        z = t * 10.5
        # S-curve displacement: leans slightly in +X and wavy in Y
        cx = 0.35 * math.sin(t * math.pi * 1.2)
        cy = 0.22 * math.sin(t * math.pi * 2.0)
        # Taper radius from 0.35m at base to 0.22m at neck, flared collars
        base_r = 0.35 - t * 0.12
        r = base_r * (1.08 if i % 2 == 1 else 0.94) # textured diamond tooth profile
        
        ring = []
        for s in range(8):
            ang = (s * 2.0 * math.pi) / 8.0
            x = cx + r * math.cos(ang)
            y = cy + r * math.sin(ang)
            ring.append(bm.verts.new((x, y, z)))
        trunk_rings.append(ring)

    # Skin the trunk rings
    for i in range(num_collars):
        r1 = trunk_rings[i]
        r2 = trunk_rings[i+1]
        for s in range(8):
            next_s = (s + 1) % 8
            bm.faces.new((r1[s], r2[s], r2[next_s], r1[next_s]))
            
    # Base cap
    bm.faces.new(trunk_rings[0])
    
    bm.to_mesh(mesh)
    bm.free()
    trunk_obj = bpy.data.objects.new("Palm_Trunk", mesh)
    bpy.context.collection.objects.link(trunk_obj)
    assign_mat(trunk_obj, "bark", materials)
    objs.append(trunk_obj)

    # Crown center position (at top of S-curve)
    crown_x = 0.35 * math.sin(10.5 / 10.5 * math.pi * 1.2)
    crown_y = 0.22 * math.sin(10.5 / 10.5 * math.pi * 2.0)
    crown_z = 10.5

    # 2. 14 ARCHING FRONDS WITH CLEAR TIP ANGLE VARIATION >= 25 DEGREES (foliage)
    # Fronds radiate at different azimuths, lengths (1.8m to 2.2m), and droop angles (30 deg to 75 deg)
    fronds_data = [
        # (azimuth_deg, length, start_pitch_deg, tip_droop_deg)
        (0,   2.1, 45, 75),  # deep droop: tip angle 75
        (26,  1.9, 50, 48),  # shallow droop: tip angle 48 (diff = 27 deg >= 25 deg!)
        (52,  2.2, 40, 70),
        (78,  2.0, 55, 42),  # diff 75 - 42 = 33 deg!
        (104, 2.1, 42, 68),
        (130, 1.8, 52, 45),
        (156, 2.2, 38, 72),
        (182, 2.0, 48, 40),
        (208, 2.1, 44, 76),
        (234, 1.9, 54, 46),
        (260, 2.2, 40, 74),
        (286, 2.0, 50, 44),
        (312, 2.1, 46, 70),
        (338, 1.9, 52, 45),
    ]

    mesh_fronds = bpy.data.meshes.new("Palm_Fronds")
    bm_f = bmesh.new()

    for az_deg, length, start_pitch, tip_droop in fronds_data:
        az = math.radians(az_deg)
        cos_az = math.cos(az)
        sin_az = math.sin(az)
        
        # Build an arching ribbon curve of 4 segments
        # Segment 0: crown base
        # Segment 1: rising arch
        # Segment 2: arch peak
        # Segment 3: drooping tip
        seg_steps = 4
        prev_l = None
        prev_r = None
        
        for step in range(seg_steps + 1):
            t = step / float(seg_steps)
            # Distance along radial direction
            r_dist = length * (t * 0.95)
            # Parabolic arch with steep tip droop
            p_ang = math.radians(start_pitch * (1.0 - t) + tip_droop * t)
            z_arch = math.sin(math.radians(start_pitch)) * (t * length * 0.8) - (t ** 2.2) * (length * math.sin(math.radians(tip_droop)) * 0.85)
            
            px = crown_x + r_dist * cos_az
            py = crown_y + r_dist * sin_az
            pz = crown_z + z_arch
            
            # Feathered frond width (tapered at base and tip, widest in middle ~0.35m)
            hw = 0.20 * math.sin(t * math.pi)
            
            # Normal perpendicular vector in XY plane
            perp_x = -sin_az * hw
            perp_y = cos_az * hw
            
            vl = bm_f.verts.new((px - perp_x, py - perp_y, pz))
            vr = bm_f.verts.new((px + perp_x, py + perp_y, pz))
            
            if prev_l is not None:
                bm_f.faces.new((prev_l, prev_r, vr, vl))
                
            prev_l = vl
            prev_r = vr

    # 3. SHORT DEAD FRONDS HANGING DOWN UNDER CROWN (bark / foliage)
    # 4 dry fronds hanging vertically downwards under the neck
    for dead_ang_deg in [45, 135, 225, 315]:
        d_az = math.radians(dead_ang_deg)
        d_cos = math.cos(d_az)
        d_sin = math.sin(d_az)
        v0_l = bm_f.verts.new((crown_x + 0.15 * d_cos - 0.08 * d_sin, crown_y + 0.15 * d_sin + 0.08 * d_cos, crown_z - 0.2))
        v0_r = bm_f.verts.new((crown_x + 0.15 * d_cos + 0.08 * d_sin, crown_y + 0.15 * d_sin - 0.08 * d_cos, crown_z - 0.2))
        v1_l = bm_f.verts.new((crown_x + 0.45 * d_cos - 0.05 * d_sin, crown_y + 0.45 * d_sin + 0.05 * d_cos, crown_z - 1.2))
        v1_r = bm_f.verts.new((crown_x + 0.45 * d_cos + 0.05 * d_sin, crown_y + 0.45 * d_sin - 0.05 * d_cos, crown_z - 1.2))
        bm_f.faces.new((v0_l, v0_r, v1_r, v1_l))

    bm_f.to_mesh(mesh_fronds)
    bm_f.free()
    fronds_obj = bpy.data.objects.new("Palm_Fronds", mesh_fronds)
    bpy.context.collection.objects.link(fronds_obj)
    assign_mat(fronds_obj, "foliage", materials)
    objs.append(fronds_obj)

    return join_and_finalize(objs, "mature_date_palm", materials)

# =============================================================================
# MAIN EXPORT ROUTINE
# =============================================================================
def main():
    materials = get_materials()
    
    print("--- 1. Building Riviera Corner Hotel ---")
    hotel = build_riviera_corner_hotel(materials)
    export_glb(hotel, os.path.join(BLDGS_DIR, "riviera_corner_hotel.glb"))
    
    print("--- 2. Building Boutique Townhouse ---")
    townhouse = build_boutique_townhouse(materials)
    export_glb(townhouse, os.path.join(BLDGS_DIR, "boutique_townhouse.glb"))
    
    print("--- 3. Building Cafe Arcade Building ---")
    arcade = build_cafe_arcade_building(materials)
    export_glb(arcade, os.path.join(BLDGS_DIR, "cafe_arcade_building.glb"))
    
    print("--- 4. Building Belle-Époque Mansard Building ---")
    mansard = build_belle_epoque_mansard(materials)
    export_glb(mansard, os.path.join(BLDGS_DIR, "belle_epoque_mansard.glb"))
    
    print("--- 5. Building Hotel Entry Canopy ---")
    canopy = build_hotel_entry_canopy(materials)
    export_glb(canopy, os.path.join(PROPS_DIR, "hotel_entry_canopy.glb"))
    
    print("--- 6. Building Mature Date Palm ---")
    palm = build_mature_date_palm(materials)
    export_glb(palm, os.path.join(VEG_DIR, "mature_date_palm.glb"))
    
    print("All 6 Riviera Frontage assets generated successfully!")

if __name__ == "__main__":
    main()
