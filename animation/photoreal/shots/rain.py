"""Shot 2: the first rain. A dark, heaving ocean under storm cloud, rain
sheeting down, lightning flashing inside the clouds. Camera skims low."""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from lib import *

SHOT, SECONDS = 'rain', 11.5
N = int(SECONDS * FPS)
sc = reset(samples=int(os.environ.get('SAMPLES', 16)))

# Ocean: big, choppy swell.
o, om = ocean(size=900, spatial=60, wave=2.6, choppy=1.8, res=16, water_color=(0.004, 0.014, 0.018), center=(0, 380))
o.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.1
om.time = 1.0; om.keyframe_insert('time', frame=1)
om.time = 1.0 + SECONDS * 1.1; om.keyframe_insert('time', frame=N)
for fc in o.animation_data.action.fcurves:
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'

# Storm sky, entirely in the world shader: layered noise clouds over a grey gradient.
w = bpy.data.worlds.new('world'); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes['Background']
tc = node(nt, 'ShaderNodeTexCoord')
mp = node(nt, 'ShaderNodeMapping'); link(nt, tc.outputs['Generated'], mp.inputs['Vector'])
mp.inputs['Scale'].default_value = (1, 1, 3)
cl = node(nt, 'ShaderNodeTexNoise', Scale=3.0, Detail=10.0, Roughness=0.62, _noise_dimensions='4D')
link(nt, mp.outputs['Vector'], cl.inputs['Vector'])
cl.inputs['W'].default_value = 0; cl.inputs['W'].keyframe_insert('default_value', frame=1)
cl.inputs['W'].default_value = 0.25; cl.inputs['W'].keyframe_insert('default_value', frame=N)
cr = node(nt, 'ShaderNodeValToRGB'); link(nt, cl.outputs['Fac'], cr.inputs['Fac'])
cr.color_ramp.elements[0].position = 0.35; cr.color_ramp.elements[0].color = (0.012, 0.014, 0.018, 1)
cr.color_ramp.elements[1].position = 0.75; cr.color_ramp.elements[1].color = (0.09, 0.095, 0.1, 1)
link(nt, cr.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0
# Lightning: the sky flares for a few frames, twice.
strength = bg.inputs['Strength']
for f, v in [(1, 1.0), (int(3.2 * FPS), 1.0), (int(3.25 * FPS), 9.0), (int(3.35 * FPS), 2.0), (int(3.42 * FPS), 7.0), (int(3.6 * FPS), 1.0),
             (int(8.4 * FPS), 1.0), (int(8.45 * FPS), 10.0), (int(8.65 * FPS), 1.0), (N, 1.0)]:
    strength.default_value = v; strength.keyframe_insert('default_value', frame=f)
for fc in w.node_tree.animation_data.action.fcurves:
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'
sun(8, 30, 0.35, (0.75, 0.8, 0.9), angle=12)

# Rain: a few thousand thin streaks falling through the camera's view.
bpy.ops.mesh.primitive_cylinder_add(vertices=4, radius=0.018, depth=2.2, location=(0, 0, -500))
drop = bpy.context.object
drop.data.transform(__import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'Y'))
dm, dnt, db = material('rain')
db.inputs['Base Color'].default_value = (0.7, 0.75, 0.8, 1); db.inputs['Roughness'].default_value = 0.1
db.inputs['Transmission Weight'].default_value = 0.3; db.inputs['Alpha'].default_value = 0.5
db.inputs['Emission Color'].default_value = (0.6, 0.65, 0.7, 1); db.inputs['Emission Strength'].default_value = 0.25
drop.data.materials.append(dm)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 25, 40))
em = bpy.context.object; em.scale = (70, 70, 1)
ps = em.modifiers.new('rain', 'PARTICLE_SYSTEM').particle_system.settings
ps.count = 24000; ps.frame_start = -60; ps.frame_end = N; ps.lifetime = 60
ps.normal_factor = 0; ps.object_align_factor[2] = -22; ps.factor_random = 0.3
ps.render_type = 'OBJECT'; ps.instance_object = drop; ps.particle_size = 1.0; ps.size_random = 0.4
ps.use_rotations = True; ps.rotation_mode = 'VEL'; ps.use_dynamic_rotation = False
ps.effector_weights.gravity = 0.4
em.show_instancer_for_render = False
ps.physics_type = 'NEWTON'

# Camera: skimming just over the swell, turning slowly toward the brighter horizon.
cam, tgt = camera(lens=28)
keys(cam, 'location', [(1, (0, -30, 3.5)), (N, (6, -18, 4.5))])
keys(tgt, 'location', [(1, (-20, 200, 8)), (N, (30, 200, 10))])

# Grey spray-haze with distance.
bpy.context.view_layer.use_pass_mist = True
w.mist_settings.start = 60; w.mist_settings.depth = 1400; w.mist_settings.falloff = 'QUADRATIC'
sc.use_nodes = True; ct = sc.node_tree
rl = ct.nodes['Render Layers']; comp = ct.nodes['Composite']
fog = ct.nodes.new('CompositorNodeMixRGB'); fog.inputs[2].default_value = (0.06, 0.065, 0.07, 1)
mk = ct.nodes.new('CompositorNodeMath'); mk.operation = 'MULTIPLY'; mk.inputs[1].default_value = 0.55
ct.links.new(rl.outputs['Mist'], mk.inputs[0]); ct.links.new(mk.outputs[0], fog.inputs['Fac'])
ct.links.new(rl.outputs['Image'], fog.inputs[1]); ct.links.new(fog.outputs[0], comp.inputs['Image'])

finish(SHOT, SECONDS)
