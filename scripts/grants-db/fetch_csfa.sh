#!/bin/bash
cd "$(dirname "$0")"; UA='Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36'
for id in $(cat csfa_ids.txt); do
  f=csfa_programs/$id.html; [ -s "$f" ] && continue
  curl -s -L -m 30 -A "$UA" -o "$f" "https://omb.illinois.gov/public/gata/csfa/Program.aspx?csfa=$id"; sleep 0.25
done; echo "CSFA fetched: $(ls csfa_programs | wc -l)"
