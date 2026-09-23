"""Narrates a story with Kokoro (a local neural TTS, no network at run time).

  python3 tools/voice.py stories/pythagoras.lines.json [out_dir]

Each line either follows the previous one after "gap" seconds, or starts at an
absolute "at" time (films whose picture is already cut). A line may set its own
"voice" and "fx": "radio" (band-limited, a little crunchy) for cockpit calls.
Writes <out_dir>/<name>-voice.wav (24 kHz mono) and <name>.timing.json next to
the lines file: every line's start and measured length, which visuals key off.
Model files: KOKORO_DIR (default /tmp/claude-0/tts) with kokoro-v1.0.onnx and
voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx releases.
"""
import json, math, os, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

src = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else 'out'
name = os.path.basename(src).split('.')[0]
spec = json.load(open(src))
d = os.environ.get('KOKORO_DIR', '/tmp/claude-0/tts')
k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
SR = 24000

def biquad(x, b0, b1, b2, a1, a2):
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o; y[i] = o
    return y

def bandpass(x, f, q):
    w = 2 * math.pi * f / SR; al = math.sin(w) / (2 * q); a0 = 1 + al
    return biquad(x, al / a0, 0, -al / a0, -2 * math.cos(w) / a0, (1 - al) / a0)

def radio(x):
    y = bandpass(bandpass(x, 1400, 0.6), 1600, 0.7)
    y = np.tanh(y * 6) * 0.6
    rng = np.random.default_rng(1)
    return (y + rng.normal(0, 0.012, len(y))).astype(np.float32)

t, chunks, timing = 0.0, [], []
for line in spec['lines']:
    samples, sr = k.create(line['text'], voice=line.get('voice', spec['voice']), speed=line.get('speed', spec['speed']), lang='en-us')
    a = np.abs(samples); idx = np.where(a > 0.01)[0]
    samples = samples[max(0, idx[0] - 240): idx[-1] + 2400] if len(idx) else samples
    if line.get('fx') == 'radio':
        samples = radio(samples)
    t = line['at'] if 'at' in line else t + line.get('gap', 0.5)
    dur = len(samples) / SR
    if timing and t < timing[-1]['t0'] + timing[-1]['dur']:
        print(f"  !! {line['id']} overlaps the line before by {timing[-1]['t0'] + timing[-1]['dur'] - t:.2f}s")
    if 'until' in line and t + dur > line['until']:
        print(f"  !! {line['id']} runs {t + dur - line['until']:.2f}s past {line['until']}")
    timing.append({'id': line['id'], 'text': line['text'], 't0': round(t, 3), 'dur': round(dur, 3)})
    chunks.append((t, samples))
    t += dur
    print(f"{line['id']:8s} {timing[-1]['t0']:6.2f}s  {dur:5.2f}s")
total = spec.get('duration', t + 2.5)
out = np.zeros(int(total * SR) + 1, dtype=np.float32)
for t0, s in chunks:
    i = int(t0 * SR); out[i:i + len(s)] += s[: max(0, len(out) - i)]
os.makedirs(out_dir, exist_ok=True)
sf.write(os.path.join(out_dir, f'{name}-voice.wav'), out, SR)
json.dump({'duration': round(total, 3), 'lines': timing}, open(os.path.join(os.path.dirname(src), f'{name}.timing.json'), 'w'), indent=1)
print(f'total {total:.1f}s')
