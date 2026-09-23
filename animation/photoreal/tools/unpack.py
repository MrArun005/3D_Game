"""Unpacks the cloud workers' renders/<shot>[-<i>of<n>].mp4 back into
out/frames/<shot>/NNNN.png at the indices their PART slice rendered."""
import glob, os, re, subprocess, tempfile, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = os.environ.get('FFMPEG', os.path.join(ROOT, '..', 'cartoons', 'node_modules', 'ffmpeg-static', 'ffmpeg'))
for mp4 in sorted(glob.glob(os.path.join(ROOT, 'renders', '*.mp4'))):
    m = re.match(r'(\w+?)(?:-(\d+)of(\d+))?\.mp4$', os.path.basename(mp4))
    shot, i, n = m.group(1), int(m.group(2) or 0), int(m.group(3) or 1)
    d = os.path.join(ROOT, 'out', 'frames', shot); os.makedirs(d, exist_ok=True)
    tmp = tempfile.mkdtemp()
    subprocess.run([FF, '-loglevel', 'error', '-i', mp4, '-pix_fmt', 'rgb24', os.path.join(tmp, '%04d.png')], check=True)
    fs = sorted(os.listdir(tmp))
    for j, f in enumerate(fs): shutil.move(os.path.join(tmp, f), os.path.join(d, f'{j * n + i + 1:04d}.png'))
    print(shot, f'{i}/{n}', len(fs), 'frames')
