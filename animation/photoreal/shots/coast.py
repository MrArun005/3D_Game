"""Shot 3: a bare coast, billions of years ago. Layered rock cliffs, sea
stacks, waves rolling in, not a plant anywhere. A slow drone glide along it."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from lib import *

SHOT, SECONDS = 'coast', 13.5
N = int(SECONDS * FPS)
sc = reset(samples=int(os.environ.get('SAMPLES', 16)))

# Land to the west of a meandering shoreline, rising into cliffs and uplands.
def shore(y): return 30 * fbm(0, y, 0.004, 4, 3) + 12 * fbm(0, y, 0.02, 3, 8)
STACKS = [(95, 260, 22, 55), (140, 520, 16, 38), (70, 760, 26, 70)]
def height(x, y):
    d = shore(y) - x                     # metres inland
    cliff = 58 * (1 / (1 + math.exp(-(d - 10) / 5)))            # steep face near the shore
    up = 40 * max(0, d - 40) / 300 * (1 + 0.5 * fbm(x, y, 0.006, 4, 1))
    h = -4 + cliff + up + 5 * ridged(x, y, 0.03, 4, 4) * min(1, max(0, d) / 20)
    h += 2.5 * fbm(x, y, 0.12, 3, 6)
    for sx, sy, r, hh in STACKS:
        # Eroded, irregular stacks: radius wobbles with angle and height.
        a = math.atan2(y - sy, x - sx)
        rr_ = r * (1 + 0.25 * fbm(math.cos(a) * 3, math.sin(a) * 3, 1.0, 3, sx))
        q = math.hypot(x - sx, y - sy)
        if q < rr_: h = max(h, hh * (1 - (q / rr_) ** 4) + 6 * ridged(x, y, 0.08, 3, 2))
    return h
land = grid('land', 1400, 420, height, location=(0, 400, 0))
# Rock: weathered grey-brown stone, faint strata, fractured into blocks, dark and wet low down.
mat, nt, b = material('rock')
tc = node(nt, 'ShaderNodeTexCoord'); sep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, tc.outputs['Object'], sep.inputs[0])
tone = node(nt, 'ShaderNodeTexNoise', Scale=0.05, Detail=8.0, Roughness=0.6); link(nt, tc.outputs['Object'], tone.inputs['Vector'])
rr = node(nt, 'ShaderNodeValToRGB'); link(nt, tone.outputs['Fac'], rr.inputs['Fac'])
rr.color_ramp.elements[0].position = 0.3; rr.color_ramp.elements[0].color = (0.07, 0.065, 0.06, 1)
rr.color_ramp.elements[1].position = 0.7; rr.color_ramp.elements[1].color = (0.19, 0.17, 0.15, 1)
strata = node(nt, 'ShaderNodeTexWave', _wave_type='BANDS', _bands_direction='Z', Scale=0.02, Distortion=6.0, Detail=4.0)
link(nt, tc.outputs['Object'], strata.inputs['Vector'])
smix = node(nt, 'ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY'); smix.inputs['Factor'].default_value = 0.25
link(nt, rr.outputs['Color'], smix.inputs[6]); link(nt, strata.outputs['Color'], smix.inputs[7])
wet = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.5, 'From Max': 6.0, 'To Min': 1.0, 'To Max': 0.0}, _clamp=True)
link(nt, sep.outputs['Z'], wet.inputs['Value'])
mix = node(nt, 'ShaderNodeMix', _data_type='RGBA'); link(nt, wet.outputs[0], mix.inputs['Factor'])
link(nt, smix.outputs[2], mix.inputs[6]); mix.inputs[7].default_value = (0.03, 0.028, 0.025, 1)
link(nt, mix.outputs[2], b.inputs['Base Color'])
rough = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 1.0, 'To Min': 0.9, 'To Max': 0.25}); link(nt, wet.outputs[0], rough.inputs['Value'])
link(nt, rough.outputs[0], b.inputs['Roughness'])
# Fractures (Voronoi edges) plus fine grain, as bump.
cr = node(nt, 'ShaderNodeTexVoronoi', _feature='DISTANCE_TO_EDGE', Scale=0.035, Randomness=1.0); link(nt, tc.outputs['Object'], cr.inputs['Vector'])
crm = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.06, 'To Min': 0.0, 'To Max': 1.0}, _clamp=True); link(nt, cr.outputs['Distance'], crm.inputs['Value'])
gr = node(nt, 'ShaderNodeTexNoise', Scale=1.5, Detail=12.0); link(nt, tc.outputs['Object'], gr.inputs['Vector'])
crw = node(nt, 'ShaderNodeMath', _operation='MULTIPLY'); crw.inputs[1].default_value = 0.3; link(nt, crm.outputs[0], crw.inputs[0])
hsum = node(nt, 'ShaderNodeMath', _operation='ADD'); link(nt, gr.outputs['Fac'], hsum.inputs[0]); link(nt, crw.outputs[0], hsum.inputs[1])
bump = node(nt, 'ShaderNodeBump', Strength=0.9, Distance=0.6); link(nt, hsum.outputs[0], bump.inputs['Height']); link(nt, bump.outputs['Normal'], b.inputs['Normal'])
land.data.materials.append(mat)

# Sea rolling in.
o, om = ocean(size=1400, spatial=100, wave=1.6, choppy=1.4, res=13, water_color=(0.01, 0.045, 0.055), center=(500, 400))
om.time = 2.0; om.keyframe_insert('time', frame=1); om.time = 2.0 + SECONDS; om.keyframe_insert('time', frame=N)
for fc in o.animation_data.action.fcurves:
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'

# A hazy, primordial sky: thick air, a pale sun.
world_sky(elev_deg=22, rot_deg=250, strength=0.18, air=2.5, dust=4.0, ozone=0.2)
sun(22, 250, 2.6, (1.0, 0.9, 0.78), angle=1.5)

# Drone glide north along the coast, over the water.
cam, tgt = camera(lens=30)
keys(cam, 'location', [(1, (150, -80, 60)), (N, (170, 330, 72))])
keys(tgt, 'location', [(1, (40, 380, 20)), (N, (30, 780, 30))])

bpy.context.view_layer.use_pass_mist = True
sc.world.mist_settings.start = 150; sc.world.mist_settings.depth = 1600
sc.use_nodes = True; ct = sc.node_tree
rl = ct.nodes['Render Layers']; comp = ct.nodes['Composite']
fog = ct.nodes.new('CompositorNodeMixRGB'); fog.inputs[2].default_value = (0.62, 0.62, 0.6, 1)
mk = ct.nodes.new('CompositorNodeMath'); mk.operation = 'MULTIPLY'; mk.inputs[1].default_value = 0.6
ct.links.new(rl.outputs['Mist'], mk.inputs[0]); ct.links.new(mk.outputs[0], fog.inputs['Fac'])
ct.links.new(rl.outputs['Image'], fog.inputs[1]); ct.links.new(fog.outputs[0], comp.inputs['Image'])

finish(SHOT, SECONDS)
