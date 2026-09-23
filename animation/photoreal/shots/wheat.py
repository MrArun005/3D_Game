"""Shot 5: the end of the last ice age. Wild wheat and grass on warm, rolling
hills at golden hour, swaying in the wind. The camera rises out of the stalks."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy, bmesh
from mathutils import Vector, Matrix
from lib import *

SHOT, SECONDS = 'wheat', 18.4
N = int(SECONDS * FPS)
sc = reset(samples=int(os.environ.get('SAMPLES', 16)))

# Rolling hills.
def height(x, y):
    return 22 * fbm(x, y, 0.0025, 4, 3) + 5 * fbm(x, y, 0.01, 3, 7) + max(0, y - 150) * 0.12
hills = grid('hills', 3000, 300, height)
hm, hnt, hb = material('steppe')
tc = node(hnt, 'ShaderNodeTexCoord')
hn = node(hnt, 'ShaderNodeTexNoise', Scale=0.02, Detail=8.0); link(hnt, tc.outputs['Object'], hn.inputs['Vector'])
hr = node(hnt, 'ShaderNodeValToRGB'); link(hnt, hn.outputs['Fac'], hr.inputs['Fac'])
hr.color_ramp.elements[0].color = (0.28, 0.2, 0.07, 1); hr.color_ramp.elements[1].color = (0.46, 0.34, 0.12, 1)
link(hnt, hr.outputs['Color'], hb.inputs['Base Color']); hb.inputs['Roughness'].default_value = 0.9
hbump = node(hnt, 'ShaderNodeBump', Strength=0.5); hz = node(hnt, 'ShaderNodeTexNoise', Scale=4.0, Detail=6.0)
link(hnt, tc.outputs['Object'], hz.inputs['Vector']); link(hnt, hz.outputs['Fac'], hbump.inputs['Height']); link(hnt, hbump.outputs['Normal'], hb.inputs['Normal'])
hills.data.materials.append(hm)

# One wild wheat stalk: a curved stem, two leaves, an ear of grains with awns.
def stalk():
    bm = bmesh.new()
    H = 1.0
    def tube(p0, p1, r0, r1, sides=4):
        d = (p1 - p0).normalized(); up = Vector((0, 0, 1)) if abs(d.z) < 0.99 else Vector((1, 0, 0))
        a = d.cross(up).normalized(); b_ = d.cross(a)
        ring = lambda p, r: [bm.verts.new(p + (a * math.cos(t) + b_ * math.sin(t)) * r) for t in [i * 2 * math.pi / sides for i in range(sides)]]
        r0_, r1_ = ring(p0, r0), ring(p1, r1)
        for i in range(sides): bm.faces.new((r0_[i], r0_[(i + 1) % sides], r1_[(i + 1) % sides], r1_[i]))
    pts = [Vector((0.04 * (t ** 2), 0, H * t)) for t in [i / 6 for i in range(7)]]
    for i in range(6): tube(pts[i], pts[i + 1], 0.005, 0.004)
    top = pts[-1]
    for k in range(16):                                   # grains in two rows up the ear
        z = top.z + 0.01 + (k // 2) * 0.011; side = 1 if k % 2 else -1
        c = Vector((top.x + side * 0.006, 0, z))
        g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.006)
        for v in g['verts']: v.co = Vector((v.co.x * 0.8, v.co.y * 0.8, v.co.z * 1.5)) + c
        tube(c + Vector((0, 0, 0.006)), c + Vector((side * 0.02, 0, 0.07)), 0.0008, 0.0003, sides=3)   # awn
    for s, z in [(1, 0.35), (-1, 0.55)]:                   # leaves
        # Long, narrow blades.
        v0 = bm.verts.new(Vector((0, 0, z))); v1 = bm.verts.new(Vector((s * 0.16, 0.002, z + 0.13)))
        v2 = bm.verts.new(Vector((s * 0.2, 0, z + 0.11))); v3 = bm.verts.new(Vector((0, 0.003, z + 0.012)))
        bm.faces.new((v0, v3, v1, v2))
    me = bpy.data.meshes.new('stalk'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('stalk', me); sc.collection.objects.link(o)
    o.location = (0, 0, -1000)
    return o
st = stalk()
sm, snt, sb = material('wheat')
sb.inputs['Base Color'].default_value = (0.4, 0.26, 0.08, 1); sb.inputs['Roughness'].default_value = 0.55
sb.inputs['Subsurface Weight'].default_value = 0.0
sb.inputs['Sheen Weight'].default_value = 0.15; sb.inputs['Sheen Tint'].default_value = (1, 0.85, 0.5, 1)
st.data.materials.append(sm)

# A field patch in front of the camera, filled by geometry nodes: points -> stalks,
# random size and turn, and a gust of wind that leans them over time.
def patch(cx, cy, sx, sy, cuts):
    bpy.ops.mesh.primitive_plane_add(size=1)
    f = bpy.context.object; f.scale = (sx, sy, 1); f.location = (cx, cy, 0)
    bpy.ops.object.transform_apply(scale=True, location=True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=cuts); bpy.ops.object.mode_set(mode='OBJECT')
    for v in f.data.vertices: v.co.z = height(v.co.x, v.co.y) + 0.03       # just above the hills
    f.data.materials.append(hm)
    return f
tree = bpy.data.node_groups.new('wheatfield', 'GeometryNodeTree')
tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
T = tree.nodes; Lk = tree.links.new
gi = T.new('NodeGroupInput'); go = T.new('NodeGroupOutput')
dist = T.new('GeometryNodeDistributePointsOnFaces'); dist.inputs['Density'].default_value = 1.0
dist.inputs['Seed'].default_value = 7
inst = T.new('GeometryNodeInstanceOnPoints')
oi = T.new('GeometryNodeObjectInfo'); oi.inputs['Object'].default_value = st; oi.transform_space = 'ORIGINAL'
rnd = T.new('FunctionNodeRandomValue'); rnd.data_type = 'FLOAT'; rnd.inputs[2].default_value = 0.7; rnd.inputs[3].default_value = 1.25
rrot = T.new('FunctionNodeRandomValue'); rrot.data_type = 'FLOAT_VECTOR'
rrot.inputs[0].default_value = (-0.12, -0.12, 0); rrot.inputs[1].default_value = (0.12, 0.12, 6.28)
# Wind: noise over position and time, as a lean about x and y.
pos = T.new('GeometryNodeInputPosition'); tm = T.new('GeometryNodeInputSceneTime')
nz = T.new('ShaderNodeTexNoise'); nz.noise_dimensions = '4D'; nz.inputs['Scale'].default_value = 0.08; nz.inputs['Detail'].default_value = 2
tscale = T.new('ShaderNodeMath'); tscale.operation = 'MULTIPLY'; tscale.inputs[1].default_value = 0.35
Lk(tm.outputs['Seconds'], tscale.inputs[0]); Lk(tscale.outputs[0], nz.inputs['W']); Lk(pos.outputs[0], nz.inputs['Vector'])
sepc = T.new('FunctionNodeSeparateColor'); Lk(nz.outputs['Color'], sepc.inputs[0])
lean = T.new('ShaderNodeCombineXYZ')
for i, ch in enumerate(['Red', 'Green']):
    m1 = T.new('ShaderNodeMapRange'); m1.inputs['From Min'].default_value = 0.3; m1.inputs['From Max'].default_value = 0.7
    m1.inputs['To Min'].default_value = -0.35 if i == 0 else -0.15; m1.inputs['To Max'].default_value = 0.45 if i == 0 else 0.15
    Lk(sepc.outputs[ch], m1.inputs['Value']); Lk(m1.outputs[0], lean.inputs['X' if i == 0 else 'Y'])
addr = T.new('ShaderNodeVectorMath'); addr.operation = 'ADD'
Lk(rrot.outputs[0], addr.inputs[0]); Lk(lean.outputs[0], addr.inputs[1])
Lk(gi.outputs[0], dist.inputs['Mesh'])
Lk(dist.outputs['Points'], inst.inputs['Points']); Lk(oi.outputs['Geometry'], inst.inputs['Instance'])
Lk(rnd.outputs[1], inst.inputs['Scale']); Lk(addr.outputs[0], inst.inputs['Rotation'])
join = T.new('GeometryNodeJoinGeometry'); Lk(gi.outputs[0], join.inputs[0]); Lk(inst.outputs[0], join.inputs[0])
Lk(join.outputs[0], go.inputs[0])
# Density is a modifier input, so one tree serves a dense near patch and a sparse far one.
tree.interface.new_socket('Density', in_out='INPUT', socket_type='NodeSocketFloat')
Lk(gi.outputs['Density'], dist.inputs['Density'])
for (cx, cy, sx, sy, cuts, dens) in [(0, 10, 70, 110, 50, float(os.environ.get('DENSITY', 45))), (0, 190, 260, 260, 40, 5.0)]:
    f = patch(cx, cy, sx, sy, cuts)
    m = f.modifiers.new('wheat', 'NODES'); m.node_group = tree
    m[tree.interface.items_tree['Density'].identifier] = dens

# Golden hour, the sun low behind the wheat so every ear is rim-lit.
world_sky(elev_deg=5, rot_deg=175, strength=0.3, air=1.0, dust=2.0, ozone=1.0)
sun(5, 175, 3.4, (1.0, 0.72, 0.42), angle=0.6)

# Camera: starts among the ears looking into the sun, rises and drifts forward.
cam, tgt = camera(lens=35)
z0 = height(0, -30)
keys(cam, 'location', [(1, (0, -32, z0 + 0.9)), (int(N * 0.55), (1, -26, z0 + 2.2)), (N, (2, -20, z0 + 6.5))])
keys(tgt, 'location', [(1, (-4, 60, z0 + 0.8)), (N, (-6, 300, z0 + 12))])
cam.data.dof.use_dof = True; cam.data.dof.focus_distance = 12; cam.data.dof.aperture_fstop = 5.6

bpy.context.view_layer.use_pass_mist = True
sc.world.mist_settings.start = 80; sc.world.mist_settings.depth = 2200
sc.use_nodes = True; ct = sc.node_tree
rl = ct.nodes['Render Layers']; comp = ct.nodes['Composite']
fog = ct.nodes.new('CompositorNodeMixRGB'); fog.inputs[2].default_value = (0.9, 0.62, 0.38, 1)
mk = ct.nodes.new('CompositorNodeMath'); mk.operation = 'MULTIPLY'; mk.inputs[1].default_value = 0.5
ct.links.new(rl.outputs['Mist'], mk.inputs[0]); ct.links.new(mk.outputs[0], fog.inputs['Fac'])
gl = ct.nodes.new('CompositorNodeGlare'); gl.glare_type = 'FOG_GLOW'; gl.threshold = 1.0; gl.size = 7
ct.links.new(rl.outputs['Image'], fog.inputs[1]); ct.links.new(fog.outputs[0], gl.inputs['Image']); ct.links.new(gl.outputs['Image'], comp.inputs['Image'])

finish(SHOT, SECONDS)
