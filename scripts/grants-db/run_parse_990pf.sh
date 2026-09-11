#!/bin/bash
cd "$(dirname "$0")"
while :; do
  did=0
  for d in irs_zips/*.zip.done; do
    zp=${d%.done}; b=$(basename "$zp" .zip)
    [ -f "foundations_$b.done" ] && continue
    python3 parse_990pf.py "$zp" >> parse_990pf.log 2>&1; did=1
  done
  grep -q ALLDONE fetch_irs_zips.log && [ $did -eq 0 ] && { echo PARSEDONE >> parse_990pf.log; break; }
  sleep 20
done
