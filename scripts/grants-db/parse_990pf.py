import sys,os,zipfile,csv,re,json,collections
import xml.etree.ElementTree as ET
zp=sys.argv[1]; batch=os.path.basename(zp)[:-4]; year=batch[:4]
idx={}
for r in csv.DictReader(open(f'index_{year}.csv',encoding='latin-1')):
    if r['RETURN_TYPE']=='990PF': idx[r['OBJECT_ID']]=r
def L(t): return t.split('}')[-1]
def first(root,name):
    for e in root.iter():
        if L(e.tag)==name: return (e.text or '').strip()
    return None
def elems(root,name): return [e for e in root.iter() if L(e.tag)==name]
def child(e,name):
    for c in e.iter():
        if L(c.tag)==name: return (c.text or '').strip()
    return None
out=open(f'foundations_{batch}.jsonl','w'); n=0; err=0; errlog=[]
z=zipfile.ZipFile(zp)
import subprocess,tempfile,shutil
extract_dir=None
def read_member(name):
    global extract_dir
    if extract_dir is None:
        try: return z.read(name)
        except NotImplementedError:
            extract_dir=tempfile.mkdtemp(prefix='irs990_',dir='.')
            subprocess.run(['unzip','-o','-q',zp,'-d',extract_dir],check=False)
    return open(os.path.join(extract_dir,name),'rb').read()
for name in z.namelist():
    m=re.search(r'(\d{18})',name)
    if not m or m.group(1) not in idx: continue
    oid=m.group(1); r=idx[oid]
    try:
        root=ET.fromstring(read_member(name))
    except Exception as e:
        err+=1
        if len(errlog)<3: errlog.append(f'{name}: {type(e).__name__}: {str(e)[:100]}')
        continue
    filer=next((e for e in root.iter() if L(e.tag)=='Filer'),None)
    addr={}
    if filer is not None:
        ua=next((e for e in filer.iter() if L(e.tag) in ('USAddress','ForeignAddress')),None)
        if ua is not None: addr={L(c.tag):(c.text or '').strip() for c in ua}
    pre=first(root,'OnlyContriToPreselectedInd')
    app=next((e for e in root.iter() if L(e.tag)=='ApplicationSubmissionInfoGrp'),None)
    appinfo=None
    if app is not None:
        ra=next((e for e in app.iter() if L(e.tag) in ('RecipientUSAddress','RecipientForeignAddress')),None)
        appinfo={'contactName':child(app,'RecipientPersonNm') or child(app,'BusinessNameLine1Txt'),'address':({L(c.tag):(c.text or '').strip() for c in ra} if ra is not None else None),'phone':child(app,'RecipientPhoneNum'),'email':child(app,'RecipientEmailAddressTxt'),'formAndMaterials':child(app,'FormAndInfoAndMaterialsTxt'),'submissionDeadlines':child(app,'SubmissionDeadlinesTxt'),'restrictions':child(app,'RestrictionsOnAwardsTxt')}
    grants=elems(root,'GrantOrContributionPdDurYrGrp')
    states=collections.Counter(); cities=collections.Counter(); total=0; top=[]
    for g in grants:
        amt=child(g,'Amt'); 
        try: a=int(float(amt)) if amt else 0
        except: a=0
        st=child(g,'StateAbbreviationCd') or child(g,'CountryCd') or '??'; ct=(child(g,'CityNm') or '').upper()
        states[st]+=1; total+=a
        if st=='IL': cities[ct]+=1
        top.append((a,child(g,'BusinessNameLine1Txt') or child(g,'RecipientPersonNm'),ct,st,(child(g,'GrantOrContributionPurposeTxt') or '')[:140]))
    top.sort(key=lambda x:-x[0])
    row={'objectId':oid,'ein':r['EIN'],'name':r['TAXPAYER_NAME'],'taxPeriod':r['TAX_PERIOD'],'taxYear':first(root,'TaxYr'),'returnTs':first(root,'ReturnTs'),'batch':batch,
         'address':addr,'website':first(root,'WebsiteAddressTxt'),
         'onlyPreselected':(pre or '').upper() in ('X','TRUE','1'),
         'application':appinfo,
         'fmvAssetsEOY':first(root,'FMVAssetsEOYAmt'),'contributionsPaid':first(root,'ContriPaidRevAndExpnssAmt'),'totalGrantsPaid':first(root,'TotalGrantOrContriPdDurYrAmt'),'totalApprovedFuture':first(root,'TotalGrantOrContriApprvFutAmt'),
         'grantsCount':len(grants),'grantsSum':total,'grantsByState':dict(states.most_common(8)),'grantsILCities':dict(cities.most_common(6)),'grantsIL':states.get('IL',0),'grantsChicago':cities.get('CHICAGO',0),
         'topGrants':[{'amount':a,'recipient':nm,'city':c,'state':s,'purpose':p} for a,nm,c,s,p in top[:5]]}
    out.write(json.dumps(row)+'\n'); n+=1
out.close(); open(f'foundations_{batch}.done','w').write(str(n))
if extract_dir: shutil.rmtree(extract_dir,ignore_errors=True)
print(batch,'parsed',n,'errors',err,('| '+' ; '.join(errlog)) if errlog else '')
