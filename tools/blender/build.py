"""
Blender pipeline for characters.

    python3 tools/blender/build.py <name> [<name> ...]

Reads the quad cage emitted by `npm run genchar -- --cage`, and does the three
things Blender does far better than hand-rolled code:

1. **Catmull-Clark subdivision.** The cage is a coarse quad shell; two levels of
   subsurf turn it into a smooth organic surface. This is how character artists
   actually work, and it is why the result reads as a body rather than a tube
   with visible facets.
2. **Bone heat diffusion weighting** (`ARMATURE_AUTO`). Blender solves weights
   over the mesh surface rather than by distance to a bone. That is the actual
   fix for the shoulder collapse: a distance heuristic cannot know that the
   deltoid is topologically near the arm and far from the ribcage.
3. **The official glTF exporter**, which gets skinning, normals and materials
   right without me re-deriving the format.

Run with `python3`, not the Blender binary — bpy is a pip module here.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def to_blender(p):
    """Cage data is authored Y-up (glTF convention). Blender works Z-up and its
    exporter converts back on the way out, so the data has to be rotated INTO
    Z-up here or the character ships lying on its back."""
    return Vector((p[0], -p[2], p[1]))
SRC = os.path.join(ROOT, 'assets', 'source', 'characters')
PREFIX = 'mixamorig:'

# Chains that must not be welded into their neighbours. Everything else in a
# material group is one continuous surface and should merge at the seams.
# One level, not two. Two smooths the face displacement away entirely and
# quadruples the file — 6.3 MB a character is unusable. One level keeps the
# forms and lands around 1.5 MB.
SUBSURF_LEVELS = 1


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_from_chains(name, chains):
    """One object per material, built from the cage's quad rings."""
    objects = []
    by_mat = {}
    for ch in chains:
        by_mat.setdefault(ch['mat'], []).append(ch)

    for mat, group in by_mat.items():
        bm = bmesh.new()
        for ch in group:
            rings = ch['rings']
            n = len(rings[0])
            verts = [[bm.verts.new(to_blender(p)) for p in ring] for ring in rings]
            for i in range(len(rings) - 1):
                a, b = verts[i], verts[i + 1]
                for k in range(n):
                    k2 = (k + 1) % n
                    try:
                        bm.faces.new((a[k], a[k2], b[k2], b[k]))
                    except ValueError:
                        pass          # duplicate face where two chains meet
            if ch.get('capEnd', True):
                try:
                    bm.faces.new(verts[-1])
                except ValueError:
                    pass
            if ch.get('capStart', True):
                try:
                    bm.faces.new(list(reversed(verts[0])))
                except ValueError:
                    pass

        # weld the seams between chains, then make the winding consistent —
        # subdivision on an inconsistent surface produces creases and holes
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        me = bpy.data.meshes.new(f'{name}_{mat}')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(bpy.data.materials.new(mat))
        ob = bpy.data.objects.new(f'{name}_{mat}', me)
        bpy.context.collection.objects.link(ob)

        sub = ob.modifiers.new('subsurf', 'SUBSURF')
        sub.levels = SUBSURF_LEVELS
        sub.render_levels = SUBSURF_LEVELS
        sub.use_limit_surface = True
        objects.append(ob)
    return objects


def armature_from_joints(name, joints):
    arm = bpy.data.armatures.new(f'{name}_rig')
    ob = bpy.data.objects.new(f'{name}_rig', arm)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')

    by_name = {j['name']: j for j in joints}
    children = {}
    for j in joints:
        children.setdefault(j['parent'], []).append(j['name'])

    bones = {}
    for j in joints:
        b = arm.edit_bones.new(PREFIX + j['name'])
        b.head = to_blender(j['world'])
        kids = children.get(j['name'], [])
        if kids:
            # point at the average child, which is what makes a chain deform
            tail = Vector((0, 0, 0))
            for k in kids:
                tail += to_blender(by_name[k]['world'])
            b.tail = tail / len(kids)
        else:
            parent = by_name.get(j['parent'])
            d = (to_blender(j['world']) - to_blender(parent['world'])) if parent else Vector((0, 0, 0.08))
            if d.length < 1e-5:
                d = Vector((0, 0, 0.08))
            b.tail = b.head + d.normalized() * max(d.length * 0.6, 0.03)
        bones[j['name']] = b

    for j in joints:
        if j['parent']:
            bones[j['name']].parent = bones[j['parent']]
            # do NOT auto-connect: a shoulder offset from the spine is real
            bones[j['name']].use_connect = False

    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def build(name):
    path = os.path.join(SRC, name, f'{name}.cage.json')
    with open(path) as fh:
        cage = json.load(fh)

    reset()
    meshes = mesh_from_chains(name, cage['chains'])
    rig = armature_from_joints(name, cage['joints'])

    # heat-diffusion weights, the whole reason for coming through Blender
    for ob in meshes:
        ob.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    out = os.path.join(SRC, name, f'{name}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=True,            # bake the subsurf
        export_skins=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
    )
    tris = sum(len(m.data.loop_triangles) for m in meshes)
    return out


if __name__ == '__main__':
    names = sys.argv[1:] or [d for d in sorted(os.listdir(SRC))
                             if os.path.exists(os.path.join(SRC, d, f'{d}.cage.json'))]
    for n in names:
        out = build(n)
        print(f'{n:<12} -> {os.path.relpath(out, ROOT)} ({os.path.getsize(out)//1024} KB)')
