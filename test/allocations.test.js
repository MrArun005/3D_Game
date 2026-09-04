import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('no forbidden THREE allocations in hot update() loops', () => {
  const hotFiles = [
    'src/world/streetLife.js',
    'src/game/damage.js',
    'src/game/camera.js',
    'src/game/traffic.js',
    'src/game/crowd.js',
    'src/game/people.js',
    'src/game/onfoot.js',
    'src/game/character.js',
  ];

  for (const rel of hotFiles) {
    const full = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');

    // Extract update() function body
    const updateMatch = content.match(/update\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
    if (updateMatch) {
      const body = updateMatch[1];
      const allocMatch = body.match(/new\s+THREE\.(Vector[234]|Matrix[34]|Quaternion|Euler)/g);
      assert.equal(
        allocMatch,
        null,
        `Found forbidden per-frame THREE allocations inside update() in ${rel}: ${allocMatch?.join(', ')}`
      );
    }
  }
});
