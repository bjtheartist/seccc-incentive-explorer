import re,html,json,glob,os,datetime
LABELS=['CSFA Number','Agency Name','Agency Identification','Agency Contact','Short Description','Federal Authorization','Illinois Statue Authorization','Illinois Administrative Rules Authorization','Objective','Prime Recipient','UGA Program Terms','Eligible Applicants','Applicant Eligibility','Beneficiary Eligibility','Types of Assistance','Subject / Service Area','Credentials / Documentation','Preapplication Coordination','Application Procedures','Criteria Selecting Proposals','Award Procedures','Deadlines','Range of Approval or Disapproval Time','Appeals','Renewals','Formula Matching Requirements','Uses and Restrictions','Reports','Audits','Records','Account Identification','Obligation(s)','Range and Average of Financial Assistance','Program Accomplishments','Regulations, Guidelines, and Literature','Regional or Local Assistance Location','Headquarters Office','Program Website','Example Projects','Published Date','Funding By Fiscal Year','Federal Funding','Notice of Funding Opportunities','Notice of Funding Opportunity']
def clean(s):
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S); t=html.unescape(re.sub(r'<[^>]+>','\n',t))
    return [l.strip() for l in t.split('\n') if l.strip()]
out=[]
for f in sorted(glob.glob('csfa_programs/*.html'),key=lambda x:int(os.path.basename(x)[:-5])):
    s=open(f,encoding='utf-8',errors='ignore').read(); lines=clean(s)
    if len(lines)<20: continue
    try: i=lines.index('Program')
    except ValueError: i=0
    title=lines[i+1] if i+1<len(lines) else None
    rec={'csfaId':os.path.basename(f)[:-5],'title':title}
    cur=None; buf={}
    for l in lines[i+2:]:
        if l in LABELS: cur=l; buf.setdefault(cur,[]); continue
        if l.isupper() and len(l)<40 and l.endswith('INFORMATION'): cur=None; continue
        if cur: buf[cur].append(l)
    for k,v in buf.items(): rec[k]=' '.join(v).strip()
    # NOFO table on program page (if present)
    nofos=[]
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>',s,flags=re.S):
        cells=[re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',c))).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>',tr,flags=re.S)]
        if cells and re.match(r'\d\d/\d\d/\d{4}',' '.join(cells)) and len(cells)>=2: nofos.append(cells)
    rec['nofoRows']=nofos
    out.append(rec)
json.dump(out,open('csfa_programs.json','w'),indent=1)
import collections
print('programs parsed:',len(out))
print('eligible applicants top:',collections.Counter(r.get('Eligible Applicants','')[:60] for r in out).most_common(6))
print('types of assistance:',collections.Counter(r.get('Types of Assistance','') for r in out).most_common(5))
print('deadlines non-NA:',sum(1 for r in out if r.get('Deadlines') and r['Deadlines']!='N/A'), ' with nofo rows:',sum(1 for r in out if r['nofoRows']))
ex=next((r for r in out if r.get('Deadlines') and r['Deadlines']!='N/A'),out[0]); print({k:str(v)[:160] for k,v in ex.items() if k in ['csfaId','title','Agency Name','Eligible Applicants','Types of Assistance','Deadlines','Range and Average of Financial Assistance','Program Website','nofoRows']})
