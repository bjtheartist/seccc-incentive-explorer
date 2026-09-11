#!/bin/bash
set -e
cd "$(dirname "$0")"
curl -s -m 600 -o grantsgov.zip "https://prod-grants-gov-chatbot.s3.amazonaws.com/extracts/GrantsDBExtract20260911v2.zip"
unzip -o -q grantsgov.zip -d grantsgov_xml
python3 - <<'PY'
import glob, json, xml.etree.ElementTree as ET, collections, re
f = glob.glob('grantsgov_xml/*.xml')[0]
ns = {'g': 'http://apply.grants.gov/system/OpportunityDetail-V1.0'}
tree = ET.iterparse(f, events=('end',))
out = open('grantsgov.jsonl', 'w'); n = 0; st = collections.Counter()
for ev, el in tree:
    tag = el.tag.split('}')[-1]
    if tag in ('OpportunitySynopsisDetail_1_0', 'OpportunityForecastDetail_1_0'):
        d = {c.tag.split('}')[-1]: (c.text or '').strip() for c in el}
        d['_kind'] = 'forecast' if 'Forecast' in tag else 'synopsis'
        out.write(json.dumps(d) + '\n'); n += 1
        st[d.get('CloseDate','')[-4:] or 'none'] += 1
        el.clear()
print('records:', n); print('close-year dist:', dict(sorted(st.items())[-8:]))
PY
