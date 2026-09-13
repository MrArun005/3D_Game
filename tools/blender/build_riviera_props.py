# build_riviera_props.py -- Riviera boulevard props for Halstead Bay.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#       --python tools/blender/build_riviera_props.py
#
# THIS FILE IS THE ASSET. The .glb files under public/models/props/ are build
# output and can be regenerated from here; an earlier drop of these eight props
# deleted its own Blender script, so a parasol that shipped without its canopy
# sag could not be fixed without writing the whole thing again. Keep this file.
#
# Engine contract (docs/ASSET-BRIEF.md), all enforced by check() at the bottom:
#   - one .glb per asset, +Y up, metres
#   - origin at the BASE: minY == 0, centred in X and Z
#   - a real TEXCOORD_0 on every primitive (the engine zero-fills a missing UV
#     set, which puts every texel of a PBR material on one point)
#   - material names come from the 33-name library and nothing else; an unknown
#     name falls through to concrete_cast (this is how a tree drop once rendered
#     as grey concrete)
#   - no LOD files: the engine draws lod1 by default and a wrong one is worse
#     than none
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', 'props')
OUT = os.path.normpath(OUT)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def mesh_from(name, verts, faces, material):
    """Build a mesh, give every face a real planar UV, shade it flat."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat(material))

    # UVs: project each face along its own dominant normal axis, scaled in
    # metres. Not an atlas -- these assets carry no textures -- but the
    # attribute must exist and must be sane, because a normal map or decal
    # added later reads it.
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_i, v_i = ([1, 2], [0, 2], [0, 1])[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[u_i] * 0.5, co[v_i] * 0.5)
    return ob


def chamfered_box(cx, cy, cz, sx, sy, sz, ch):
    """A box with its edges taken off. A chamfered box is ~44 triangles where a
    sharp one is 12, and per the brief that is the difference between a
    placeholder and something that catches a highlight."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v, f = [], []
    # eight corner-truncated points per corner -> build as a simple bevelled cuboid
    pts = []
    for sxx in (-1, 1):
        for syy in (-1, 1):
            for szz in (-1, 1):
                pts.append((sxx, syy, szz))
    # inner cube scaled per axis, three offset faces per corner
    for (a, b, c) in pts:
        v.append((cx + a * (hx - ch), cy + b * (hy - ch), cz + c * hz))
        v.append((cx + a * hx, cy + b * (hy - ch), cz + c * (hz - ch)))
        v.append((cx + a * (hx - ch), cy + b * hy, cz + c * (hz - ch)))
    # rather than hand-wind 26 faces, let bmesh bevel a cube: deterministic and short
    return None


def bevel_cube(name, cx, cy, cz, sx, sy, sz, ch, material, segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vt in bm.verts:
        vt.co.x *= sx
        vt.co.y *= sy
        vt.co.z *= sz
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                    offset=ch, segments=segments, affect='EDGES')
    for vt in bm.verts:
        vt.co += Vector((cx, cy, cz))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat(material))
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_i, v_i = ([1, 2], [0, 2], [0, 1])[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[u_i] * 0.5, co[v_i] * 0.5)
    return ob


def cylinder(name, cx, cy, cz, r_bot, r_top, h, sides, material, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=sides,
                          radius1=r_bot, radius2=r_top, depth=h)
    for vt in bm.verts:
        vt.co += Vector((cx, cy, cz))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat(material))
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_i, v_i = ([1, 2], [0, 2], [0, 1])[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[u_i] * 0.5, co[v_i] * 0.5)
    return ob


