// Joins a rendered picture and its synthesised soundtrack.
//   node tools/mux.mjs            -> out/flight1549.mp4
//   node tools/mux.mjs lesson     -> out/lesson.mp4
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const tag = process.argv[2] || 'flight1549';
const audio = tag === 'flight1549' ? 'soundtrack.wav' : `${tag}-soundtrack.wav`;
const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', path.join(OUT, `${tag}-video.mp4`), '-i', path.join(OUT, audio),
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path.join(OUT, `${tag}.mp4`)], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log(`wrote out/${tag}.mp4`);
