"""
Convert a folder of FBX/OBJ wardrobe parts to glTF binary, headless.

Quaternius and most CC0 character packs ship FBX and OBJ. Nothing in the JS
pipeline reads either, so this is the front door. Blender is the converter
because it is the only free thing that reads FBX skinning and animation
correctly, and `pip install bpy` gives it to us without a GUI.

  python3 tools/avatar/fbx2glb.py <in-dir> <out-dir>

Everything is written to <out-dir>; nothing in <in-dir> is touched.
"""
import sys, os, glob, math

import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def convert(src, dst):
    reset()
    ext = os.path.splitext(src)[1].lower()
    if ext == '.fbx':
        # Quaternius FBX is authored in centimetres with Y up; global_scale and
        # the axis pair put it back on metres/Y-up so it matches the avatars.
        bpy.ops.import_scene.fbx(filepath=src, global_scale=1.0,
                                 automatic_bone_orientation=True,
                                 ignore_leaf_bones=True)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        return None, 'unsupported extension ' + ext

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not meshes:
        return None, 'no mesh in file'

    tris = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)

    bones = []
    if arms:
        bones = [b.name for b in arms[0].data.bones]

    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB',
        export_apply=True, export_skins=bool(arms),
        export_animations=True, export_yup=True,
        export_materials='EXPORT',
    )
    return {
        'meshes': [o.name for o in meshes],
        'tris': tris,
        'armature': arms[0].name if arms else None,
        'bones': bones,
        'actions': [a.name for a in bpy.data.actions],
    }, None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    ind, outd = sys.argv[1], sys.argv[2]
    os.makedirs(outd, exist_ok=True)
    files = []
    for pat in ('**/*.fbx', '**/*.FBX', '**/*.obj', '**/*.OBJ'):
        files += glob.glob(os.path.join(ind, pat), recursive=True)
    files.sort()
    if not files:
        print('no FBX or OBJ found under', ind)
        return 1
    ok = bad = 0
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        # keep the pack's folder structure so category is not lost
        rel = os.path.relpath(os.path.dirname(f), ind)
        sub = os.path.join(outd, rel) if rel != '.' else outd
        os.makedirs(sub, exist_ok=True)
        dst = os.path.join(sub, name + '.glb')
        try:
            info, err = convert(f, dst)
        except Exception as e:                      # a bad file must not stop the batch
            info, err = None, repr(e)
        if err:
            bad += 1
            print('FAIL %-46s %s' % (name, err))
        else:
            ok += 1
            print('ok   %-46s %6d tris  %2d mesh  %3d bones  %d clips  -> %s'
                  % (name, info['tris'], len(info['meshes']), len(info['bones']),
                     len(info['actions']), os.path.relpath(dst, outd)))
            if info['bones']:
                print('       bones[0:6]: ' + ', '.join(info['bones'][:6]))
    print('\n%d converted, %d failed' % (ok, bad))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