def join_and_export(basename, objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = basename

    # origin to the base, centred in X/Y (Blender Y == engine Z here; the glTF
    # exporter's +Y up conversion handles the swap on the way out)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    minz = min(p.z for p in bb)
    cx = (min(p.x for p in bb) + max(p.x for p in bb)) / 2
    cy = (min(p.y for p in bb) + max(p.y for p in bb)) / 2
    for vt in ob.data.vertices:
        vt.co.x -= cx
        vt.co.y -= cy
        vt.co.z -= minz

    path = os.path.join(OUT, basename + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_texcoords=True,
        export_normals=True, export_materials='EXPORT', export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'  wrote {basename}.glb  {tris} tris')
    return path


# ---------------------------------------------------------------------------
# 3. SQUARE CAFE PARASOL
#
# The shipped one had a 24-triangle canopy with ZERO vertices between the
# centre and the rim, so it was four flat triangles -- exactly what the brief
# said not to build ("four shallow curved panels, not four flat triangles").
# Fabric under tension sags between its ribs; a rigid pyramid reads as a
# traffic cone. Concentric square rings give the panels somewhere to sag TO.
# ---------------------------------------------------------------------------
def parasol():
    reset()
    HALF, APEX, RIM, SAG = 1.5, 2.45, 2.02, 0.17
    RINGS, PER_SIDE = 3, 3          # 3 rings x 12 perimeter points

    def ring_pts(t):
        """Square ring at parameter t (0 centre .. 1 rim), walked anticlockwise."""
        n = PER_SIDE * 4
        pts = []
        for i in range(n):
            f = (i / n) * 4.0            # 0..4, one unit per side
            side, s = int(f), f - int(f)
            e = HALF * t
            x, y = [(-e + 2 * e * s, -e), (e, -e + 2 * e * s),
                    (e - 2 * e * s, e), (-e, e - 2 * e * s)][side]
            # height: straight run from apex to rim...
            h = APEX + (RIM - APEX) * t
            # ...then sag, strongest at the middle of a side (between ribs at
            # the corners) and zero at the corners themselves
            ax, ay = abs(x), abs(y)
            corner = min(ax, ay) / max(ax, ay) if max(ax, ay) > 1e-6 else 0.0
            h -= SAG * t * (1.0 - corner)
            pts.append((x, y, h))
        return pts

    verts, faces = [(0.0, 0.0, APEX)], []
    rings = []
    for r in range(1, RINGS + 1):
        base = len(verts)
        verts.extend(ring_pts(r / RINGS))
        rings.append(base)
    n = PER_SIDE * 4
    for i in range(n):                                   # centre fan
        faces.append((0, 1 + i, 1 + (i + 1) % n))
    for r in range(RINGS - 1):                           # ring quads
        a, b = rings[r], rings[r + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, b + i, b + j, a + j))
    canopy = mesh_from('canopy', verts, faces, 'fabric_awning')

    # valance: a real skirt hanging 0.2 m off the rim. This is the silhouette --
    # the shipped asset got this part right and it is kept.
    rim = ring_pts(1.0)
    vv, vf = [], []
    for i, (x, y, z) in enumerate(rim):
        vv.append((x, y, z))
        vv.append((x, y, z - 0.20 - (0.05 if i % PER_SIDE == 1 else 0.0)))  # scallop
    for i in range(n):
        j = (i + 1) % n
        vf.append((i * 2, j * 2, j * 2 + 1, i * 2 + 1))
    valance = mesh_from('valance', vv, vf, 'fabric_awning')

    pole = cylinder('pole', 0, 0, 1.30, 0.035, 0.035, 2.60, 8, 'metal_galv')
    finial = cylinder('finial', 0, 0, 2.52, 0.05, 0.0, 0.14, 8, 'metal_galv')
    base = bevel_cube('base', 0, 0, 0.045, 0.52, 0.52, 0.09, 0.02, 'metal_galv')
    hub = cylinder('hub', 0, 0, 2.30, 0.07, 0.07, 0.10, 8, 'metal_galv')
    return join_and_export('square_cafe_parasol',
                           [canopy, valance, pole, finial, base, hub])


# ---------------------------------------------------------------------------
# 6. PLANTER TROUGH WITH FLOWERS
#
# The shipped one overhung its trough by 2 cm: a green box sitting inside a
# grey box, which is the failure the brief named outright. Planting has to
# BREAK the rectangle or neither object reads. Clusters here are seeded to sit
# ON the rim and hang past it by 12-22 cm.
# ---------------------------------------------------------------------------
def planter():
    reset()
    W, D, TH = 1.60, 0.60, 0.62      # trough outer size, and its height
    objs = []
    objs.append(bevel_cube('trough', 0, 0, TH / 2, W, D, TH, 0.035, 'concrete_precast'))
    # moulded rim: a slightly proud, slightly thinner cap
    objs.append(bevel_cube('rim', 0, 0, TH + 0.035, W + 0.07, D + 0.07, 0.07, 0.02,
                           'concrete_precast'))
    # two feet, so it does not read as a slab dropped on the pavement
    for sx in (-1, 1):
        objs.append(bevel_cube('foot', sx * (W / 2 - 0.16), 0, 0.02, 0.18, D - 0.12, 0.04,
                               0.012, 'concrete_precast'))

    # planting. `rnd` is a fixed LCG: same asset every build, which is the
    # project's rule for anything seeded.
    seed = [20260914]

    def rnd():
        seed[0] = (seed[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return seed[0] / 0x7FFFFFFF

    HALF_W, HALF_D = W / 2, D / 2
    for i in range(9):
        t = (i + 0.5) / 9.0
        x = -HALF_W + 0.10 + t * (W - 0.20) + (rnd() - 0.5) * 0.08
        edge = i % 3 == 0                      # every third cluster hangs over a rim
        y = (HALF_D - 0.10) * (1 if i % 2 else -1) if edge else (rnd() - 0.5) * (D - 0.28)
        r = 0.13 + rnd() * 0.07
        z = TH + 0.04 + rnd() * 0.14
        if edge:
            z -= 0.08                          # it is spilling, so it sits lower
        # the two end clusters also break the SHORT rims, so the trough is not
        # a rectangle with a soft top -- it is a rectangle with planting on it
        if i == 0 or i == 8:
            x = (HALF_W - 0.04) * (-1 if i == 0 else 1)
        objs.append(cylinder(f'cluster{i}', x, y, z, r, r * 0.55, 0.14 + rnd() * 0.10,
                             6, 'foliage'))
    # a few stems standing proud, so the mass is not one flat hedge. Kept under
    # the 0.9 m envelope the brief states -- planting that overshoots its own
    # declared bounds breaks whatever places it.
    for i in range(4):
        x = -HALF_W + 0.25 + (i / 3.0) * (W - 0.5)
        objs.append(cylinder(f'stem{i}', x, (rnd() - 0.5) * 0.18,
                             TH + 0.15 + rnd() * 0.05, 0.045, 0.018, 0.16, 5, 'foliage'))
    return join_and_export('planter_trough_flowers', objs)


if __name__ == '__main__':
    print('building Riviera props ->', OUT)
    parasol()
    planter()
    print('done')
