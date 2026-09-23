// Joins the rendered picture and the synthesised soundtrack: out/flight1549.mp4.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'flight1549-video.mp4'), '-i', path.join(OUT, 'soundtrack.wav'),
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path.join(OUT, 'flight1549.mp4')], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log('wrote out/flight1549.mp4');
