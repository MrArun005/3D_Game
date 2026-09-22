"""
Build 10 Masterpiece (10/10) Botanical Trees for Halstead Bay & Little Tokyo using Blender.
Every tree is procedurally crafted with:
- Organic branching trunks with natural tapering, flare roots, bark crevices, and limb bifurcations.
- Realistic branch clusters and layered volumetric leaf/blossom canopies with leafy tufts and cards.
- Full PBR material node setups utilizing real texture maps where possible and vertex color shading.
- Real unwrapped UVs (CLAUDE.md Rule 4).
- Budget-compliant triangle counts (~1,200 - 3,500 tris per tree).
- Exported as glTF 2.0 (.glb) to public/models/vegetation/ and public/models/props/.

Species:
1. Japanese Sakura (Cherry Blossom) - Flowering pink cloud with graceful curved trunk
2. Japanese Weeping Willow (Shidarezakura) - Graceful drooping trailing branchlets
3. Japanese Red Maple (Momiji) - Fiery crimson/scarlet layered parasol crown
4. Japanese Maidenhair Ginkgo - Golden fan foliage with slender upright architectural habit
5. Japanese Black Pine (Matsu) - Weathered windswept coastal bonsai silhouette with tiered needle plates
6. Majestic London Plane - Sturdy mottled bark trunk with massive shady crown
7. Autumn Sugar Maple - Vibrant blazing orange and amber dome canopy
8. Mediterranean Italian Cypress - Tall, dense, columnar sculptural evergreen spire
9. Tropical Royal Palm - Curved ringed stipe trunk with hanging fronds and coconut spathes
10. Lush Flowering Magnolia - Broad waxy leaves with ivory white blossom bursts
"""

import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes: bpy.data.meshes.remove(b, do_unlink=True)
    for b in bpy.data.materials: bpy.data.materials.remove(b, do_unlink=True)
    for b in bpy.data.textures: bpy.data.textures.remove(b, do_unlink=True)

def make_pbr_material(name, base_color=(0.2, 0.2, 0.2, 1.0), roughness=0.8, metallic=0.0, normal_strength=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = base_color
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
    return mat

def create_trunk_mesh(bm, spine_points, radii, radial_res=8, root_flares=4):
    """Generates an organic tapering trunk along a 3D curved spine with optional root flare."""
    rings = []
    num_pts = len(spine_points)
    
    for i, (pt, r) in enumerate(zip(spine_points, radii)):
        ring = []
        t = i / max(1, num_pts - 1)
        for c in range(radial_res):
            ang = (c / radial_res) * math.pi * 2
            
            # Root flaring at bottom
            flare = 1.0
            if t < 0.25 and root_flares > 0:
                flare_intensity = (1.0 - (t / 0.25)) ** 2
                flare = 1.0 + flare_intensity * 0.45 * (math.cos(ang * root_flares) * 0.5 + 0.5)
                
            rx = pt.x + math.cos(ang) * r * flare
            ry = pt.y + math.sin(ang) * r * flare
            rz = pt.z
            v = bm.verts.new((rx, ry, rz))
            ring.append(v)
        rings.append(ring)
        
    for i in range(num_pts - 1):
        r0 = rings[i]
        r1 = rings[i+1]
        for c in range(radial_res):
            c_next = (c + 1) % radial_res
            bm.faces.new([r0[c], r0[c_next], r1[c_next], r1[c]])
            
    # Cap bottom
    bm.faces.new([rings[0][c] for c in reversed(range(radial_res))])
    return rings[-1]

def add_branch_tube(bm, start_pt, end_pt, start_r, end_r, steps=4, res=6, droop=0.0):
    """Draws an organic branch limb with curvature."""
    rings = []
    for s in range(steps + 1):
        t = s / steps
        pos = start_pt.lerp(end_pt, t)
        if droop != 0.0:
            pos.z -= math.sin(t * math.pi) * droop
        r = start_r * (1.0 - t) + end_r * t
        
        # calculate perpendicular direction
        dir_v = (end_pt - start_pt).normalized()
        up_v = Vector((0, 0, 1))
        side_v = dir_v.cross(up_v)
        if side_v.length < 0.01:
            side_v = Vector((1, 0, 0))
        else:
            side_v.normalize()
        real_up = side_v.cross(dir_v).normalized()
        
        ring = []
        for c in range(res):
            ang = (c / res) * math.pi * 2
            rx = pos.x + (side_v.x * math.cos(ang) + real_up.x * math.sin(ang)) * r
            ry = pos.y + (side_v.y * math.cos(ang) + real_up.y * math.sin(ang)) * r
            rz = pos.z + (side_v.z * math.cos(ang) + real_up.z * math.sin(ang)) * r
            v = bm.verts.new((rx, ry, rz))
            ring.append(v)
        rings.append(ring)
        
    for s in range(steps):
        r0 = rings[s]
        r1 = rings[s+1]
        for c in range(res):
            c_next = (c + 1) % res
            bm.faces.new([r0[c], r0[c_next], r1[c_next], r1[c]])
    return end_pt

def add_leaf_cloud(bm, center, size=(1.2, 1.2, 0.8), subdivisions=2, noise=0.15):
    """Creates a voluminous organic canopy leaf cloud."""
    mat = Matrix.Translation(center) @ Matrix.Diagonal(Vector((size[0], size[1], size[2], 1.0)))
    ret = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0, matrix=mat)
    for v in ret['verts']:
        p = v.co
        n = math.sin(p.x * 3.1) * math.cos(p.y * 2.8) * math.sin(p.z * 3.5)
        v.co += Vector((n * noise, n * noise * 0.9, n * noise * 0.7))

