"""Shot 1: the young Earth on fire. Two volcanoes over a plain of cracked,
glowing lava crust; a smoke column lit from below; the camera drifts in."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from lib import *

SHOT, SECONDS = 'volcano', 13.2
sc = reset(samples=int(os.environ.get('SAMPLES', 24)))

# Terrain: a main cone with a crater, a smaller cone, rough lava plains.
CONES = [((0, 900), 760, 1500, 170, 90), ((-1100, 1700), 380, 900, 80, 40)]   # (centre, height, radius, crater r, crater depth)
def height(x, y):
    # Rough, lumpy lava fields: big swells plus blocky small relief.
    h = 14 * fbm(x, y, 0.003) + 6 * ridged(x, y, 0.02, 4, 5) + 2.5 * fbm(x, y, 0.09, 3, 9)
    for (cx, cy), H, R, rc, dep in CONES:
        r = math.hypot(x - cx, y - cy)
        if r < R:
            k = (1 - r / R) ** 1.6
            # Radial gullies: ridged noise stretched around the cone.
            a = math.atan2(y - cy, x - cx)
            gul = ridged(math.cos(a) * 9, math.sin(a) * 9 + r * 0.004, 1.0, 5, 3)
            h += H * k * (1 + 0.06 * gul) + 30 * k * fbm(x, y, 0.01, 5, 7)
            top = H * (1 - rc / R) ** 1.6
            if r < rc: h = min(h, top - dep * (1 - (r / rc) ** 2) + 2 * fbm(x, y, 0.05))
    return h
land = grid('land', 5200, 480, height)

# Rock with glowing cracks: Voronoi edges become lava on the low plains and in the crater.
mat, nt, bsdf = material('basalt')
bsdf.inputs['Base Color'].default_value = (0.025, 0.022, 0.02, 1)
bsdf.inputs['Roughness'].default_value = 0.92
tc = node(nt, 'ShaderNodeTexCoord')
vor = node(nt, 'ShaderNodeTexVoronoi', _feature='DISTANCE_TO_EDGE', _voronoi_dimensions='4D', Scale=0.02, Randomness=1.0)
warp = node(nt, 'ShaderNodeTexNoise', Scale=0.01, Detail=4.0)
link(nt, tc.outputs['Object'], warp.inputs['Vector'])
wmix = node(nt, 'ShaderNodeMix', _data_type='VECTOR'); wmix.inputs['Factor'].default_value = 0.35
link(nt, tc.outputs['Object'], wmix.inputs[4]); link(nt, warp.outputs['Color'], wmix.inputs[5])
wscale = node(nt, 'ShaderNodeVectorMath', _operation='SCALE'); wscale.inputs['Scale'].default_value = 1.0
link(nt, wmix.outputs[1], vor.inputs['Vector'])
wv = vor.inputs['W']; wv.default_value = 0.0
crack = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.02, 'To Min': 1.0, 'To Max': 0.0})
link(nt, vor.outputs['Distance'], crack.inputs['Value'])
# Only where it is low (plains) or deep in a crater: height from the object z.
sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
low = node(nt, 'ShaderNodeMapRange', **{'From Min': 30.0, 'From Max': 60.0, 'To Min': 1.0, 'To Max': 0.0})
link(nt, sep.outputs['Z'], low.inputs['Value'])
mask = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); link(nt, crack.outputs[0], mask.inputs[0]); link(nt, low.outputs[0], mask.inputs[1])
flick = node(nt, 'ShaderNodeTexNoise', Scale=0.004, Detail=3.0); link(nt, tc.outputs['Object'], flick.inputs['Vector'])
m2 = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); link(nt, mask.outputs[0], m2.inputs[0]); link(nt, flick.outputs['Fac'], m2.inputs[1])
# Lava rivers down the flanks: a thin band of a stretched noise, on the cone only.
cen = node(nt, 'ShaderNodeVectorMath', _operation='SUBTRACT'); cen.inputs[1].default_value = (0, 900, 0)
link(nt, tc.outputs['Object'], cen.inputs[0])
cs = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, cen.outputs[0], cs.inputs[0])
ang = node(nt, 'ShaderNodeMath', _operation='ARCTAN2'); link(nt, cs.outputs['Y'], ang.inputs[0]); link(nt, cs.outputs['X'], ang.inputs[1])
rad = node(nt, 'ShaderNodeVectorMath', _operation='LENGTH'); link(nt, cen.outputs[0], rad.inputs[0])
angk = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); angk.inputs[1].default_value = 6.0; link(nt, ang.outputs[0], angk.inputs[0])
radk = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); radk.inputs[1].default_value = 0.0012; link(nt, rad.outputs['Value'], radk.inputs[0])
pol = node(nt, 'ShaderNodeCombineXYZ'); link(nt, angk.outputs[0], pol.inputs['X']); link(nt, radk.outputs[0], pol.inputs['Y'])
riv = node(nt, 'ShaderNodeTexNoise', Scale=1.0, Detail=3.0); link(nt, pol.outputs[0], riv.inputs['Vector'])
band = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.495, 'From Max': 0.51, 'To Min': 1.0, 'To Max': 0.0}, _clamp=True)
link(nt, riv.outputs['Fac'], band.inputs['Value'])
band2 = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.48, 'From Max': 0.495, 'To Min': 0.0, 'To Max': 1.0}, _clamp=True)
link(nt, riv.outputs['Fac'], band2.inputs['Value'])
bb = node(nt, 'ShaderNodeMath', _operation='MINIMUM'); link(nt, band.outputs[0], bb.inputs[0]); link(nt, band2.outputs[0], bb.inputs[1])
slope = node(nt, 'ShaderNodeMapRange', **{'From Min': 90.0, 'From Max': 200.0, 'To Min': 0.0, 'To Max': 1.0}, _clamp=True)
link(nt, sep.outputs['Z'], slope.inputs['Value'])
rv = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); link(nt, bb.outputs[0], rv.inputs[0]); link(nt, slope.outputs[0], rv.inputs[1])
tot = node(nt, 'ShaderNodeMath', _operation='MAXIMUM'); link(nt, m2.outputs[0], tot.inputs[0]); link(nt, rv.outputs[0], tot.inputs[1])
ramp = node(nt, 'ShaderNodeValToRGB'); link(nt, tot.outputs[0], ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position = 0.34; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
ramp.color_ramp.elements[1].position = 0.62; ramp.color_ramp.elements[1].color = (1.0, 0.28, 0.03, 1)
link(nt, ramp.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 9.0
bump = node(nt, 'ShaderNodeBump', Strength=0.4); nz = node(nt, 'ShaderNodeTexNoise', Scale=0.3, Detail=8.0)
link(nt, tc.outputs['Object'], nz.inputs['Vector']); link(nt, nz.outputs['Fac'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], bsdf.inputs['Normal'])
land.data.materials.append(mat)
# Slow change in the cracks over the shot.
wv.default_value = 0.0; wv.keyframe_insert('default_value', frame=1)
wv.default_value = 0.35; wv.keyframe_insert('default_value', frame=int(SECONDS * FPS))

# Lava lake in the main crater.
(cx, cy), H, R, rc, dep = CONES[0]
top = H * (1 - rc / R) ** 1.6
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=rc * 0.75, fill_type='NGON', location=(cx, cy, top - dep * 0.7))
lake = bpy.context.object
lm, lnt, lb = material('lava')
lb.inputs['Base Color'].default_value = (0.05, 0.01, 0.0, 1)
ln = node(lnt, 'ShaderNodeTexNoise', Scale=0.05, Detail=6.0)
lr = node(lnt, 'ShaderNodeValToRGB'); link(lnt, ln.outputs['Fac'], lr.inputs['Fac'])
lr.color_ramp.elements[0].color = (0.6, 0.06, 0.0, 1); lr.color_ramp.elements[1].color = (1.0, 0.55, 0.12, 1)
link(lnt, lr.outputs['Color'], lb.inputs['Emission Color']); lb.inputs['Emission Strength'].default_value = 40.0
lake.data.materials.append(lm)

# Smoke and ash: one volume box over the crater, lit by the lava below.
bpy.ops.mesh.primitive_cube_add(size=1, location=(cx + 60, cy + 40, top + 650))
smoke = bpy.context.object; smoke.scale = (900, 900, 1300)
vm = bpy.data.materials.new('smoke'); vm.use_nodes = True; vnt = vm.node_tree
vnt.nodes.remove(vnt.nodes['Principled BSDF'])
vol = node(vnt, 'ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (0.12, 0.11, 0.1, 1)
vtc = node(vnt, 'ShaderNodeTexCoord')
vn = node(vnt, 'ShaderNodeTexNoise', Scale=2.2, Detail=6.0, Roughness=0.6); link(vnt, vtc.outputs['Generated'], vn.inputs['Vector'])
# Column shape: dense in the middle, thinning with height, widening as it rises.
grad = node(vnt, 'ShaderNodeTexGradient', _gradient_type='SPHERICAL')
g2 = node(vnt, 'ShaderNodeVectorMath', _operation='SCALE'); g2.inputs['Scale'].default_value = 2.0   # fall to zero before the box edge
link(vnt, vtc.outputs['Object'], g2.inputs[0]); link(vnt, g2.outputs[0], grad.inputs['Vector'])
d1 = node(vnt, 'ShaderNodeMath', _operation='MULTIPLY'); link(vnt, vn.outputs['Fac'], d1.inputs[0]); link(vnt, grad.outputs['Fac'], d1.inputs[1])
d2 = node(vnt, 'ShaderNodeMapRange', **{'From Min': 0.15, 'From Max': 0.45, 'To Min': 0.0, 'To Max': 0.03}); link(vnt, d1.outputs[0], d2.inputs['Value'])
link(vnt, d2.outputs[0], vol.inputs['Density'])
link(vnt, vol.outputs[0], vnt.nodes['Material Output'].inputs['Volume'])
smoke.data.materials.append(vm)
# Let the smoke churn upward.
vn.noise_dimensions = '4D'
vn.inputs['W'].default_value = 0.0; vn.inputs['W'].keyframe_insert('default_value', frame=1)
vn.inputs['W'].default_value = 0.8; vn.inputs['W'].keyframe_insert('default_value', frame=int(SECONDS * FPS))

# Light: a deep red, overcast sky; the lava glow does the rest.
w, bgn = world_color((0.05, 0.018, 0.01), 1.0)

glow = bpy.data.lights.new('glow', 'POINT'); glow.energy = 4e7; glow.color = (1, 0.35, 0.08); glow.shadow_soft_size = 120
go = bpy.data.objects.new('glow', glow); go.location = (cx, cy, top + 60); sc.collection.objects.link(go)
sun(4, 200, 0.6, (1.0, 0.5, 0.35))

# Camera: low over the plain, drifting in and rising a little.
cam, tgt = camera(lens=32)
keys(cam, 'location', [(1, (700, -1700, 70)), (int(SECONDS * FPS), (480, -1250, 120))])
keys(tgt, 'location', [(1, (0, 900, 520)), (int(SECONDS * FPS), (-40, 900, 560))])

# Bloom on the lava.
sc.use_nodes = True
ct = sc.node_tree
rl = ct.nodes['Render Layers']; comp = ct.nodes['Composite']
bpy.context.view_layer.use_pass_mist = True
w.mist_settings.start = 200; w.mist_settings.depth = 5000; w.mist_settings.falloff = 'QUADRATIC'
fog = ct.nodes.new('CompositorNodeMixRGB'); fog.blend_type = 'MIX'; fog.inputs[2].default_value = (0.09, 0.035, 0.02, 1)
mk = ct.nodes.new('CompositorNodeMath'); mk.operation = 'MULTIPLY'; mk.inputs[1].default_value = 0.75
ct.links.new(rl.outputs['Mist'], mk.inputs[0]); ct.links.new(mk.outputs[0], fog.inputs['Fac'])
ct.links.new(rl.outputs['Image'], fog.inputs[1])
gl = ct.nodes.new('CompositorNodeGlare'); gl.glare_type = 'FOG_GLOW'; gl.quality = 'MEDIUM'; gl.threshold = 0.8; gl.size = 8
ct.links.new(fog.outputs[0], gl.inputs['Image']); ct.links.new(gl.outputs['Image'], comp.inputs['Image'])

finish(SHOT, SECONDS)
