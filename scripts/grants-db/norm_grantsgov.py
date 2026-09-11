import json,datetime,collections,html,re
today=datetime.date(2026,9,11)
ELIG={'00':'State governments','01':'County governments','02':'City or township governments','04':'Special district governments','05':'Independent school districts','06':'Public/state institutions of higher education','07':'Native American tribal governments (federally recognized)','08':'Public housing authorities','11':'Native American tribal organizations','12':'Nonprofits with 501(c)(3) status','13':'Nonprofits without 501(c)(3) status','20':'Private institutions of higher education','21':'Individuals','22':'For-profit organizations other than small businesses','23':'Small businesses','25':'Others','99':'Unrestricted'}
INSTR={'G':'grant','CA':'cooperative_agreement','O':'other','PC':'procurement_contract'}
def pd(s):
    try: return datetime.datetime.strptime(s,'%m%d%Y').date()
    except: return None
def iso(d): return d.isoformat() if d else None
def money(s):
    try: return int(float(s)) if s not in (None,'','none') else None
    except: return None
out=open('grantsgov_active.jsonl','w'); c=collections.Counter()
for line in open('grantsgov.jsonl'):
    d=json.loads(line); fc=d['_kind']=='forecast'
    close=pd(d.get('CloseDate','')) if not fc else pd(d.get('EstimatedSynopsisCloseDate',''))
    opens=pd(d.get('PostDate','')) if not fc else pd(d.get('EstimatedSynopsisPostDate',''))
    arch=pd(d.get('ArchiveDate','')); upd=pd(d.get('LastUpdatedDate',''))
    if fc:
        active = (close and close>=today) or (opens and opens>=today) or (arch and arch>=today)
        if active and upd and (today-upd).days>540: active=False
        status='scheduled'
    else:
        active = (close and close>=today) or (not close and arch and arch>=today)
        status='open' if close else 'rolling'
    if not active: c['skipped']+=1; continue
    codes=[x.strip() for x in (d.get('EligibleApplicants') or '').split(',') if x.strip()]
    ent=[]; 
    if any(x in codes for x in ('23',)): ent.append('small_business')
    if any(x in codes for x in ('22',)): ent.append('for_profit')
    if any(x in codes for x in ('12','13')): ent.append('nonprofit')
    if '21' in codes: ent.append('individual')
    if '99' in codes: ent=['unrestricted']
    if any(x in codes for x in ('00','01','02','04','05','06','07','08','11','20')): ent.append('government_or_institution')
    desc=html.unescape(re.sub(r'<[^>]+>',' ',d.get('Description','') or '')); desc=re.sub(r'\s+',' ',desc).strip()
    row={'id':f"grantsgov-{d['OpportunityID']}",'source':'grants.gov','recordType':'opportunity','name':d.get('OpportunityTitle'),'opportunityNumber':d.get('OpportunityNumber'),'sponsor':d.get('AgencyName'),'agencyCode':d.get('AgencyCode'),'level':'Federal','instrument':INSTR.get(d.get('FundingInstrumentType'),'grant'),'status':status,'cadence':'one_time' if not fc else 'recurring_unscheduled','window':{'opensAt':iso(opens),'closesAt':iso(close),'label':'forecast (estimated dates)' if fc else 'posted'},'amount':{'min':money(d.get('AwardFloor')),'max':money(d.get('AwardCeiling')),'display':(f"Up to ${money(d.get('AwardCeiling')):,}" if money(d.get('AwardCeiling')) else 'Not stated'),'totalProgramFunding':money(d.get('EstimatedTotalProgramFunding')),'expectedAwards':money(d.get('ExpectedNumberOfAwards'))},'eligibility':{'summary':html.unescape(re.sub(r'<[^>]+>',' ',d.get('AdditionalInformationOnEligibility','') or ''))[:600].strip() or '; '.join(ELIG.get(x,x) for x in codes),'entityTypes':sorted(set(ent)),'applicantTypeCodes':codes,'applicantTypes':[ELIG.get(x,x) for x in codes],'geography':'US (national)','costSharing':d.get('CostSharingOrMatchingRequirement')},'category':d.get('CategoryOfFundingActivity'),'cfda':[x.strip() for x in (d.get('CFDANumbers') or '').split(',') if x.strip()],'description':desc[:1200],'legitimacy':'official','costToApply':'free','applyUrl':f"https://www.grants.gov/search-results-detail/{d['OpportunityID']}",'sourceUrl':f"https://www.grants.gov/search-results-detail/{d['OpportunityID']}",'contact':d.get('GrantorContactEmail'),'verifiedAt':today.isoformat(),'evidence':f"grants.gov XML extract 2026-09-11; {'forecast' if fc else 'synopsis'} last updated {iso(upd)}",'isNew':bool(opens and (today-opens).days<=60) if not fc else False,'newBecause':'posted within 60 days' if (opens and (today-opens).days<=60 and not fc) else None,'lastUpdated':iso(upd)}
    out.write(json.dumps(row)+'\n'); c[status]+=1
    for e in row['eligibility']['entityTypes']: c['ent:'+e]+=1
print(dict(c))