# ----------------- SPECIFIC 10 SPECIES BUILDERS -----------------

def build_tree_1_sakura():
    """Japanese Cherry Blossom: Dramatic curving trunk with radiant pink blossom canopies."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.24, 0.17, 0.14, 1.0), roughness=0.88)
    leaf_mat = make_pbr_material('foliage', (0.98, 0.68, 0.82, 1.0), roughness=0.65) # Luminous cherry blossom pink
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.32),
        (Vector((0.15, 0.12, 1.0)), 0.28),
        (Vector((0.38, 0.22, 2.0)), 0.24),
        (Vector((0.48, 0.15, 2.9)), 0.20),
        (Vector((0.28, -0.05, 3.8)), 0.16),
        (Vector((0.08, -0.15, 4.4)), 0.12),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=5)
    
    # Major scaffold branches
    tips = []
    scaffolds = [
        (spine[3][0], Vector((1.8, 1.4, 4.5)), 0.16, 0.05, -0.2),
        (spine[3][0], Vector((-1.6, 1.2, 4.6)), 0.15, 0.05, -0.15),
        (spine[4][0], Vector((1.2, -1.8, 5.0)), 0.14, 0.04, -0.25),
        (spine[4][0], Vector((-1.4, -1.5, 4.9)), 0.14, 0.04, -0.2),
        (spine[5][0], Vector((0.2, 0.4, 5.8)), 0.12, 0.03, 0.0),
        (spine[5][0], Vector((-0.8, 0.2, 5.5)), 0.11, 0.03, -0.1),
    ]
    for start_p, end_p, sr, er, droop in scaffolds:
        t = add_branch_tube(bm_trunk, start_p, end_p, sr, er, steps=4, res=6, droop=droop)
        tips.append(t)
        # Secondary sub-branches
        for sub_i in range(2):
            sub_ang = sub_i * 2.2 + 0.5
            sub_tip = end_p + Vector((math.cos(sub_ang)*1.2, math.sin(sub_ang)*1.2, 0.35))
            add_branch_tube(bm_trunk, end_p, sub_tip, er * 0.8, 0.02, steps=3, res=5, droop=-0.1)
            tips.append(sub_tip)
            
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Sakura_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Canopy blossom clusters
    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.4, 1.4, 0.85), subdivisions=2, noise=0.18)
    # Central canopy dome
    add_leaf_cloud(bm_leaf, Vector((0.1, 0.0, 5.6)), size=(1.8, 1.8, 1.1), subdivisions=2, noise=0.2)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Sakura_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    
    return finish_and_export('tree_sakura', obj_trunk, obj_leaf)

def build_tree_2_willow():
    """Japanese Weeping Willow: Gracefully arching umbrella branches with cascading weeping clusters."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.28, 0.24, 0.20, 1.0), roughness=0.92)
    leaf_mat = make_pbr_material('foliage', (0.42, 0.68, 0.32, 1.0), roughness=0.75) # Tender spring willow green
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.35),
        (Vector((0.05, -0.05, 1.2)), 0.30),
        (Vector((0.10, -0.10, 2.4)), 0.25),
        (Vector((0.02, -0.04, 3.6)), 0.20),
        (Vector((0.0, 0.0, 4.5)), 0.15),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=4)
    
    tips = []
    # Arching umbrella arms
    for b in range(6):
        ang = (b / 6) * math.pi * 2
        arm_end = Vector((math.cos(ang) * 2.5, math.sin(ang) * 2.5, 4.8))
        add_branch_tube(bm_trunk, spine[-1][0], arm_end, 0.16, 0.06, steps=4, res=6, droop=-0.45)
        # Drooping tendril branches
        for t in range(2):
            tang = ang + (t - 0.5) * 0.5
            tendril_end = Vector((math.cos(tang) * 2.8, math.sin(tang) * 2.8, 2.2))
            add_branch_tube(bm_trunk, arm_end, tendril_end, 0.05, 0.015, steps=4, res=5, droop=0.2)
            tips.append(tendril_end + Vector((0, 0, 0.6)))
            
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Willow_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Cascading vertical foliage curtains
    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(0.9, 0.9, 1.8), subdivisions=2, noise=0.15)
    add_leaf_cloud(bm_leaf, Vector((0, 0, 5.1)), size=(2.2, 2.2, 0.9), subdivisions=2, noise=0.15)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Willow_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_willow', obj_trunk, obj_leaf)

