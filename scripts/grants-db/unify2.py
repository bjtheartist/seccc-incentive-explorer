#!/usr/bin/env python3
"""Unify all sources into the Chamber's record spec: program / window / funding / applicants / uses / requirements / verification + readiness."""
import json,glob,re,csv,os,datetime,collections
B=os.path.dirname(os.path.abspath(__file__)); WT='/Users/billyndizeye/seccc-wt/grants-db'; OUT=os.path.join(WT,'output','grants-db'); os.makedirs(OUT,exist_ok=True)
TODAY=datetime.date(2026,9,11); ISO=TODAY.isoformat()
def pd(s):
    m=re.match(r'(\d{4})-(\d{2})-(\d{2})',str(s or ''))
    try: return datetime.date(int(m[1]),int(m[2]),int(m[3])) if m else None
    except: return None
def iso(d): return d.isoformat() if d else None
def plus(days): return iso(TODAY+datetime.timedelta(days=days))
def money(s):
    try: return int(float(s)) if s not in (None,'') else None
    except: return None
def clean(s,n=600): return re.sub(r'\s+',' ',str(s)).strip()[:n] if s else None
FUNDING_SOURCE={'City':'public','County':'public','State':'public','Federal':'public','Utility':'utility','Private':'corporate','Foundation':'philanthropic','Nonprofit':'philanthropic'}
REIMB=re.compile(r'reimburs',re.I); MATCH=re.compile(r'\b(match(ing)?|cost[- ]shar|(\d{1,2})\s?%\s?(of|match))',re.I)
ROLL=re.compile(r'\b(none|no deadline|no deadlines|any ?time|anytime|rolling|ongoing|continuous|throughout the year|year[- ]round|no specific|not applicable|n/?a)\b',re.I)
MONTHS=re.compile(r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b',re.I)
REQ_PATTERNS=[('licenses',r'\b(business license|licensed|licensure|DCFS[- ]licensed|contractor.{0,20}licensed)\b'),('taxStatus',r'\b(501\s?\(c\)\s?\(?3\)?|tax[- ]exempt|nonprofit status|for[- ]profit|good standing|property taxes? current|no (outstanding )?(city )?debt)\b'),('financialDocuments',r'\b(tax return|P&L|profit and loss|financial statements?|bank statement|projections|revenue (of|documentation)|business plan)\b'),('permits',r'\b(permit|zoning|building code)\b'),('bids',r'\b(two|2)\s+(comparable\s+)?bids\b')]
rows=[]
def readiness(r):
    miss=[]
    a=r['applicants']; f=r['funding']; w=r['window']; u=r['uses']; v=r['verification']
    if not a.get('businessTypes'): miss.append('applicants.businessTypes')
    if not a.get('location'): miss.append('applicants.location')
    if not f.get('type') or f['type']=='unknown': miss.append('funding.type')
    if not (u.get('eligible') or u.get('summary') or u.get('observedPurposes')): miss.append('uses.eligible')
    st=w.get('status'); ok_when = (st=='open' and w.get('deadline')) or st=='rolling' or (st=='scheduled' and (w.get('opensAt') or w.get('deadline') or w.get('nextExpected') or (w.get('recurs')=='recurring_scheduled' and w.get('label'))))
    if not ok_when: miss.append('window.dates')
    if not (v.get('sourceUrl') and v.get('dateChecked')): miss.append('verification.source')
    r['readiness']={'status':'ready' if not miss else 'needs_research','missing':miss,
                    'note':None if not miss else 'Marked needs research until evidence covers fit, funding use, and timing.'}
def next_review(w,source):
    st=w.get('status'); dl=pd(w.get('deadline')); op=pd(w.get('opensAt'))
    if st=='open' and dl: d=dl+datetime.timedelta(days=1)
    elif st=='scheduled' and op and op>TODAY: d=op
    elif st=='rolling': d=TODAY+datetime.timedelta(days=90)
    else: d=TODAY+datetime.timedelta(days=180)
    if source=='curated': d=min(d,TODAY+datetime.timedelta(days=30))
    return iso(d)
def emit(id,source,recordType,program,window,funding,applicants,uses,requirements,verification,chicagoRelevance,tags,notes=None,extra=None):
    dl=pd(window.get('deadline')); window['closingSoon']=bool(dl and 0<=(dl-TODAY).days<=21); window['daysToDeadline']=(dl-TODAY).days if dl else None
    verification.setdefault('dateChecked',ISO); verification.setdefault('staffOwner',None); verification['nextReviewDate']=next_review(window,source)
    r={'id':id,'source':source,'recordType':recordType,'program':program,'window':window,'funding':funding,'applicants':applicants,'uses':uses,'requirements':requirements,'verification':verification,'chicagoRelevance':chicagoRelevance,'tags':tags,'notes':notes}
    if extra: r['sourceRecord']=extra
    readiness(r); rows.append(r)
def req_from_text(*texts):
    t=' '.join(x for x in texts if x); out={}
    for k,p in REQ_PATTERNS:
        m=re.search(p,t,re.I)
        if m: out[k]=clean(t[max(0,m.start()-60):m.end()+80],200)
    return out
# ---------- 1. curated ----------
cur=json.load(open(os.path.join(WT,'data','grants-active.json')))
for c in cur['active']:
    e=c.get('eligibility') or {}; w=c.get('window') or {}; a=c.get('amount') or {}; txt=' '.join(str(x) for x in [e.get('summary'),c.get('notes'),c.get('evidence'),c.get('costToApply')] if x)
    ent=list(e.get('entityTypes') or []); lt='either' if re.search(r'\btenant',txt,re.I) and ('property_owner' in ent or re.search(r'owner',txt,re.I)) else ('owner' if 'property_owner' in ent else ('tenant' if re.search(r'\btenant',txt,re.I) else 'unknown'))
    ptime='reimbursement' if (c.get('instrument') in ('reimbursement','rebate') or REIMB.search(txt)) else ('upfront' if re.search(r'\b(upfront|paid directly|cash award|direct (cash )?grant)\b',txt,re.I) else 'unknown')
    emit(id=c['id'],source='curated',recordType='opportunity',
         program={'name':c['name'],'funder':c['sponsor'],'officialUrl':c.get('sourceUrl'),'applyUrl':c.get('applyUrl') or c.get('sourceUrl'),'fundingSource':FUNDING_SOURCE.get(c.get('level'),'public'),'level':c.get('level'),'explorerCatalogId':c.get('explorerCatalogId')},
         window={'status':c['status'],'opensAt':w.get('opensAt'),'deadline':w.get('closesAt'),'deadlineTime':w.get('closesAtTime'),'recurs':c.get('cadence'),'nextExpected':(c.get('nextWindow') or {}).get('expected'),'label':w.get('label'),'subWindows':c.get('subWindows')},
         funding={'amountMin':a.get('min'),'amountMax':a.get('max'),'amountDisplay':a.get('display'),'type':c.get('instrument'),'requiredContribution':a.get('share') or (clean(MATCH.search(txt).group(0),80) if MATCH.search(txt) else None),'paymentTiming':ptime,'costToApply':c.get('costToApply')},
         applicants={'businessTypes':ent,'industriesIncluded':e.get('sectorsIncluded') or [],'industriesExcluded':e.get('sectorsExcluded') or [],'operatingStage':e.get('stage'),'location':e.get('geography'),'landlordOrTenant':lt,'demographicRestriction':e.get('demographicRestriction'),'sizeLimits':e.get('sizeLimits'),'summary':e.get('summary')},
         uses={'eligible':e.get('useOfFunds') or [],'exclusions':[e['keyExclusions']] if e.get('keyExclusions') else [],'summary':None},
         requirements={**req_from_text(txt),'revenueLimit':(clean(re.search(r'revenue[^.;]{0,80}',txt,re.I).group(0),120) if re.search(r'revenue[^.;]{0,80}',txt,re.I) else None),'employeeLimit':(clean(re.search(r'\d+\s*(employees|FTE)',txt,re.I).group(0),60) if re.search(r'\d+\s*(employees|FTE)',txt,re.I) else None)},
         verification={'sourceUrl':c.get('sourceUrl'),'evidence':c.get('evidence'),'dateChecked':c.get('verifiedAt') or ISO,'checkedBy':f"research-agent:{c.get('tier')}",'legitimacy':c.get('legitimacy'),'isNew':c.get('isNew'),'newBecause':c.get('newBecause')},
         chicagoRelevance='high',tags=sorted(set(['chicago_curated']+[f"entity:{x}" for x in ent]+(['closing_soon'] if c.get('closingSoon') else []))),notes=c.get('notes'))
# ---------- 2. grants.gov ----------
for line in open(os.path.join(B,'grantsgov_active.jsonl')):
    d=json.loads(line); e=d['eligibility']; ent=e['entityTypes']; fit=any(x in ent for x in ('small_business','for_profit','nonprofit','individual','unrestricted'))
    emit(id=d['id'],source='grants.gov',recordType='opportunity',
         program={'name':d['name'],'funder':d['sponsor'],'officialUrl':d['sourceUrl'],'applyUrl':d['applyUrl'],'fundingSource':'public','level':'Federal','opportunityNumber':d.get('opportunityNumber'),'cfda':d.get('cfda')},
         window={'status':d['status'],'opensAt':d['window'].get('opensAt'),'deadline':d['window'].get('closesAt'),'deadlineTime':None,'recurs':d['cadence'],'nextExpected':None,'label':d['window'].get('label')},
         funding={'amountMin':d['amount'].get('min'),'amountMax':d['amount'].get('max'),'amountDisplay':d['amount'].get('display'),'type':d['instrument'],'requiredContribution':('Cost sharing or matching required' if str(e.get('costSharing')).lower().startswith('y') else ('None stated' if str(e.get('costSharing')).lower().startswith('n') else None)),'paymentTiming':'unknown','costToApply':'free','totalProgramFunding':d['amount'].get('totalProgramFunding'),'expectedAwards':d['amount'].get('expectedAwards')},
         applicants={'businessTypes':ent,'industriesIncluded':[],'industriesExcluded':[],'operatingStage':None,'location':'US (national)','landlordOrTenant':'not_applicable','demographicRestriction':None,'sizeLimits':None,'summary':e.get('summary'),'applicantTypes':e.get('applicantTypes')},
         uses={'eligible':[],'exclusions':[],'summary':clean(d.get('description'),700)},
         requirements=req_from_text(e.get('summary'),d.get('description')),
         verification={'sourceUrl':d['sourceUrl'],'evidence':d['evidence'],'dateChecked':ISO,'checkedBy':'bulk:grants.gov','legitimacy':'official','isNew':d.get('isNew'),'newBecause':d.get('newBecause')},
         chicagoRelevance='medium' if fit else 'low',tags=['federal','forecast' if d['status']=='scheduled' else 'posted']+[f"entity:{x}" for x in ent]+(['applicant_fit'] if fit else ['government_or_institution_only']))
# ---------- 3. SAM ----------
posted=collections.defaultdict(list)
for r in rows:
    if r['source']=='grants.gov':
        for c in (r['program'].get('cfda') or []): posted[c].append((r['id'],r['window']['status'],r['window'].get('deadline')))
seen=set(); n_sam=0
for line in open(os.path.join(B,'sam_assistance_listings.jsonl')):
    x=json.loads(line); pn=x.get('programNumber')
    if not pn or pn in seen or str(x.get('isActive')).lower()!='true': continue
    seen.add(pn); n_sam+=1; el=x.get('eligibility') or {}; at=[t.get('value') for t in ((el.get('applicant') or {}).get('types') or []) if t.get('value')]
    ent=set()
    for v in at:
        lv=v.lower()
        if 'small business' in lv: ent.add('small_business')
        if 'profit organization' in lv and 'non' not in lv: ent.add('for_profit')
        if 'nonprofit' in lv or 'non-profit' in lv: ent.add('nonprofit')
        if 'individual' in lv: ent.add('individual')
        if 'unrestricted' in lv: ent.add('unrestricted')
        if any(k in lv for k in ('state','local','government','tribal','territor','school','university','college')): ent.add('government_or_institution')
    fit=bool(ent&{'small_business','for_profit','nonprofit','individual','unrestricted'}); live=posted.get(pn,[]); open_now=[c for _,s,c in live if s=='open']
    types=[h.get('value') for a in (x.get('assistanceTypes') or []) for h in (a.get('hierarchy') or []) if h.get('level')==2]
    instr='grant' if any('grant' in (t or '').lower() for t in types) else ('cooperative_agreement' if any('cooperative' in (t or '').lower() for t in types) else 'other')
    fin=x.get('financial') or {}; agency=' / '.join(o.get('name','') for o in (x.get('organizationHierarchy') or [])[:2])
    emit(id=f"sam-{pn}",source='sam.gov',recordType='standing_program',
         program={'name':x.get('title'),'funder':agency,'officialUrl':f"https://sam.gov/fal/{x.get('_id')}/view",'applyUrl':x.get('website') or f"https://sam.gov/fal/{x.get('_id')}/view",'fundingSource':'public','level':'Federal','cfda':[pn]},
         window={'status':'open' if open_now else 'standing','opensAt':None,'deadline':max([c for c in open_now if c] or [None]),'deadlineTime':None,'recurs':'recurring_scheduled' if live else 'recurring_unscheduled','nextExpected':None,'label':'open round on grants.gov' if open_now else 'no open round on grants.gov today','linkedOpportunities':[i for i,_,_ in live]},
         funding={'amountMin':None,'amountMax':None,'amountDisplay':clean(fin.get('additionalInfo'),300) or 'See listing','type':instr,'requiredContribution':None,'paymentTiming':'unknown','costToApply':'free'},
         applicants={'businessTypes':sorted(ent),'industriesIncluded':[],'industriesExcluded':[],'operatingStage':None,'location':'US (national)','landlordOrTenant':'not_applicable','demographicRestriction':None,'sizeLimits':None,'summary':clean((el.get('applicant') or {}).get('additionalInfo') or '; '.join(at)),'applicantTypes':at,'beneficiary':clean((el.get('beneficiary') or {}).get('additionalInfo'),300)},
         uses={'eligible':[],'exclusions':[],'summary':clean(x.get('objective'),700)},
         requirements={**req_from_text(el.get('documentation')),'documentation':clean(el.get('documentation'),400)},
         verification={'sourceUrl':f"https://sam.gov/fal/{x.get('_id')}/view",'evidence':f"SAM.gov assistance listing, isActive=True, modified {str(x.get('modifiedDate'))[:10]}",'dateChecked':ISO,'checkedBy':'bulk:sam.gov','legitimacy':'official'},
         chicagoRelevance='medium' if fit else 'low',tags=['federal','standing_program']+[f"entity:{x}" for x in sorted(ent)]+(['applicant_fit'] if fit else ['government_or_institution_only'])+(['open_round_now'] if open_now else []))
# ---------- 4. Illinois CSFA programs + NOFOs ----------
def ent_from(s):
    s=(s or '').lower(); e=set()
    if 'nonprofit' in s: e.add('nonprofit')
    if 'for-profit' in s or 'for profit' in s: e.add('for_profit')
    if 'small business' in s: e.add('small_business')
    if 'individual' in s: e.add('individual')
    if 'government' in s or 'state agency' in s or 'education organizations' in s: e.add('government_or_institution')
    return e
csfa=json.load(open(os.path.join(B,'csfa_programs.json'))) if os.path.exists(os.path.join(B,'csfa_programs.json')) else []
by_title={re.sub(r'[^a-z0-9]+',' ',(p.get('title') or '').lower()).strip():p for p in csfa}
def csfa_common(p):
    ent=ent_from(p.get('Eligible Applicants')); fit=bool(ent&{'nonprofit','for_profit','small_business','individual'})
    return ent,fit
for p in csfa:
    ent,fit=csfa_common(p)
    if 'state agency use' in (p.get('Eligible Applicants') or '').lower() and not fit: continue
    dl=(p.get('Deadlines') or '').strip(); has_dl=bool(dl) and dl.upper()!='N/A'
    st='rolling' if (has_dl and ROLL.search(dl)) else 'standing'
    emit(id=f"il-csfa-{p['csfaId']}",source='illinois_csfa',recordType='standing_program',
         program={'name':p.get('title'),'funder':p.get('Agency Name'),'officialUrl':f"https://omb.illinois.gov/public/gata/csfa/Program.aspx?csfa={p['csfaId']}",'applyUrl':clean(p.get('Program Website'),200) or 'https://grants.illinois.gov/portal/','fundingSource':'public','level':'State','csfaNumber':(p.get('CSFA Number') or '').strip(),'subjectArea':p.get('Subject / Service Area')},
         window={'status':st,'opensAt':None,'deadline':None,'deadlineTime':None,'recurs':'recurring_unscheduled','nextExpected':None,'label':clean(dl,200) if has_dl else 'per NOFO'},
         funding={'amountMin':None,'amountMax':None,'amountDisplay':clean(p.get('Range and Average of Financial Assistance'),200) or 'See program','type':'grant' if 'grant' in (p.get('Types of Assistance') or '').lower() else ('other' if p.get('Types of Assistance') else 'unknown'),'requiredContribution':clean(p.get('Formula Matching Requirements'),200),'paymentTiming':'unknown','costToApply':'free','assistanceType':p.get('Types of Assistance')},
         applicants={'businessTypes':sorted(ent),'industriesIncluded':[],'industriesExcluded':[],'operatingStage':None,'location':'Illinois','landlordOrTenant':'not_applicable','demographicRestriction':None,'sizeLimits':None,'summary':clean(p.get('Applicant Eligibility') if (p.get('Applicant Eligibility') or 'N/A')!='N/A' else p.get('Eligible Applicants')),'applicantTypes':[a.strip() for a in (p.get('Eligible Applicants') or '').split(';') if a.strip()],'beneficiary':clean(p.get('Beneficiary Eligibility'),300)},
         uses={'eligible':[],'exclusions':[],'summary':clean(p.get('Uses and Restrictions') if (p.get('Uses and Restrictions') or 'N/A')!='N/A' else (p.get('Short Description') or p.get('Objective')),700)},
         requirements={**req_from_text(p.get('Credentials / Documentation'),p.get('Applicant Eligibility')),'applicationMaterials':clean(p.get('Credentials / Documentation'),400) if (p.get('Credentials / Documentation') or 'N/A')!='N/A' else None,'other':['GATA pre-qualification in the Illinois Grantee Portal']},
         verification={'sourceUrl':f"https://omb.illinois.gov/public/gata/csfa/Program.aspx?csfa={p['csfaId']}",'evidence':'Illinois CSFA program record (GATA catalog)','dateChecked':ISO,'checkedBy':'bulk:illinois_csfa','legitimacy':'official'},
         chicagoRelevance='medium' if fit else 'low',tags=['illinois','standing_program']+[f"entity:{x}" for x in sorted(ent)]+(['applicant_fit'] if fit else ['government_or_institution_only']))
nofos=json.load(open(os.path.join(B,'csfa_nofos.json'))) if os.path.exists(os.path.join(B,'csfa_nofos.json')) else []
for i,n in enumerate(nofos):
    o=pd(n.get('opensAt')); c=pd(n.get('closesAt'))
    if c and c<TODAY: continue
    stale=bool(n.get('noEndDate') and o and (TODAY-o).days>365)
    t=re.sub(r'^(GMS\s+)','',n['title']); prog=by_title.get(re.sub(r'[^a-z0-9]+',' ',t.lower()).strip())
    ent,fit=csfa_common(prog) if prog else (set(),False)
    emit(id=f"il-nofo-{i+1:03d}",source='illinois_nofo',recordType='opportunity',
         program={'name':t,'funder':n.get('agency'),'officialUrl':'https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx','applyUrl':'https://grants.illinois.gov/portal/','fundingSource':'public','level':'State','linkedCsfaId':(prog or {}).get('csfaId')},
         window={'status':'open' if c else 'rolling','opensAt':n.get('opensAt'),'deadline':n.get('closesAt'),'deadlineTime':None,'recurs':'one_time' if c else 'rolling','nextExpected':None,'label':'no end date posted' if n.get('noEndDate') else 'NOFO application range'},
         funding={'amountMin':None,'amountMax':None,'amountDisplay':n.get('awardRange') or 'Not stated','type':'grant','requiredContribution':clean((prog or {}).get('Formula Matching Requirements'),200),'paymentTiming':'unknown','costToApply':'free'},
         applicants={'businessTypes':sorted(ent),'industriesIncluded':[],'industriesExcluded':[],'operatingStage':None,'location':'Illinois','landlordOrTenant':'not_applicable','demographicRestriction':None,'sizeLimits':None,'summary':clean((prog or {}).get('Eligible Applicants')) if prog else None},
         uses={'eligible':[],'exclusions':[],'summary':clean((prog or {}).get('Uses and Restrictions'),700) if prog and (prog.get('Uses and Restrictions') or 'N/A')!='N/A' else None},
         requirements={'other':['GATA pre-qualification in the Illinois Grantee Portal'] + (['Apply in AmpliFund'] if n.get('inAmpliFund') else [])},
         verification={'sourceUrl':'https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx','evidence':f"GATA Funding Opportunities list: {n.get('opensAt')} - {n.get('closesAt') or 'No end date'}",'dateChecked':ISO,'checkedBy':'bulk:illinois_nofo','legitimacy':'official','isNew':bool(o and (TODAY-o).days<=60)},
         chicagoRelevance='medium' if (fit or not prog) else 'low',tags=['illinois','nofo']+(['stale_no_end_date'] if stale else [])+[f"entity:{x}" for x in sorted(ent)],notes='Posted with no end date over a year ago; confirm it is still accepting.' if stale else None)
# ---------- 5. Foundations ----------
latest={}
for f in glob.glob(os.path.join(B,'foundations_*.jsonl')):
    for line in open(f):
        d=json.loads(line); k=d['ein']
        if k not in latest or (d['taxPeriod'],d.get('returnTs') or '')>(latest[k]['taxPeriod'],latest[k].get('returnTs') or ''): latest[k]=d
n_all=len(latest); n_acc=0
for d in latest.values():
    if d['onlyPreselected'] or not d['application']: continue
    a=d['application']; dl=clean(a.get('submissionDeadlines'),200) or ''; rs=clean(a.get('restrictions'),600) or ''; fm=clean(a.get('formAndMaterials'),400) or ''
    if not (dl or rs or fm or a.get('contactName')): continue
    n_acc+=1; st=(d.get('address') or {}).get('StateAbbreviationCd'); ilshare=(d['grantsIL']/d['grantsCount']) if d['grantsCount'] else 0
    il_focus= st=='IL' or ilshare>=0.25 or d['grantsChicago']>=3
    other_geo=bool(re.search(r'\b(county|counties|state of|residents of|within the state|limited to|only in|only to)\b',rs,re.I)) and not re.search(r'illinois|chicago|cook county',rs,re.I)
    paid=money(d.get('totalGrantsPaid')) or d['grantsSum'] or money(d.get('contributionsPaid'))
    rel='high' if (il_focus and (d['grantsChicago']>=1 or st=='IL')) else ('medium' if (not other_geo and (paid or 0)>=25000) else 'low')
    if dl and ROLL.search(dl): wst,rec='rolling','rolling'
    elif dl and MONTHS.search(dl): wst,rec='scheduled','recurring_scheduled'
    elif dl: wst,rec='scheduled','recurring_unscheduled'
    else: wst,rec='rolling','rolling'
    purposes=[]; 
    for g in d.get('topGrants') or []:
        p=(g.get('purpose') or '').strip()
        if p and p.upper() not in ('N/A','NONE') and p not in purposes: purposes.append(p[:80])
    web=(d.get('website') or '').strip(); web=None if web.upper() in ('N/A','NA','NONE','') else web
    pp=f"https://projects.propublica.org/nonprofits/organizations/{d['ein']}"
    indiv=bool(re.search(r'individual|scholarship|student',rs+' '+fm+' '+' '.join(purposes),re.I))
    emit(id=f"foundation-{d['ein']}",source='irs_990pf',recordType='foundation',
         program={'name':d['name'].title(),'funder':d['name'].title(),'officialUrl':web or pp,'applyUrl':web or pp,'fundingSource':'philanthropic','level':'Foundation','ein':d['ein'],'foundationState':st,'assetsFMV':money(d.get('fmvAssetsEOY'))},
         window={'status':wst,'opensAt':None,'deadline':None,'deadlineTime':None,'recurs':rec,'nextExpected':None,'label':dl or 'No deadline stated in Part XV'},
         funding={'amountMin':None,'amountMax':None,'amountDisplay':(f"Paid ${paid:,} in grants (TY{d.get('taxYear') or d['taxPeriod'][:4]}, {d['grantsCount']} grants)" if paid else 'Grants paid not stated'),'type':'grant','requiredContribution':None,'paymentTiming':'unknown','costToApply':'free','grantsPaidTotal':paid,'grantsCount':d['grantsCount']},
         applicants={'businessTypes':['nonprofit','individual'] if indiv else ['nonprofit'],'industriesIncluded':[],'industriesExcluded':[],'operatingStage':None,'location':'Illinois-focused (from grantee list or address)' if il_focus else ('Restricted elsewhere (see restrictions)' if other_geo else 'Not stated; see restrictions and grantee states'),'landlordOrTenant':'not_applicable','demographicRestriction':None,'sizeLimits':None,'summary':rs or None,'geographicFocus':{'ilShareOfGrants':round(ilshare,2),'grantsIL':d['grantsIL'],'grantsChicago':d['grantsChicago'],'grantsByState':d['grantsByState'],'ilCities':d.get('grantsILCities')}},
         uses={'eligible':[],'exclusions':[rs] if rs and re.search(r'\bnot\b|\bno\b|only|exclud|limited',rs,re.I) else [],'summary':None,'observedPurposes':purposes},
         requirements={'applicationMaterials':fm or None,'taxStatus':'Grantees are generally 501(c)(3) public charities (990-PF)','contact':{'name':a.get('contactName'),'phone':a.get('phone'),'email':a.get('email'),'address':a.get('address')}},
         verification={'sourceUrl':pp,'evidence':f"IRS Form 990-PF Part XV, tax period {d['taxPeriod']}; 'only preselected' box not checked; batch {d['batch']}",'dateChecked':ISO,'checkedBy':'bulk:irs_990pf','legitimacy':'official'},
         chicagoRelevance=rel,tags=['foundation','accepts_applications']+(['illinois_focus'] if il_focus else [])+(['chicago_grantmaker'] if d['grantsChicago']>=1 else [])+(['geo_restricted_elsewhere'] if other_geo else []),extra={'topGrants':d.get('topGrants')})
# ---------- write ----------
ORDER={'open':0,'scheduled':1,'rolling':2,'standing':3}; REL={'high':0,'medium':1,'low':2}
rows.sort(key=lambda r:(REL[r['chicagoRelevance']],ORDER[r['window']['status']],r['window']['daysToDeadline'] if r['window']['daysToDeadline'] is not None else 9999,r['program']['name'] or ''))
with open(os.path.join(OUT,'grants-active.jsonl'),'w') as fh:
    for r in rows: fh.write(json.dumps(r,ensure_ascii=False)+'\n')
cols=['id','source','recordType','readiness','missing','chicagoRelevance','name','funder','fundingSource','level','status','opensAt','deadline','recurs','closingSoon','amountDisplay','fundingType','requiredContribution','paymentTiming','businessTypes','industriesExcluded','operatingStage','location','landlordOrTenant','usesEligible','exclusions','usesSummary','licenses','taxStatus','financialDocuments','permits','revenueLimit','employeeLimit','officialUrl','applyUrl','sourceUrl','dateChecked','checkedBy','staffOwner','nextReviewDate','legitimacy','tags']
with open(os.path.join(OUT,'grants-active.csv'),'w',newline='') as fh:
    w=csv.writer(fh); w.writerow(cols)
    for r in rows:
        P,W,F,A,U,Q,V=r['program'],r['window'],r['funding'],r['applicants'],r['uses'],r['requirements'],r['verification']
        w.writerow([r['id'],r['source'],r['recordType'],r['readiness']['status'],';'.join(r['readiness']['missing']),r['chicagoRelevance'],P.get('name'),P.get('funder'),P.get('fundingSource'),P.get('level'),W.get('status'),W.get('opensAt'),W.get('deadline'),W.get('recurs'),W.get('closingSoon'),F.get('amountDisplay'),F.get('type'),F.get('requiredContribution'),F.get('paymentTiming'),';'.join(A.get('businessTypes') or []),';'.join(A.get('industriesExcluded') or []),A.get('operatingStage'),A.get('location'),A.get('landlordOrTenant'),';'.join(U.get('eligible') or []),' | '.join(U.get('exclusions') or [])[:300],(U.get('summary') or '')[:300],Q.get('licenses'),(Q.get('taxStatus') or '')[:120],Q.get('financialDocuments'),Q.get('permits'),Q.get('revenueLimit'),Q.get('employeeLimit'),P.get('officialUrl'),P.get('applyUrl'),V.get('sourceUrl'),V.get('dateChecked'),V.get('checkedBy'),V.get('staffOwner'),V.get('nextReviewDate'),V.get('legitimacy'),';'.join(r['tags'])])
C=collections.Counter
counts={'total':len(rows),'ready':sum(1 for r in rows if r['readiness']['status']=='ready'),'needsResearch':sum(1 for r in rows if r['readiness']['status']!='ready'),
        'missingFieldFrequency':dict(C(m for r in rows for m in r['readiness']['missing'])),'bySource':dict(C(r['source'] for r in rows)),'byRecordType':dict(C(r['recordType'] for r in rows)),
        'byStatus':dict(C(r['window']['status'] for r in rows)),'byRecurrence':dict(C(r['window']['recurs'] for r in rows)),'byRelevance':dict(C(r['chicagoRelevance'] for r in rows)),'byFundingSource':dict(C(r['program']['fundingSource'] for r in rows)),
        'closingSoon':sum(1 for r in rows if r['window']['closingSoon']),'readyAndRelevant':sum(1 for r in rows if r['readiness']['status']=='ready' and r['chicagoRelevance']!='low'),
        'foundationsParsed':n_all,'foundationsAcceptingApplications':n_acc,'samListings':n_sam,'curated':len(cur['active'])}
json.dump({'schemaVersion':2,'asOfDate':ISO,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),'counts':counts,
  'schema':{'program':'name, funder, officialUrl, applyUrl, fundingSource (public|philanthropic|corporate|utility), level','window':'status (open|scheduled|rolling|standing), opensAt, deadline, recurs (one_time|recurring_scheduled|recurring_unscheduled|rolling|rolling_with_cutoff), nextExpected, closingSoon','funding':'amountMin/Max/Display, type (grant|reimbursement|rebate|in_kind|award_drawing|forgivable_loan|cooperative_agreement|other), requiredContribution, paymentTiming (upfront|reimbursement|unknown), costToApply','applicants':'businessTypes, industriesIncluded/Excluded, operatingStage, location, landlordOrTenant (owner|tenant|either|not_applicable|unknown), demographicRestriction, sizeLimits','uses':'eligible, exclusions, summary, observedPurposes (foundations)','requirements':'licenses, taxStatus, financialDocuments, permits, revenueLimit, employeeLimit, applicationMaterials, other','verification':'sourceUrl, evidence, dateChecked, checkedBy, staffOwner, nextReviewDate, legitimacy','readiness':"ready when businessTypes + location + funding type + a use/purpose + dated or rolling window + source are all present; otherwise needs_research with the missing list"},
  'sample':{s:[r for r in rows if r['source']==s][:2] for s in counts['bySource']}},open(os.path.join(OUT,'grants-active.meta.json'),'w'),indent=1)
