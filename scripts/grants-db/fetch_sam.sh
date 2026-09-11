#!/bin/bash
cd "$(dirname "$0")"; UA='Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36'
: > sam_assistance_listings.jsonl; page=0
while :; do
  curl -s -m 60 -A "$UA" "https://sam.gov/api/prod/sgs/v1/search/?index=cfda&q=&page=$page&size=100&is_active=true" -o sam_page.json || { echo "curl fail $page"; sleep 3; continue; }
  n=$(python3 -c "import json;d=json.load(open('sam_page.json'));r=d.get('_embedded',{}).get('results',[]);import sys;[print(json.dumps(x)) for x in r];print(len(r),d.get('page',{}).get('totalElements'),file=sys.stderr)" 2>>sam_meta.log >> sam_assistance_listings.jsonl; tail -1 sam_meta.log)
  echo "page $page -> $n"; cnt=${n%% *}; [ "$cnt" = "0" ] && break; [ -z "$cnt" ] && break; page=$((page+1)); [ $page -gt 60 ] && break; sleep 0.5
done
echo "SAM rows: $(wc -l < sam_assistance_listings.jsonl)"