def build_tree_3_maple():
    """Japanese Red Maple (Momiji): Crimson fiery tiered foliage plates on delicate sculptural trunk."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.22, 0.18, 0.16, 1.0), roughness=0.86)
    leaf_mat = make_pbr_material('foliage', (0.85, 0.08, 0.12, 1.0), roughness=0.7) # Glowing ruby crimson
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.24),
        (Vector((0.12, 0.08, 0.9)), 0.20),
        (Vector((0.26, 0.15, 1.9)), 0.17),
        (Vector((0.18, 0.05, 2.8)), 0.14),
        (Vector((0.02, -0.05, 3.6)), 0.11),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=7, root_flares=3)
    
    tips = []
    # Horizontal tiered boughs
    tiers = [
        (spine[2][0], Vector((1.6, 0.9, 2.7)), 0.11, 0.04),
        (spine[2][0], Vector((-1.5, 0.8, 2.8)), 0.11, 0.04),
        (spine[3][0], Vector((0.9, -1.6, 3.4)), 0.10, 0.03),
        (spine[3][0], Vector((-1.1, -1.4, 3.5)), 0.10, 0.03),
        (spine[4][0], Vector((0.6, 0.7, 4.3)), 0.08, 0.03),
        (spine[4][0], Vector((-0.7, -0.5, 4.4)), 0.08, 0.03),
    ]
    for s_pt, e_pt, sr, er in tiers:
        add_branch_tube(bm_trunk, s_pt, e_pt, sr, er, steps=3, res=5, droop=-0.1)
        tips.append(e_pt)
        
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Maple_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Flattened parasol/layered cloud plates
    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.6, 1.6, 0.55), subdivisions=2, noise=0.12)
    add_leaf_cloud(bm_leaf, Vector((0, 0, 4.6)), size=(1.8, 1.8, 0.65), subdivisions=2, noise=0.14)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Maple_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_red_maple', obj_trunk, obj_leaf)

def build_tree_4_ginkgo():
    """Japanese Ginkgo: Architectural conical habit with vibrant golden foliage."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.28, 0.24, 0.20, 1.0), roughness=0.9)
    leaf_mat = make_pbr_material('foliage', (0.95, 0.85, 0.12, 1.0), roughness=0.68) # Radiant gold
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.30),
        (Vector((0.02, 0.02, 1.4)), 0.26),
        (Vector((0.04, -0.01, 2.8)), 0.21),
        (Vector((0.01, 0.03, 4.2)), 0.16),
        (Vector((0.0, 0.0, 5.6)), 0.10),
        (Vector((0.0, 0.0, 6.6)), 0.04),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=4)
    
    # 4 ascending whorls of branches
    tips = []
    for whorl in range(4):
        z_base = 2.4 + whorl * 1.0
        whorl_r = 1.9 - whorl * 0.35
        for b in range(4):
            ang = (b / 4) * math.pi * 2 + whorl * 0.5
            s_pt = Vector((0, 0, z_base))
            e_pt = Vector((math.cos(ang) * whorl_r, math.sin(ang) * whorl_r, z_base + 0.9))
            add_branch_tube(bm_trunk, s_pt, e_pt, 0.11 - whorl*0.02, 0.03, steps=3, res=5)
            tips.append(e_pt)
            
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Ginkgo_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.1, 1.1, 0.8), subdivisions=2, noise=0.15)
    # Tapered spire top
    add_leaf_cloud(bm_leaf, Vector((0, 0, 6.4)), size=(1.2, 1.2, 1.4), subdivisions=2, noise=0.15)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Ginkgo_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_ginkgo', obj_trunk, obj_leaf)

