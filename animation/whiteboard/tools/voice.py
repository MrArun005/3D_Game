"""Narrates a story with Kokoro (a local neural TTS, no network at run time).

  python3 tools/voice.py stories/pythagoras.lines.json

Writes out/<story>-voice.wav (24 kHz mono) and stories/<story>.timing.json, the
start and length of every line, which the story's visuals are timed from.
Model files: KOKORO_DIR (default /tmp/claude-0/tts) holding kokoro-v1.0.onnx and
voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx releases.
"""
import json, os, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

src = sys.argv[1]
name = os.path.basename(src).split('.')[0]
spec = json.load(open(src))
d = os.environ.get('KOKORO_DIR', '/tmp/claude-0/tts')
k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
SR = 24000
t, chunks, timing = 0.0, [], []
for line in spec['lines']:
    samples, sr = k.create(line['text'], voice=spec['voice'], speed=spec['speed'], lang='en-us')
    assert sr == SR
    # Trim leading/trailing near-silence so the timing is the words themselves.
    a = np.abs(samples)
    idx = np.where(a > 0.01)[0]
    samples = samples[max(0, idx[0] - 240): idx[-1] + 2400] if len(idx) else samples
    t += line['gap']
    timing.append({'id': line['id'], 'text': line['text'], 't0': round(t, 3), 'dur': round(len(samples) / SR, 3)})
    chunks.append((t, samples))
    t += len(samples) / SR
    print(f"{line['id']:6s} {timing[-1]['t0']:6.2f}s  {timing[-1]['dur']:5.2f}s")
total = t + 2.5
out = np.zeros(int(total * SR) + 1, dtype=np.float32)
for t0, s in chunks:
    i = int(t0 * SR); out[i:i + len(s)] += s
os.makedirs('out', exist_ok=True)
sf.write(f'out/{name}-voice.wav', out, SR)
json.dump({'duration': round(total, 3), 'lines': timing}, open(f'stories/{name}.timing.json', 'w'), indent=1)
print(f'total {total:.1f}s')
