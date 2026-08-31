These two are GENERATED. Recreate them any time with:

    node tools/avatar/build.mjs

which reads assets/source/avatar/vendor/*.glb and writes both files here. So if
they go stale, or you change a mask in tools/avatar/wardrobe.mjs, just rerun it.

Each contains the source avatar plus 11 generated parts — beard_full,
beard_short, beard_goatee, beard_moustache, beard_chinstrap, hair_buzz,
hair_crop, hair_afro, jacket, tshirt, vest — every one bound to the same
skeleton and carrying the same 63 blendshapes, so the runtime picks a look by
toggling node visibility rather than loading anything.
