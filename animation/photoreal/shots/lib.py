"""Shared helpers for the photoreal shots: Blender (bpy) + Cycles, everything
procedural. A shot script builds its scene, then calls finish(...).

  python3 shots/volcano.py --still 3.0     # one frame at 3.0 s -> out/<shot>-still.png
  python3 shots/volcano.py                 # every frame -> out/frames/<shot>/0001.png ...
"""
import math, os, sys, time
import bpy
from mathutils import noise, Vector

FPS = 24
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def reset(samples=32, res=(1280, 720)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = 6
    sc.cycles.volume_step_rate = 4.0
    sc.cycles.volume_max_steps = 96
    if os.environ.get('RES'): res = tuple(int(v) for v in os.environ['RES'].split('x'))
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.fps = FPS
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    return sc


def world_sky(elev_deg=10, rot_deg=0, strength=0.25, air=1.0, dust=1.0, ozone=1.0):
    w = bpy.data.worlds.new('world'); bpy.context.scene.world = w; w.use_nodes = True
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(elev_deg); sky.sun_rotation = math.radians(rot_deg)
    sky.air_density, sky.dust_density, sky.ozone_density = air, dust, ozone
    bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = strength
    nt.links.new(sky.outputs[0], bg.inputs[0])
    return w, bg


def world_color(rgb, strength=1.0):
    w = bpy.data.worlds.new('world'); bpy.context.scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*rgb, 1); bg.inputs['Strength'].default_value = strength
    return w, bg


def sun(elev_deg, rot_deg, strength=3.0, color=(1, 0.95, 0.88), angle=0.8):
    d = bpy.data.lights.new('sun', 'SUN'); d.energy = strength; d.color = color; d.angle = math.radians(angle)
    o = bpy.data.objects.new('sun', d); bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90 - elev_deg), 0, math.radians(rot_deg))
    return o


def grid(name, size, n, height_fn, location=(0, 0, 0)):
    """A size x size terrain of n x n vertices, z = height_fn(x, y). Real UVs."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = []
    for j in range(n):
        for i in range(n):
            x = (i / (n - 1) - 0.5) * size; y = (j / (n - 1) - 0.5) * size
            verts.append(bm.verts.new((x, y, height_fn(x, y))))
    bm.verts.ensure_lookup_table()
    uv = bm.loops.layers.uv.new()
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            f = bm.faces.new((verts[a], verts[a + 1], verts[a + n + 1], verts[a + n]))
            for loop, (di, dj) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv].uv = ((i + di) / (n - 1), (j + dj) / (n - 1))
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); o.location = location
    bpy.context.scene.collection.objects.link(o)
    return o


def fbm(x, y, scale=1.0, octaves=6, seed=0.0):
    return noise.fractal(Vector((x * scale + seed, y * scale - seed, seed * 0.37)), 1.0, 2.0, octaves, noise_basis='PERLIN_NEW')


def ridged(x, y, scale=1.0, octaves=6, seed=0.0):
    return noise.ridged_multi_fractal(Vector((x * scale + seed, y * scale - seed, 0.5)), 1.0, 2.0, octaves, 1.0, 2.0, noise_basis='PERLIN_NEW')


def material(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes['Principled BSDF']


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'): setattr(n, k[1:], v)
        else: n.inputs[k].default_value = v
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def ocean(size=400, spatial=60, wave=1.4, choppy=1.2, res=14, water_color=(0.005, 0.025, 0.035), center=(0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=2)
    o = bpy.context.object; o.name = 'ocean'
    m = o.modifiers.new('ocean', 'OCEAN')
    # A dense patch of `spatial` metres, tiled out to `size`: stretching one patch
    # over the whole sea leaves the waves between the vertices.
    m.geometry_mode = 'GENERATE'; m.size = 1.0; m.spatial_size = spatial
    m.repeat_x = m.repeat_y = max(1, round(size / spatial))
    m.resolution = res; m.wave_scale = wave; m.choppiness = choppy; m.random_seed = 3
    if hasattr(m, 'viewport_resolution'): m.viewport_resolution = min(res, 8)
    m.use_normals = True
    mat, nt, b = material('water')
    b.inputs['Base Color'].default_value = (*water_color, 1)
    b.inputs['Roughness'].default_value = 0.04
    b.inputs['IOR'].default_value = 1.333
    b.inputs['Transmission Weight'].default_value = 0.0
    b.inputs['Specular IOR Level'].default_value = 0.5
    o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = True
    # The tiles grow from one corner and ignore the base mesh: move the object so
    # the sea is centred on `center`.
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg)
    xs = [c[0] for c in e.bound_box]; ys = [c[1] for c in e.bound_box]
    o.location = (center[0] - (min(xs) + max(xs)) / 2, center[1] - (min(ys) + max(ys)) / 2, 0)
    return o, m


def camera(lens=35):
    c = bpy.data.cameras.new('cam'); c.lens = lens; c.clip_end = 20000
    o = bpy.data.objects.new('cam', c); bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    t = bpy.data.objects.new('target', None); bpy.context.scene.collection.objects.link(t)
    k = o.constraints.new('TRACK_TO'); k.target = t; k.track_axis = 'TRACK_NEGATIVE_Z'; k.up_axis = 'UP_Y'
    return o, t


def keys(obj, path, frames_values, interp='BEZIER'):
    for f, v in frames_values:
        setattr(obj, path, v); obj.keyframe_insert(path, frame=f)
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = interp


def finish(shot, seconds):
    """Render a still (--still t) or the whole shot to out/frames/<shot>/."""
    sc = bpy.context.scene
    sc.frame_start = 1; sc.frame_end = int(round(seconds * FPS))
    args = sys.argv[1:]
    if '--still' in args:
        t = float(args[args.index('--still') + 1])
        sc.frame_set(max(1, int(round(t * FPS))))
        sc.render.filepath = os.path.join(ROOT, 'out', f'{shot}-still.png')
        t0 = time.time(); bpy.ops.render.render(write_still=True)
        print(f'STILL {shot} frame {sc.frame_current}: {time.time() - t0:.1f}s')
    else:
        d = os.path.join(ROOT, 'out', 'frames', shot); os.makedirs(d, exist_ok=True)
        first = int(args[args.index('--from') + 1]) if '--from' in args else 1
        step = int(os.environ.get('STEP', 2))          # 12 fps renders, interpolated to 24 later
        for f in range(first, sc.frame_end + 1, step):
            path = os.path.join(d, f'{(f - 1) // step + 1:04d}.png')
            if os.path.exists(path): continue            # resumable
            sc.frame_set(f); sc.render.filepath = path
            t0 = time.time(); bpy.ops.render.render(write_still=True)
            print(f'FRAME {shot} {f}/{sc.frame_end} {time.time() - t0:.1f}s', flush=True)
        print(f'DONE {shot}')
