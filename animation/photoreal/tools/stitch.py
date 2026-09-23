"""Stitches "Before Us": each shot's 12 fps frames -> motion-interpolated 24 fps
720p clip; clips cross-dissolved at their start times; title, subtitles and end
card overlaid; the soundtrack muxed in.

  python3 tools/stitch.py            -> out/before-us.mp4 (and out/before-us-share.mp4 under 30 MB)
  python3 tools/stitch.py volcano    -> just (re)build that shot's clip
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
FF = os.environ.get('FFMPEG', os.path.join(ROOT, '..', 'cartoons', 'node_modules', 'ffmpeg-static', 'ffmpeg'))
W, H = 1280, 720
shots = json.load(open(os.path.join(ROOT, 'stories', 'before-us.shots.json')))
timing = json.load(open(os.path.join(ROOT, 'stories', 'before-us.timing.json')))
FONT = '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'
FONT_B = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
XF = 0.7


def run(args):
    subprocess.run([FF, '-y', '-loglevel', 'error', *args], check=True)


def clip(name):
    src = os.path.join(OUT, 'frames', name, '%04d.png')
    dst = os.path.join(OUT, f'clip-{name}.mp4')
    # Scale first (renders may be 960x540), then synthesise the in-between frames.
    run(['-framerate', '12', '-i', src, '-vf',
         f'scale={W}:{H}:flags=lanczos,minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,unsharp=5:5:0.4',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', dst])
    return dst


def card(text_lines, path, big=False):
    """A transparent overlay PNG: centred text with a soft shadow."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = H // 2 - (70 if big else 0)
    for i, (txt, size, font) in enumerate(text_lines):
        f = ImageFont.truetype(font, size)
        w = d.textlength(txt, font=f)
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).text(((W - w) / 2, y + 3), txt, font=f, fill=(0, 0, 0, 200))
        im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(6)))
        d = ImageDraw.Draw(im); d.text(((W - w) / 2, y), txt, font=f, fill=(245, 240, 230, 255))
        y += int(size * 1.35)
    im.save(path)


def subtitle(text, path):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT_B, 27)
    words, lines, cur = text.split(), [], ''
    for w in words:
        s = f'{cur} {w}'.strip()
        if d.textlength(s, font=f) > 980 and cur: lines.append(cur); cur = w
        else: cur = s
    lines.append(cur)
    y = H - 40 - 38 * len(lines)
    for ln in lines:
        w = d.textlength(ln, font=f)
        for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2), (2, 2)]:
            d.text(((W - w) / 2 + dx, y + dy), ln, font=f, fill=(0, 0, 0, 170))
        d.text(((W - w) / 2, y), ln, font=f, fill=(255, 255, 255, 255))
        y += 38
    im.save(path)


def main():
    only = sys.argv[1:]
    for s in shots:
        if only and s['shot'] not in only: continue
        if not os.path.exists(os.path.join(OUT, 'frames', s['shot'], '0001.png')): sys.exit(f"no frames for {s['shot']}")
        print('clip', s['shot']); clip(s['shot'])
    if only: return
    # Overlays.
    ov = []
    card([('BEFORE US', 76, FONT), ('the story of Earth, before people', 28, FONT_B)], os.path.join(OUT, 'ov-title.png'), big=True); ov.append(('ov-title.png', 0.4, 4.2))
    card([('BEFORE US', 64, FONT), ('Every frame generated in code: Blender Cycles, no footage, no downloaded assets', 20, FONT_B)], os.path.join(OUT, 'ov-end.png'), big=True)
    ov.append(('ov-end.png', timing['duration'] - 3.0, timing['duration']))
    for i, l in enumerate(timing['lines']):
        p = f'ov-sub{i}.png'; subtitle(l['text'], os.path.join(OUT, p)); ov.append((p, l['t0'] - 0.1, l['t0'] + l['dur'] + 0.3))
    # Filter graph: dissolve the clips at their start times, then lay the overlays on top.
    inputs, fg = [], []
    for s in shots: inputs += ['-i', os.path.join(OUT, f"clip-{s['shot']}.mp4")]
    for p, *_ in ov: inputs += ['-loop', '1', '-i', os.path.join(OUT, p)]
    last = '[0:v]'
    for i, s in enumerate(shots[1:], 1):
        fg.append(f"{last}[{i}:v]xfade=transition=fade:duration={XF}:offset={s['start']:.3f}[x{i}]"); last = f'[x{i}]'
    n = len(shots)
    for k, (p, a, b) in enumerate(ov):
        j = n + k
        fg.append(f"[{j}:v]format=rgba,fade=t=in:st={a:.2f}:d=0.4:alpha=1,fade=t=out:st={b - 0.4:.2f}:d=0.4:alpha=1[o{k}]")
        fg.append(f"{last}[o{k}]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})':shortest=1[v{k}]"); last = f'[v{k}]'
    fg.append(f"{last}fade=t=in:st=0:d=1.0,fade=t=out:st={timing['duration'] - 1.2:.2f}:d=1.2,trim=0:{timing['duration']:.3f}[vout]")
    wav = os.path.join(OUT, 'before-us.wav')
    run([*inputs, '-i', wav, '-filter_complex', ';'.join(fg), '-map', '[vout]', '-map', f'{n + len(ov)}:a',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest',
         '-movflags', '+faststart', os.path.join(OUT, 'before-us.mp4')])
    # A copy under 30 MB for chat and X.
    size = os.path.getsize(os.path.join(OUT, 'before-us.mp4'))
    if size > 29e6:
        kbps = int(27e6 * 8 / timing['duration'] / 1000) - 160
        src = os.path.join(OUT, 'before-us.mp4')
        run(['-i', src, '-c:v', 'libx264', '-preset', 'slow', '-b:v', f'{kbps}k', '-pass', '1', '-an', '-f', 'mp4', '/dev/null'])
        run(['-i', src, '-c:v', 'libx264', '-preset', 'slow', '-b:v', f'{kbps}k', '-pass', '2', '-c:a', 'copy', '-movflags', '+faststart', os.path.join(OUT, 'before-us-share.mp4')])
    else:
        import shutil; shutil.copy(os.path.join(OUT, 'before-us.mp4'), os.path.join(OUT, 'before-us-share.mp4'))
    print('wrote out/before-us.mp4 and out/before-us-share.mp4')


if __name__ == '__main__':
    main()