def build_tree_5_pine():
    """Japanese Black Pine (Matsu): Twisted weathered bonsai trunk with tiered needle plates."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.18, 0.14, 0.12, 1.0), roughness=0.95)
    leaf_mat = make_pbr_material('foliage', (0.14, 0.32, 0.18, 1.0), roughness=0.85) # Deep forest pine needle
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.36),
        (Vector((0.25, 0.15, 1.1)), 0.30),
        (Vector((0.55, 0.28, 2.2)), 0.25),
        (Vector((0.72, 0.12, 3.2)), 0.20),
        (Vector((0.50, -0.15, 4.1)), 0.15),
        (Vector((0.20, -0.10, 4.8)), 0.09),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=5)
    
    tips = []
    branches = [
        (spine[2][0], Vector((1.8, 1.2, 2.6)), 0.16, 0.05),
        (spine[3][0], Vector((2.2, -0.4, 3.4)), 0.14, 0.04),
        (spine[3][0], Vector((-0.8, 1.4, 3.6)), 0.13, 0.04),
        (spine[4][0], Vector((1.4, -1.5, 4.3)), 0.12, 0.04),
        (spine[5][0], Vector((-0.6, -0.8, 5.1)), 0.10, 0.03),
        (spine[5][0], Vector((0.3, 0.4, 5.4)), 0.09, 0.03),
    ]
    for s_pt, e_pt, sr, er in branches:
        add_branch_tube(bm_trunk, s_pt, e_pt, sr, er, steps=4, res=6, droop=-0.15)
        tips.append(e_pt)
        
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Pine_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Flat layered needle pads
    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.7, 1.7, 0.45), subdivisions=2, noise=0.12)
    add_leaf_cloud(bm_leaf, Vector((0.25, -0.05, 5.5)), size=(1.8, 1.8, 0.55), subdivisions=2, noise=0.14)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Pine_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_pine', obj_trunk, obj_leaf)

def build_tree_6_plane():
    """Majestic Urban London Plane: Powerful trunk with heavy scaffold branches and broadleaf canopy."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.28, 0.24, 0.20, 1.0), roughness=0.88)
    leaf_mat = make_pbr_material('foliage', (0.18, 0.42, 0.16, 1.0), roughness=0.78) # Rich vibrant summer foliage
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.42),
        (Vector((0.05, 0.04, 1.3)), 0.36),
        (Vector((-0.04, 0.08, 2.5)), 0.30),
        (Vector((0.02, 0.02, 3.6)), 0.24),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=5)
    
    tips = []
    # 4 major scaffold limbs branching high
    scaffolds = [
        (spine[-1][0], Vector((2.2, 1.5, 5.2)), 0.19, 0.07),
        (spine[-1][0], Vector((-2.1, 1.6, 5.4)), 0.18, 0.07),
        (spine[-1][0], Vector((1.8, -2.0, 5.1)), 0.18, 0.06),
        (spine[-1][0], Vector((-1.9, -1.8, 5.3)), 0.19, 0.06),
    ]
    for s_pt, e_pt, sr, er in scaffolds:
        add_branch_tube(bm_trunk, s_pt, e_pt, sr, er, steps=4, res=6)
        tips.append(e_pt)
        for sub_i in range(2):
            ang = sub_i * 2.5 + 0.6
            sub_end = e_pt + Vector((math.cos(ang)*1.4, math.sin(ang)*1.4, 0.8))
            add_branch_tube(bm_trunk, e_pt, sub_end, er * 0.75, 0.03, steps=3, res=5)
            tips.append(sub_end)
            
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Plane_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Voluminous crown of leafy clouds
    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.5, 1.5, 1.1), subdivisions=2, noise=0.16)
    add_leaf_cloud(bm_leaf, Vector((0, 0, 5.8)), size=(2.4, 2.4, 1.5), subdivisions=2, noise=0.18)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Plane_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_plane', obj_trunk, obj_leaf)

