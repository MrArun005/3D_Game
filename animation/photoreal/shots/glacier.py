"""Shot 4: an ice age. The edge of an ice sheet: a blue ice cliff over a grey
meltwater lake with floating bergs, snow blowing across, a low cold sun."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Matrix
from lib import *

SHOT, SECONDS = 'glacier', 9.6
N = int(SECONDS * FPS)
sc = reset(samples=int(os.environ.get('SAMPLES', 16)))

# The ice sheet: a plateau ending in a cliff along a wavy front; hills of ice behind.
def front(x): return 300 + 40 * fbm(x, 0, 0.004, 4, 2) + 12 * fbm(x, 0, 0.02, 3, 5)
def height(x, y):
    d = y - front(x)                                   # metres behind the ice front
    wall = 42 / (1 + math.exp(-(d - 4) / 2.2))           # steep terminus
    h = -3 + wall + max(0, d) * 0.12 + 18 * fbm(x, y, 0.002, 4, 1) * min(1, max(0, d) / 200)
    # Pillars and slumps along the face; crevasse ridges on top.
    h += 5 * ridged(x * 1.0, y * 3.0, 0.02, 4, 7) * min(1, max(0, d) / 10)
    h += 1.2 * fbm(x, y, 0.15, 3, 9)
    return h
ice = grid('ice', 1800, 460, height)
mat, nt, b = material('ice')
tc = node(nt, 'ShaderNodeTexCoord')
geo = node(nt, 'ShaderNodeNewGeometry')
# Snow on flat tops, bare blue ice on steep faces.
nsep = node(nt, 'ShaderNodeSeparateXYZ'); link(nt, geo.outputs['Normal'], nsep.inputs[0])
flat = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.55, 'From Max': 0.85, 'To Min': 0.0, 'To Max': 1.0}, _clamp=True)
link(nt, nsep.outputs['Z'], flat.inputs['Value'])
tint = node(nt, 'ShaderNodeTexNoise', Scale=0.03, Detail=6.0); link(nt, tc.outputs['Object'], tint.inputs['Vector'])
blue = node(nt, 'ShaderNodeValToRGB'); link(nt, tint.outputs['Fac'], blue.inputs['Fac'])
blue.color_ramp.elements[0].color = (0.16, 0.38, 0.6, 1); blue.color_ramp.elements[1].color = (0.55, 0.75, 0.88, 1)
mix = node(nt, 'ShaderNodeMix', _data_type='RGBA'); link(nt, flat.outputs[0], mix.inputs['Factor'])
link(nt, blue.outputs['Color'], mix.inputs[6]); mix.inputs[7].default_value = (0.85, 0.88, 0.92, 1)
link(nt, mix.outputs[2], b.inputs['Base Color'])
rough = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 1.0, 'To Min': 0.15, 'To Max': 0.7}); link(nt, flat.outputs[0], rough.inputs['Value'])
link(nt, rough.outputs[0], b.inputs['Roughness'])
b.inputs['Subsurface Weight'].default_value = 0.0
bump = node(nt, 'ShaderNodeBump', Strength=0.35); nz = node(nt, 'ShaderNodeTexNoise', Scale=0.6, Detail=10.0)
link(nt, tc.outputs['Object'], nz.inputs['Vector']); link(nt, nz.outputs['Fac'], bump.inputs['Height']); link(nt, bump.outputs['Normal'], b.inputs['Normal'])
ice.data.materials.append(mat)

# Meltwater lake in front, grey-green with silt.
o, om = ocean(size=1600, spatial=100, wave=0.35, choppy=0.8, res=12, water_color=(0.03, 0.05, 0.05), center=(0, 0))
om.time = 1.0; om.keyframe_insert('time', frame=1); om.time = 1.0 + SECONDS * 0.8; om.keyframe_insert('time', frame=N)
for fc in o.animation_data.action.fcurves:
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'
o.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.12

# Icebergs: lumpy chunks drifting slowly.
import random
random.seed(4)
for i in range(9):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(random.uniform(-220, 220), random.uniform(80, 250), 0))
    bg_ = bpy.context.object
    s = random.uniform(4, 14); bg_.scale = (s * random.uniform(0.8, 1.6), s * random.uniform(0.8, 1.4), s * random.uniform(0.3, 0.6))
    dm = bg_.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(f'n{i}', 'VORONOI'); t.noise_scale = 0.7; dm.texture = t; dm.strength = 0.5
    bg_.data.materials.append(mat)
    for p in bg_.data.polygons: p.use_smooth = False
    keys(bg_, 'location', [(1, tuple(bg_.location)), (N, (bg_.location.x + random.uniform(-3, 3), bg_.location.y - random.uniform(1, 4), 0))], interp='LINEAR')

# Low, cold sun and a pale sky.
world_sky(elev_deg=7, rot_deg=110, strength=0.22, air=1.2, dust=0.6, ozone=1.5)
sun(7, 110, 3.2, (1.0, 0.86, 0.72), angle=0.6)

# Blowing snow: small flakes streaming across the view.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.05, location=(0, 0, -300))
flake = bpy.context.object
fm, fnt, fb = material('snow'); fb.inputs['Base Color'].default_value = (1, 1, 1, 1); fb.inputs['Roughness'].default_value = 0.9
flake.data.materials.append(fm)
bpy.ops.mesh.primitive_plane_add(size=1, location=(-60, 20, 20))
em = bpy.context.object; em.scale = (6, 70, 30); em.rotation_euler = (0, math.radians(90), 0)
ps = em.modifiers.new('snow', 'PARTICLE_SYSTEM').particle_system.settings
ps.count = 9000; ps.frame_start = -80; ps.frame_end = N; ps.lifetime = 90
ps.normal_factor = 14; ps.factor_random = 0.6; ps.effector_weights.gravity = 0.05
ps.render_type = 'OBJECT'; ps.instance_object = flake; ps.size_random = 0.6
em.show_instancer_for_render = False

# Camera: low over the lake, pushing in toward the ice front.
cam, tgt = camera(lens=30)
keys(cam, 'location', [(1, (-40, -120, 9)), (N, (-20, -40, 12))])
keys(tgt, 'location', [(1, (10, 320, 30)), (N, (20, 320, 34))])

bpy.context.view_layer.use_pass_mist = True
sc.world.mist_settings.start = 120; sc.world.mist_settings.depth = 1500
sc.use_nodes = True; ct = sc.node_tree
rl = ct.nodes['Render Layers']; comp = ct.nodes['Composite']
fog = ct.nodes.new('CompositorNodeMixRGB'); fog.inputs[2].default_value = (0.7, 0.76, 0.82, 1)
mk = ct.nodes.new('CompositorNodeMath'); mk.operation = 'MULTIPLY'; mk.inputs[1].default_value = 0.5
ct.links.new(rl.outputs['Mist'], mk.inputs[0]); ct.links.new(mk.outputs[0], fog.inputs['Fac'])
ct.links.new(rl.outputs['Image'], fog.inputs[1]); ct.links.new(fog.outputs[0], comp.inputs['Image'])

finish(SHOT, SECONDS)
