#!/bin/bash
# Renders shots one after another. Add a shot name to out/queue.txt and it will be
# picked up when the current render finishes. Waits for any render already running.
cd "$(dirname "$0")/.."
while pgrep -f "shots/volcano.py" >/dev/null && [ "$1" != "--now" ]; do sleep 20; done
while true; do
  next=$(head -n1 out/queue.txt 2>/dev/null)
  if [ -z "$next" ]; then sleep 30; [ -f out/queue.stop ] && exit 0; continue; fi
  sed -i '1d' out/queue.txt
  echo "START $next $(date +%T)" >> out/queue.log
  RES=${RES:-640x360} SAMPLES=${SAMPLES:-8} STEP=${STEP:-3} python3 shots/$next.py > out/render-$next.log 2>&1
  echo "END $next $(date +%T) $(tail -1 out/render-$next.log)" >> out/queue.log
done