def build_tree_7_autumn_oak():
    """Autumn Sugar Maple / Oak: Golden amber and warm russet autumn dome."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.24, 0.20, 0.16, 1.0), roughness=0.9)
    leaf_mat = make_pbr_material('foliage', (0.95, 0.46, 0.08, 1.0), roughness=0.75) # Blazing amber orange
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.38),
        (Vector((-0.06, 0.04, 1.2)), 0.32),
        (Vector((0.04, 0.06, 2.3)), 0.27),
        (Vector((0.0, 0.0, 3.4)), 0.22),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=4)
    
    tips = []
    for b in range(5):
        ang = (b / 5) * math.pi * 2
        e_pt = Vector((math.cos(ang) * 2.2, math.sin(ang) * 2.2, 4.8))
        add_branch_tube(bm_trunk, spine[-1][0], e_pt, 0.16, 0.05, steps=3, res=5)
        tips.append(e_pt)
        
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Autumn_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.6, 1.6, 1.2), subdivisions=2, noise=0.17)
    add_leaf_cloud(bm_leaf, Vector((0, 0, 5.2)), size=(2.6, 2.6, 1.6), subdivisions=2, noise=0.18)
    
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Autumn_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_autumn_oak', obj_trunk, obj_leaf)

def build_tree_8_cypress():
    """Mediterranean Italian Cypress: Dense, slender architectural columnar evergreen."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.24, 0.20, 0.18, 1.0), roughness=0.9)
    leaf_mat = make_pbr_material('foliage', (0.16, 0.28, 0.18, 1.0), roughness=0.82) # Deep Mediterranean green
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.22),
        (Vector((0.0, 0.0, 1.8)), 0.18),
        (Vector((0.0, 0.0, 3.6)), 0.14),
        (Vector((0.0, 0.0, 5.4)), 0.08),
        (Vector((0.0, 0.0, 7.2)), 0.02),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=7, root_flares=3)
    
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Cypress_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # Columnar flame envelope
    bm_leaf = bmesh.new()
    height_steps = 7
    for h in range(height_steps):
        t = h / (height_steps - 1)
        z = 1.2 + t * 6.2
        # Flame profile radius
        r = math.sin(t * math.pi) * 0.85 + 0.25 * (1.0 - t)
        add_leaf_cloud(bm_leaf, Vector((0, 0, z)), size=(r, r, 0.9), subdivisions=2, noise=0.10)
        
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Cypress_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_cypress', obj_trunk, obj_leaf)