L=[f"# Active grants database — {ISO}","",f"Total records: **{len(rows):,}** · ready **{counts['ready']:,}** · needs research **{counts['needsResearch']:,}** · ready and Chicago-relevant **{counts['readyAndRelevant']:,}**","","| Metric | Value |","|---|---|"]
for k,v in counts.items(): L.append(f"| {k} | {v if not isinstance(v,dict) else ', '.join(f'{a} {b:,}' for a,b in sorted(v.items(),key=lambda x:-x[1]))} |")
L+=["","## Closing within 21 days (high and medium relevance)","","| Deadline | Program | Funder | Amount | Ready? | Source |","|---|---|---|---|---|---|"]
for r in rows:
    if r['window']['closingSoon'] and r['chicagoRelevance']!='low': L.append(f"| {r['window']['deadline']} | {r['program']['name']} | {r['program']['funder']} | {r['funding']['amountDisplay']} | {r['readiness']['status']} | {r['source']} |")
L+=["","## Illinois-focused foundations accepting applications (top 25 by grants paid)","","| Foundation | Grants paid | Chicago grants | Deadline text | Restrictions |","|---|---|---|---|---|"]
for r in sorted([r for r in rows if r['source']=='irs_990pf' and 'illinois_focus' in r['tags']],key=lambda r:-(r['funding'].get('grantsPaidTotal') or 0))[:25]:
    L.append(f"| {r['program']['name']} | {r['funding']['amountDisplay']} | {r['applicants']['geographicFocus']['grantsChicago']} | {(r['window']['label'] or '')[:60]} | {(r['applicants'].get('summary') or '')[:90]} |")
open(os.path.join(OUT,'SUMMARY.md'),'w').write('\n'.join(L)+'\n')
print(json.dumps(counts,indent=1)); print('wrote',OUT)
