#!/bin/bash
cd "$(dirname "$0")"
for y in 2026 2025; do
  for u in $(grep "/$y/" irs_zips.txt | sort); do
    f=irs_zips/$(basename "$u")
    if [ -f "$f.done" ]; then continue; fi
    curl -s -m 3600 -C - -o "$f" "$u" && touch "$f.done" && echo "$(date +%H:%M:%S) done $f $(du -m "$f" | cut -f1)MB"
  done
done
echo ALLDONE