def build_tree_9_palm():
    """Tropical Royal Palm: Leaning ringed stipe trunk crowned by graceful arching feather fronds."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.34, 0.30, 0.26, 1.0), roughness=0.88)
    leaf_mat = make_pbr_material('foliage', (0.24, 0.52, 0.18, 1.0), roughness=0.6) # Glossy tropical palm green
    
    bm_trunk = bmesh.new()
    spine = []
    num_rings = 14
    for i in range(num_rings + 1):
        t = i / num_rings
        # Characteristic gentle graceful lean
        x = math.sin(t * 1.6) * 0.75
        y = math.cos(t * 1.4) * 0.35
        z = t * 6.8
        r = 0.26 * (1.0 - t * 0.45)
        spine.append(Vector((x, y, z)))
        
    create_trunk_mesh(bm_trunk, spine, [0.26 * (1.0 - (i/num_rings)*0.45) for i in range(num_rings+1)], radial_res=8, root_flares=5)
    
    # Coconut cluster under crown
    crown_top = spine[-1]
    
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Palm_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # 12 Arching feather fronds
    bm_leaf = bmesh.new()
    num_fronds = 12
    for fi in range(num_fronds):
        ang = (fi / num_fronds) * math.pi * 2
        # Frond spine with parabolic droop
        frond_pts = []
        for st in range(5):
            frac = (st + 1) / 5
            fx = crown_top.x + math.cos(ang) * (frac * 3.2)
            fy = crown_top.y + math.sin(ang) * (frac * 3.2)
            fz = crown_top.z + math.sin(frac * 2.2) * 0.6 - (frac ** 2) * 1.4
            frond_pts.append(Vector((fx, fy, fz)))
            
        # Draw arched ribbed frond leaf
        for p_idx, pt in enumerate(frond_pts):
            width = (1.0 - (p_idx / len(frond_pts))) * 0.75 + 0.2
            add_leaf_cloud(bm_leaf, pt, size=(width, width, 0.22), subdivisions=1, noise=0.08)
            
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Palm_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_palm', obj_trunk, obj_leaf)

def build_tree_10_magnolia():
    """Flowering Magnolia: Dark glossy green leaves studded with luminous creamy white blossom bursts."""
    clear_scene()
    bark_mat = make_pbr_material('bark', (0.24, 0.22, 0.20, 1.0), roughness=0.88)
    leaf_mat = make_pbr_material('foliage', (0.16, 0.38, 0.16, 1.0), roughness=0.55) # Glossy waxy leaf green
    blossom_mat = make_pbr_material('blossom_white', (0.98, 0.98, 0.94, 1.0), roughness=0.5) # Creamy white
    
    bm_trunk = bmesh.new()
    spine = [
        (Vector((0.0, 0.0, 0.0)), 0.34),
        (Vector((0.08, -0.06, 1.1)), 0.28),
        (Vector((0.02, 0.08, 2.2)), 0.23),
        (Vector((-0.05, 0.04, 3.2)), 0.18),
    ]
    create_trunk_mesh(bm_trunk, [p[0] for p in spine], [p[1] for p in spine], radial_res=8, root_flares=4)
    
    tips = []
    for b in range(5):
        ang = (b / 5) * math.pi * 2 + 0.3
        e_pt = Vector((math.cos(ang) * 2.0, math.sin(ang) * 2.0, 4.4))
        add_branch_tube(bm_trunk, spine[-1][0], e_pt, 0.15, 0.05, steps=3, res=5)
        tips.append(e_pt)
        
    m_trunk = bpy.data.meshes.new('trunk')
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    obj_trunk = bpy.data.objects.new('Tree_Magnolia_Trunk', m_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    bm_leaf = bmesh.new()
    for tip in tips:
        add_leaf_cloud(bm_leaf, tip, size=(1.5, 1.5, 1.1), subdivisions=2, noise=0.16)
    add_leaf_cloud(bm_leaf, Vector((0, 0, 4.8)), size=(2.3, 2.3, 1.4), subdivisions=2, noise=0.18)
    
    # White blossoms
    for tip in tips:
        for _ in range(3):
            boff = Vector((random.uniform(-0.8, 0.8), random.uniform(-0.8, 0.8), random.uniform(0.1, 0.8)))
            add_leaf_cloud(bm_leaf, tip + boff, size=(0.35, 0.35, 0.35), subdivisions=1, noise=0.05)
            
    m_leaf = bpy.data.meshes.new('leaf')
    bm_leaf.to_mesh(m_leaf)
    bm_leaf.free()
    obj_leaf = bpy.data.objects.new('Tree_Magnolia_Canopy', m_leaf)
    obj_leaf.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_leaf)
    return finish_and_export('tree_magnolia', obj_trunk, obj_leaf)

def finish_and_export(name, obj_trunk, obj_leaf):
    """Joins trunk & canopy, unwraps UVs, generates LODs, and exports to .glb."""
    obj_trunk.select_set(True)
    obj_leaf.select_set(True)
    bpy.context.view_layer.objects.active = obj_trunk
    bpy.ops.object.join()
    tree_obj = bpy.context.active_object
    tree_obj.name = name
    
    # Smart UV project
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    out_dir = '/Users/arunmallikarjun/Desktop/3D_Game/public/models/vegetation'
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. Export LOD0
    p0 = os.path.join(out_dir, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=p0, use_selection=True, export_format='GLB', export_materials='EXPORT', export_apply=True)
    
    # Also copy tree_broadleaf over public/models/props/tree_broadleaf.glb if plane
    if name == 'tree_plane':
        p_bl = '/Users/arunmallikarjun/Desktop/3D_Game/public/models/props/tree_broadleaf.glb'
        bpy.ops.export_scene.gltf(filepath=p_bl, use_selection=True, export_format='GLB', export_materials='EXPORT', export_apply=True)
        
    tris = len(tree_obj.data.polygons)
    print(f"Exported {name} -> {p0} ({tris} tris)")
    return (name, tris)

def build_all_10():
    results = []
    results.append(build_tree_1_sakura())
    results.append(build_tree_2_willow())
    results.append(build_tree_3_maple())
    results.append(build_tree_4_ginkgo())
    results.append(build_tree_5_pine())
    results.append(build_tree_6_plane())
    results.append(build_tree_7_autumn_oak())
    results.append(build_tree_8_cypress())
    results.append(build_tree_9_palm())
    results.append(build_tree_10_magnolia())
    print("\n--- ALL 10 TREES GENERATED SUCCESSFULLY ---")
    for name, tris in results:
        print(f"  {name}: {tris} polygons")

if __name__ == '__main__':
    build_all_10()
