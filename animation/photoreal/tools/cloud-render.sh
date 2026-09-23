#!/bin/bash
# Render one shot (or one slice of it) on a spare machine and push the result
# as a near-lossless clip:  tools/cloud-render.sh wheat 0/2
# The stitching machine unpacks renders/<shot>[-<i>of<n>].mp4 back into frames.
set -e
cd "$(dirname "$0")/.."
SHOT=$1; PART=${2:-0/1}
python3 -c "import bpy" 2>/dev/null || pip install -q bpy==4.2.0
python3 -c "import imageio_ffmpeg" 2>/dev/null || pip install -q imageio-ffmpeg
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
RES=${RES:-640x360} SAMPLES=${SAMPLES:-8} STEP=${STEP:-3} PART=$PART python3 shots/$SHOT.py | grep -E 'FRAME|DONE|Error'
# Pack only this slice's frames, in order.
i=${PART%/*}; n=${PART#*/}; TAG=$SHOT; [ "$n" != 1 ] && TAG="$SHOT-${i}of$n"
mkdir -p renders out/pack-$TAG; k=0
for f in $(ls out/frames/$SHOT/*.png | sort); do k=$((k+1)); cp "$f" out/pack-$TAG/$(printf %04d $k).png; done
"$FF" -y -loglevel error -framerate 8 -i out/pack-$TAG/%04d.png -c:v libx264 -crf 6 -pix_fmt yuv444p renders/$TAG.mp4
git add renders/$TAG.mp4 && git commit -qm "Photoreal: rendered $TAG frames"
for d in 2 4 8 16 32; do git pull -q --rebase origin claude/3d-animation-incidents-dp717p && git push -q origin HEAD:claude/3d-animation-incidents-dp717p && echo PUSHED $TAG && exit 0; sleep $d; done
exit 1
