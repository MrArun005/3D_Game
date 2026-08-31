import { buildWardrobe } from './tools/avatar/wardrobe.mjs';
for (const sex of ['male','female']) {
  const { anat, made } = await buildWardrobe(`public/models/avatar/${sex}.glb`, `public/models/avatar/${sex}.wardrobe.glb`);
  console.log('=== '+sex+'  chinY='+anat.chinY.toFixed(3)+' crownY='+anat.crownY.toFixed(3)+' span='+anat.span.toFixed(3)+' halfW='+anat.halfW.toFixed(3)+' earW='+anat.earW.toFixed(3)+' maxZ='+anat.maxZ.toFixed(3));
  for (const m of made) console.log('  '+(m.ok?'ok  ':'FAIL')+' '+m.name.padEnd(18)+(m.ok?`${String(m.tris).padStart(5)} tris`:m.why));
}
