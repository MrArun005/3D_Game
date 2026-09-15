"""
Blender script to author high-fidelity trees for Halstead Bay & Little Tokyo.
Generates 3 distinct tree species with organic trunk/branch geometry and layered canopies:
1. 'sakura' - Japanese Cherry Blossom (gnarled curving trunk, spreading branches, delicate pink blossom canopy clusters)
2. 'ginkgo' - Japanese Maidenhair Ginkgo (slender tapering trunk, ascending branch whorls, radiant golden-green foliage)
3. 'plane'  - Urban London Plane (robust textured trunk, scaffold branches, voluminous summer leaf canopies)

Exports each as separate GLTF models with real UVs for engine streaming.
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block, do_unlink=True)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block, do_unlink=True)

def create_mat(name, color=(0.15, 0.12, 0.08, 1.0), roughness=0.85, metalness=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metalness
    return mat

def build_organic_tree(species='sakura'):
    clear_scene()
    
    # Materials
    if species == 'sakura':
        bark_mat = create_mat('bark_sakura', color=(0.22, 0.16, 0.14, 1.0), roughness=0.9)
        leaf_mat = create_mat('leaf_sakura', color=(0.96, 0.65, 0.76, 1.0), roughness=0.7) # Soft Japanese cherry blossom pink
    elif species == 'ginkgo':
        bark_mat = create_mat('bark_ginkgo', color=(0.28, 0.24, 0.20, 1.0), roughness=0.85)
        leaf_mat = create_mat('leaf_ginkgo', color=(0.88, 0.82, 0.18, 1.0), roughness=0.75) # Golden yellow-green autumn ginkgo
    else: # plane
        bark_mat = create_mat('bark_plane', color=(0.26, 0.22, 0.18, 1.0), roughness=0.88)
        leaf_mat = create_mat('leaf_plane', color=(0.20, 0.38, 0.16, 1.0), roughness=0.8) # Deep lush summer green

    # 1. TRUNK & BRANCHES MESH
    bm_trunk = bmesh.new()
    
    # Base trunk segments
    num_segs = 6
    trunk_h = 3.8 if species != 'ginkgo' else 4.6
    base_r = 0.28 if species != 'ginkgo' else 0.24
    top_r = 0.14 if species != 'ginkgo' else 0.11
    
    # Generate spine curve
    spine = []
    for i in range(num_segs + 1):
        t = i / num_segs
        z = t * trunk_h
        if species == 'sakura':
            # Classic gnarled Japanese curving trunk
            x = math.sin(t * 2.8) * 0.32 * (1.0 - t*0.2)
            y = math.cos(t * 2.4) * 0.24 * (1.0 - t*0.2)
        else:
            x = math.sin(t * 3.5) * 0.08
            y = math.cos(t * 3.2) * 0.08
        r = base_r * (1.0 - t * 0.55)
        spine.append((Vector((x, y, z)), r))

    # Skin spine into cylinder rings
    ring_verts = []
    circ_res = 8
    for pt, r in spine:
        ring = []
        for c in range(circ_res):
            ang = c / circ_res * math.pi * 2
            rx = pt.x + math.cos(ang) * r
            ry = pt.y + math.sin(ang) * r
            rz = pt.z
            v = bm_trunk.verts.new((rx, ry, rz))
            ring.append(v)
        ring_verts.append(ring)
    
    # Connect trunk rings
    for i in range(num_segs):
        r0 = ring_verts[i]
        r1 = ring_verts[i+1]
        for c in range(circ_res):
            c_next = (c + 1) % circ_res
            bm_trunk.faces.new([r0[c], r0[c_next], r1[c_next], r1[c]])

    # Close bottom
    bm_trunk.faces.new([ring_verts[0][c] for c in reversed(range(circ_res))])

    # Add spreading branches
    branch_tips = []
    num_branches = 5 if species == 'sakura' else 6
    for b_idx in range(num_branches):
        frac = 0.55 + 0.40 * (b_idx / num_branches)
        origin = spine[int(frac * num_segs)][0]
        ang = (b_idx / num_branches) * math.pi * 2 + (0.3 if species == 'sakura' else 0.1)
        
        # Branch direction
        spread_dist = 2.4 if species == 'sakura' else 1.8
        lift = 1.4 if species != 'ginkgo' else 2.2
        tip_x = origin.x + math.cos(ang) * spread_dist
        tip_y = origin.y + math.sin(ang) * spread_dist
        tip_z = origin.z + lift
        
        tip_pos = Vector((tip_x, tip_y, tip_z))
        branch_tips.append(tip_pos)
        
        # Build branch tube
        b_steps = 4
        b_ring_verts = []
        b_res = 6
        for s in range(b_steps + 1):
            st = s / b_steps
            b_pt = origin.lerp(tip_pos, st)
            if species == 'sakura':
                # drooping arch
                b_pt.z -= math.sin(st * math.pi) * 0.35
            b_r = 0.13 * (1.0 - st * 0.65)
            b_ring = []
            for c in range(b_res):
                c_ang = c / b_res * math.pi * 2
                bx = b_pt.x + math.cos(c_ang) * b_r
                by = b_pt.y + math.sin(c_ang) * b_r
                bz = b_pt.z
                v = bm_trunk.verts.new((bx, by, bz))
                b_ring.append(v)
            b_ring_verts.append(b_ring)
            
        for s in range(b_steps):
            br0 = b_ring_verts[s]
            br1 = b_ring_verts[s+1]
            for c in range(b_res):
                c_next = (c + 1) % b_res
                bm_trunk.faces.new([br0[c], br0[c_next], br1[c_next], br1[c]])

    # Finish trunk mesh
    mesh_trunk = bpy.data.meshes.new(f'trunk_{species}')
    bm_trunk.to_mesh(mesh_trunk)
    bm_trunk.free()
    
    obj_trunk = bpy.data.objects.new(f'Tree_{species}_Trunk', mesh_trunk)
    obj_trunk.data.materials.append(bark_mat)
    bpy.context.collection.objects.link(obj_trunk)

    # 2. CANOPY FOLIAGE CLUSTERS
    bm_canopy = bmesh.new()
    
    canopy_centers = list(branch_tips)
    canopy_centers.append(spine[-1][0] + Vector((0, 0, 0.4)))
    if species == 'sakura':
        for tip in branch_tips:
            canopy_centers.append(tip + Vector((0.4, 0.4, -0.3)))
            canopy_centers.append(tip + Vector((-0.4, -0.4, -0.2)))

    for ci, center in enumerate(canopy_centers):
        blob_radius = 1.35 if species != 'ginkgo' else 1.1
        if ci >= len(branch_tips):
            blob_radius *= 0.85
        bmesh.ops.create_icosphere(
            bm_canopy,
            subdivisions=2,
            radius=blob_radius,
            matrix=Matrix.Translation(center) @ Matrix.Diagonal(Vector((1.1, 1.1, 0.72, 1.0)))
        )

    # Deform canopy vertices with subtle noise for natural volume
    for v in bm_canopy.verts:
        p = v.co
        noise_off = math.sin(p.x * 2.3) * math.cos(p.y * 2.1) * 0.12
        v.co += Vector((noise_off, noise_off * 0.8, noise_off * 0.5))

    mesh_canopy = bpy.data.meshes.new(f'canopy_{species}')
    bm_canopy.to_mesh(mesh_canopy)
    bm_canopy.free()
    
    obj_canopy = bpy.data.objects.new(f'Tree_{species}_Canopy', mesh_canopy)
    obj_canopy.data.materials.append(leaf_mat)
    bpy.context.collection.objects.link(obj_canopy)

    # Join into single tree object with clean hierarchy
    obj_trunk.select_set(True)
    obj_canopy.select_set(True)
    bpy.context.view_layer.objects.active = obj_trunk
    bpy.ops.object.join()
    tree_obj = bpy.context.active_object
    tree_obj.name = f'tree_{species}'
    
    # Generate unwrapped UVs (Rule 4)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Export GLTF
    out_dir = '/Users/arunmallikarjun/Desktop/3D_Game/public/models/vegetation'
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f'tree_{species}.glb')
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        use_selection=True,
        export_format='GLB',
        export_materials='EXPORT',
        export_apply=True
    )
    print(f"Exported {species} tree to {out_path} ({len(tree_obj.data.polygons)} faces)")

for sp in ['sakura', 'ginkgo', 'plane']:
    build_organic_tree(sp)
