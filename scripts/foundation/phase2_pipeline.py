#!/usr/bin/env python3
"""Foundation-universe Phase 2: parse the 95 funders that take capacity coverage
from 58.2% to the 80% bar (Sol plan §Tier-2, consult 2026-07-30).

Per-funder pipeline, checkpointed one JSON per EIN so a dead run loses one
funder, not the batch:

  resolve   ProPublica org page -> e-file object_ids (18-digit), prefix-filtered
            to processing years 2022+ so we only fetch filings that can carry
            tax years 2021-2024
  fetch     gt990datalake S3 XML, refused outright if the bytes contain a
            DOCTYPE/ENTITY declaration (XXE), sha256 recorded
  parse     990-PF Part XV grant rows + Part I controls; 990 Schedule I rows +
            Part IX line 1/2 controls; officers/trustees for the side ledger
  reconcile row sum must tie the filing's own printed total within $1, or the
            filing gets an explicit non-reconciled status -- never a silent pass
  filter    Chicago recipients only (state IL, city CHICAGO)
  geocode   Census one-line geocoder behind the shared committed cache,
            in-bounds check (lat 41.6-42.1, lng -87.95..-87.5)
  classify  locType by precedent (majority label of the same recipient name in
            the 12,817 shipped rows), else regrant-keyword+downtown-ZIP or
            mega-institution rule; ambiguity falls to intermediary_or_citywide
            because a wrong citywide is vague while a wrong point is FALSE

Honesty rails carried over verbatim from Tier-1: amounts are never invented,
placeholder-family rows ("SEE ATTACHED/STATEMENT/...") are quarantined and
counted rather than guessed, and aggregate-only filers are dispositioned as
funder-exchange targets, not zeroes.
"""

import csv
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict

try:  # defusedxml when the machine has it; the DTD/ENTITY refusal below stands regardless
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INPUTS = os.path.join(REPO, "data", "curated", "investment-inputs")
TARGETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "phase2_targets.json")
STATE_DIR = os.environ.get(
    "PHASE2_STATE",
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/phase2",
)
XML_DIR = os.path.join(STATE_DIR, "xml")
FUNDER_DIR = os.path.join(STATE_DIR, "funders")
os.makedirs(XML_DIR, exist_ok=True)
os.makedirs(FUNDER_DIR, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) chicago-incentive-explorer data pipeline (billyjoseph243@gmail.com)"}
NS = {"e": "http://www.irs.gov/efile"}
S3 = "https://gt990datalake-rawdata.s3.amazonaws.com/EfileData/XmlFiles/{oid}_public.xml"
PP = "https://projects.propublica.org/nonprofits/organizations/{ein}"
CENSUS_GEO = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    "?address={addr}&benchmark=Public_AR_Current&format=json"
)
EXTRACTION_VERSION = "phase2-2026-08-03.1"
TAX_YEARS = {"2021", "2022", "2023", "2024"}
# object_id prefix = IRS processing year; tax years 2021-2024 process 2022 onward
OID_PREFIXES = ("2022", "2023", "2024", "2025", "2026")

# mirrors the two placeholder regexes in scripts/export-community-investment.ts:
# the "see attached" family tests recipient AND address; "available upon request"
# tests recipient ONLY (in the address field it marks a real grantee whose street
# address is withheld -- an honest citywide row, not a placeholder)
PLACEHOLDER_RE = re.compile(r"\bsee\s+(attach\w*|statement|schedule|exhibit|list|below|note)\b", re.I)
UNITEMIZED_RECIPIENT_RE = re.compile(r"\bavailable\s+upon\s+request\b", re.I)
REGRANT_KW = re.compile(r"\b(FOUNDATION|FUND|FUNDS|TRUST|FEDERATION|UNITED WAY|ENDOWMENT|DONOR|PHILANTHROP)\b", re.I)
MEGA_KW = re.compile(r"\b(UNIVERSITY|COLLEGE|MUSEUM|HOSPITAL|MEDICAL CENTER|HEALTH SYSTEM|SEMINARY|INSTITUTE OF TECHNOLOGY)\b", re.I)
DOWNTOWN_ZIPS = {"60601", "60602", "60603", "60604", "60605", "60606", "60654", "60661", "60611"}
BOUNDS = {"lat": (41.6, 42.1), "lng": (-87.95, -87.5)}

EXPANSION_HEADER = [
    "foundation", "tax_year", "recipient", "address_line1", "city", "state",
    "zip", "amount", "purpose", "source_form", "lat", "lng", "locType",
]
QUARANTINE_HEADER = EXPANSION_HEADER + ["exclusion_reason", "object_id", "reconciliation_status"]
RECON_HEADER = [
    "ein", "funder", "object_id", "tax_yr", "return_type", "schema_version",
    "tax_period_begin", "tax_period_end", "amended", "grant_rows", "parsed_sum",
    "line3a", "line25a", "line25d", "delta", "status", "bridge_note",
    "chicago_rows", "chicago_dollars", "source_url", "sha256", "extraction_version",
]
OFFICER_HEADER = ["ein", "funder", "tax_yr", "person", "title", "avg_hours_per_week", "compensation"]


def fetch(url, retries=3, sleep=1.0):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - recorded, retried, then surfaced
            last = exc
            time.sleep(sleep * (i + 1))
    raise RuntimeError(f"fetch failed after {retries}: {url}: {last}")


def text(el, path):
    node = el.find(path, NS)
    return (node.text or "").strip() if node is not None and node.text else ""


def num(el, path):
    t = text(el, path)
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def resolve_object_ids(ein):
    """Scrape the ProPublica org page for e-file XML object ids."""
    html = fetch(PP.format(ein=int(ein))).decode("utf-8", "replace")
    oids = sorted(set(re.findall(r"object_id=(\d{18})", html)), reverse=True)
    return [o for o in oids if o[:4] in OID_PREFIXES]


def fetch_xml(oid):
    path = os.path.join(XML_DIR, f"{oid}.xml")
    if os.path.exists(path):
        raw = open(path, "rb").read()
    else:
        raw = fetch(S3.format(oid=oid))
        open(path, "wb").write(raw)
    # whole-document scan: with no DTD there are no entity expansions to abuse,
    # so this refusal alone closes XXE/billion-laughs even on stdlib ElementTree
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        raise RuntimeError(f"XML {oid} carries a DTD/ENTITY declaration -- refused (XXE guard)")
    return raw


def parse_return(raw, oid):
    root = ET.fromstring(raw)
    version = root.get("returnVersion", "")
    header = root.find("e:ReturnHeader", NS)
    data = root.find("e:ReturnData", NS)
    if header is None or data is None:
        return None
    out = {
        "object_id": oid,
        "schema_version": version,
        "return_type": text(header, "e:ReturnTypeCd"),
        "tax_yr": text(header, "e:TaxYr"),
        "tax_period_begin": text(header, "e:TaxPeriodBeginDt"),
        "tax_period_end": text(header, "e:TaxPeriodEndDt"),
        "filer_name": text(header, "e:Filer/e:BusinessName/e:BusinessNameLine1Txt"),
        "filer_ein": text(header, "e:Filer/e:EIN"),
        "amended": "Y" if header.find("e:AmendedReturnInd", NS) is not None else "N",
        "sha256": hashlib.sha256(raw).hexdigest()[:16],
        "grants": [],
        "officers": [],
        "controls": {},
    }
    pf = data.find("e:IRS990PF", NS)
    f990 = data.find("e:IRS990", NS)
    if pf is not None:
        supp = pf.find("e:SupplementaryInformationGrp", NS)
        if supp is not None:
            for g in supp.findall("e:GrantOrContributionPdDurYrGrp", NS):
                name = text(g, "e:RecipientBusinessName/e:BusinessNameLine1Txt") or text(g, "e:RecipientPersonNm")
                line2 = text(g, "e:RecipientBusinessName/e:BusinessNameLine2Txt")
                if line2:
                    name = f"{name} {line2}".strip()
                out["grants"].append({
                    "recipient": name,
                    "address_line1": text(g, "e:RecipientUSAddress/e:AddressLine1Txt"),
                    "address_line2": text(g, "e:RecipientUSAddress/e:AddressLine2Txt"),
                    "city": text(g, "e:RecipientUSAddress/e:CityNm"),
                    "state": text(g, "e:RecipientUSAddress/e:StateAbbreviationCd"),
                    "zip": text(g, "e:RecipientUSAddress/e:ZIPCd"),
                    "amount": num(g, "e:Amt"),
                    "purpose": text(g, "e:GrantOrContributionPurposeTxt"),
                    "foreign": g.find("e:RecipientForeignAddress", NS) is not None,
                })
            out["controls"]["line3a"] = num(supp, "e:TotalGrantOrContriPdDurYrAmt")
        rev = pf.find("e:AnalysisOfRevenueAndExpenses", NS)
        if rev is not None:
            out["controls"]["line25a"] = num(rev, "e:ContriPaidRvnAndExpnssAmt")
            out["controls"]["line25d"] = num(rev, "e:ContriPaidDsbrsChrtblAmt")
        og = pf.find("e:OfficerDirTrstKeyEmplInfoGrp", NS)
        if og is not None:
            for o in og.findall("e:OfficerDirTrstKeyEmplGrp", NS):
                person = text(o, "e:PersonNm") or text(o, "e:BusinessName/e:BusinessNameLine1Txt")
                if person:
                    out["officers"].append({
                        "person": person,
                        "title": text(o, "e:TitleTxt"),
                        "avg_hours_per_week": text(o, "e:AvgHrsPerWkDevotedToPositRt"),
                        "compensation": num(o, "e:CompensationAmt"),
                    })
    elif f990 is not None:
        schedi = data.find("e:IRS990ScheduleI", NS)
        if schedi is not None:
            for g in schedi.findall("e:RecipientTable", NS):
                out["grants"].append({
                    "recipient": text(g, "e:RecipientBusinessName/e:BusinessNameLine1Txt"),
                    "address_line1": text(g, "e:USAddress/e:AddressLine1Txt"),
                    "address_line2": text(g, "e:USAddress/e:AddressLine2Txt"),
                    "city": text(g, "e:USAddress/e:CityNm"),
                    "state": text(g, "e:USAddress/e:StateAbbreviationCd"),
                    "zip": text(g, "e:USAddress/e:ZIPCd"),
                    "amount": num(g, "e:CashGrantAmt"),
                    "purpose": text(g, "e:PurposeOfGrantTxt"),
                    "foreign": False,
                })
        out["controls"]["line1_domestic_orgs"] = num(f990, "e:GrantsToDomesticOrgsGrp/e:TotalAmt")
        out["controls"]["line2_domestic_indiv"] = num(f990, "e:GrantsToDomesticIndividualsGrp/e:TotalAmt")
        for o in f990.findall("e:Form990PartVIISectionAGrp", NS):
            person = text(o, "e:PersonNm")
            if person:
                out["officers"].append({
                    "person": person,
                    "title": text(o, "e:TitleTxt"),
                    "avg_hours_per_week": text(o, "e:AverageHoursPerWeekRt"),
                    "compensation": num(o, "e:ReportableCompFromOrgAmt"),
                })
    else:
        return None
    return out


def is_placeholder(g):
    return bool(
        PLACEHOLDER_RE.search(g["recipient"] or "")
        or PLACEHOLDER_RE.search(g["address_line1"] or "")
        or UNITEMIZED_RECIPIENT_RE.search(g["recipient"] or "")
        or re.fullmatch(r"9{5}", (g["zip"] or "")[:5] or "")
        or re.fullmatch(r"9{5}", g["address_line1"] or "")
    )


SMALL_WORDS = {"of", "and", "the", "for", "in", "at", "on"}
KEEP_UPPER = {"INC", "LLC", "TR", "UW", "II", "III", "IV", "IMC", "MB", "USA", "UIC", "AJ", "JP"}


def display_name(bmf_name):
    words = bmf_name.strip().split()
    out = []
    for i, w in enumerate(words):
        if w.upper() in KEEP_UPPER:
            out.append(w.upper())
        elif w.lower() in SMALL_WORDS and i > 0:
            out.append(w.lower())
        elif "&" in w or "-" in w:
            out.append(w.title())
        else:
            out.append(w.capitalize())
    return " ".join(out)


class Geocoder:
    """Census geocoder behind the shared committed cache (case-insensitive).

    GEOCODE_CACHE points writes at a shard-private file so parallel shards never
    race on one JSON; every shard still READS the committed cache, and the
    shard files merge back into it at integration time."""

    def __init__(self):
        shared = os.path.join(INPUTS, "geocode-cache.json")
        self.path = os.environ.get("GEOCODE_CACHE", shared)
        self.cache = json.load(open(self.path)) if os.path.exists(self.path) else {}
        self.index = {}
        if self.path != shared and os.path.exists(shared):
            for k, v in json.load(open(shared)).items():
                self.index[k.lower()] = v
        self.index.update({k.lower(): v for k, v in self.cache.items()})
        self.new = 0

    def geocode(self, addr1):
        key = f"{addr1}, Chicago, IL"
        hit = self.index.get(key.lower())
        if hit is not None:
            return hit if hit else None
        from urllib.parse import quote
        try:
            raw = fetch(CENSUS_GEO.format(addr=quote(key)), retries=2)
            matches = json.loads(raw)["result"]["addressMatches"]
        except Exception:
            matches = []
        entry = {}
        if matches:
            c = matches[0]["coordinates"]
            entry = {"lat": c["y"], "lng": c["x"]}
        self.cache[key] = entry
        self.index[key.lower()] = entry
        self.new += 1
        if self.new % 25 == 0:
            self.save()
        time.sleep(0.35)
        return entry or None

    def save(self):
        tmp = f"{self.path}.tmp.{os.getpid()}"
        json.dump(self.cache, open(tmp, "w"), indent=0, sort_keys=True)
        os.replace(tmp, self.path)


def in_bounds(pt):
    return (
        pt
        and BOUNDS["lat"][0] <= pt["lat"] <= BOUNDS["lat"][1]
        and BOUNDS["lng"][0] <= pt["lng"] <= BOUNDS["lng"][1]
    )


def build_precedent():
    """recipient-name -> majority locType from the two shipped foundation files.
    Ties break to intermediary_or_citywide: vague beats false."""
    votes = defaultdict(Counter)
    for fname in ("foundation_grants_geocoded.csv", "foundation_grants_tier1_expansion.csv"):
        for r in csv.DictReader(open(os.path.join(INPUTS, fname))):
            votes[r["recipient"].strip().lower()][r["locType"]] += 1
    out = {}
    for name, c in votes.items():
        sited, inter = c.get("sited", 0), c.get("intermediary_or_citywide", 0)
        out[name] = "sited" if sited > inter else "intermediary_or_citywide"
    return out


def classify(recipient, zip5, precedent):
    key = recipient.strip().lower()
    if key in precedent:
        return precedent[key]
    if MEGA_KW.search(recipient):
        return "intermediary_or_citywide"
    if REGRANT_KW.search(recipient) and zip5 in DOWNTOWN_ZIPS:
        return "intermediary_or_citywide"
    return "sited"


def reconcile(ret, published_sum, placeholder_sum):
    """One status per filing; every non-tie is loud."""
    parsed = published_sum + placeholder_sum
    rows = len(ret["grants"])
    c = ret["controls"]
    if ret["return_type"] == "990PF":
        ref, ref_label = c.get("line3a"), "line-3a"
        if ref is None:
            ref, ref_label = c.get("line25a"), "line-25(a) fallback"
        if ref is None:
            return ("no_control_total", None, "filing publishes no Part XV or Part I grants total")
        delta = parsed - ref
        if abs(delta) <= 1.0:
            if rows > 0 and published_sum == 0 and placeholder_sum > 0:
                return ("known_attachment_gap", delta, "grant schedule is a single attachment aggregate; itemization not public")
            return ("reconciled", delta, f"row sum ties printed {ref_label} total within $1")
        return ("failed", delta, f"row sum ${parsed:,.0f} vs printed {ref_label} total ${ref:,.0f}")
    # 990: Schedule I lists only recipients over $5k, so parsed <= line 1+2 is legitimate
    ref = (c.get("line1_domestic_orgs") or 0) + (c.get("line2_domestic_indiv") or 0)
    if ref == 0 and rows == 0:
        return ("no_grants", 0.0, "990 filer reports no grants this period")
    delta = parsed - ref
    if abs(delta) <= 1.0:
        return ("reconciled", delta, "Schedule I sum ties Part IX lines 1+2 within $1")
    if delta < 0:
        return ("sub5k_bridge", delta, f"Schedule I itemizes ${parsed:,.0f} of ${ref:,.0f} Part IX grants; remainder is sub-$5k grants the form does not itemize -- only itemized rows publish")
    return ("failed", delta, f"Schedule I sum ${parsed:,.0f} EXCEEDS Part IX total ${ref:,.0f}")


def process_funder(target, geocoder, precedent):
    ein = target["ein"]
    ckpt = os.path.join(FUNDER_DIR, f"{ein}.json")
    if os.path.exists(ckpt):
        return json.load(open(ckpt))
    name = display_name(target["name"])
    result = {
        "ein": ein, "name": name, "bmf_name": target["name"], "capacity": target["capacity"],
        "disposition": None, "filings": [], "rows": [], "quarantined": [], "officers": [],
        "notes": [],
    }
    try:
        oids = resolve_object_ids(ein)
    except Exception as exc:  # noqa: BLE001
        result["disposition"] = "resolve_failed"
        result["notes"].append(str(exc)[:300])
        json.dump(result, open(ckpt, "w"), indent=1)
        return result
    time.sleep(0.6)
    returns = []
    for oid in oids:
        try:
            ret = parse_return(fetch_xml(oid), oid)
        except Exception as exc:  # noqa: BLE001
            result["notes"].append(f"{oid}: {str(exc)[:200]}")
            continue
        if ret and ret["return_type"] in ("990PF", "990") and ret["tax_yr"] in TAX_YEARS:
            returns.append(ret)
    # amended/duplicate handling: one return per (type, period end); amended wins,
    # then the highest object id (latest processing)
    best = {}
    for ret in sorted(returns, key=lambda r: (r["amended"] == "Y", r["object_id"])):
        best[(ret["return_type"], ret["tax_period_end"])] = ret
    if not best:
        result["disposition"] = "no_efile_in_window"
        json.dump(result, open(ckpt, "w"), indent=1)
        return result
    statuses = []
    for ret in sorted(best.values(), key=lambda r: r["tax_period_end"]):
        pub_sum = plc_sum = 0.0
        chicago_rows = []
        quarantined = []
        for g in ret["grants"]:
            amt = g["amount"]
            if is_placeholder(g):
                plc_sum += amt or 0.0
                quarantined.append(g)
                continue
            if amt is not None:
                pub_sum += amt
            if (
                amt is not None
                and not g["foreign"]
                and (g["state"] or "").upper() == "IL"
                and (g["city"] or "").strip().upper() == "CHICAGO"
            ):
                chicago_rows.append(g)
        status, delta, note = reconcile(ret, pub_sum, plc_sum)
        statuses.append(status)
        rec = {
            "ein": ein, "funder": name, "object_id": ret["object_id"], "tax_yr": ret["tax_yr"],
            "return_type": ret["return_type"], "schema_version": ret["schema_version"],
            "tax_period_begin": ret["tax_period_begin"], "tax_period_end": ret["tax_period_end"],
            "amended": ret["amended"], "grant_rows": len(ret["grants"]),
            "parsed_sum": round(pub_sum + plc_sum, 2),
            "line3a": ret["controls"].get("line3a", ret["controls"].get("line1_domestic_orgs")),
            "line25a": ret["controls"].get("line25a", ret["controls"].get("line2_domestic_indiv")),
            "line25d": ret["controls"].get("line25d"),
            "delta": round(delta, 2) if delta is not None else None,
            "status": status, "bridge_note": note,
            "chicago_rows": 0, "chicago_dollars": 0.0,
            "source_url": S3.format(oid=ret["object_id"]), "sha256": ret["sha256"],
            "extraction_version": EXTRACTION_VERSION,
        }
        publishable = status in ("reconciled", "sub5k_bridge")
        if publishable:
            for g in chicago_rows:
                zip5 = (g["zip"] or "")[:5]
                loc = classify(g["recipient"], zip5, precedent)
                addr = g["address_line1"]
                pt = geocoder.geocode(addr) if addr else None
                lat, lng = ("", "")
                if in_bounds(pt):
                    lat, lng = pt["lat"], pt["lng"]
                elif loc == "sited":
                    loc = "intermediary_or_citywide"  # no in-bounds point: never fake one
                result["rows"].append({
                    "foundation": name, "tax_year": ret["tax_yr"], "recipient": g["recipient"],
                    "address_line1": addr, "city": "CHICAGO", "state": "IL", "zip": g["zip"],
                    "amount": int(g["amount"]) if g["amount"] == int(g["amount"]) else g["amount"],
                    "purpose": g["purpose"], "source_form": "990-PF" if ret["return_type"] == "990PF" else "990",
                    "lat": lat, "lng": lng, "locType": loc,
                })
                rec["chicago_rows"] += 1
                rec["chicago_dollars"] += g["amount"]
        quarantine_src = quarantined if publishable else quarantined + chicago_rows
        for g in quarantine_src:
            # placeholder rows are always the attachment-aggregate shape; anything
            # else lands here only because its whole filing failed to reconcile
            reason = (
                "aggregate_only_no_itemization" if g in quarantined
                else f"filing_not_publishable_{status}"
            )
            result["quarantined"].append({
                "foundation": name, "tax_year": ret["tax_yr"], "recipient": g["recipient"],
                "address_line1": g["address_line1"], "city": (g["city"] or "").upper(),
                "state": g["state"], "zip": g["zip"],
                "amount": g["amount"] if g["amount"] is not None else "",
                "purpose": g["purpose"], "source_form": "990-PF" if ret["return_type"] == "990PF" else "990",
                "lat": "", "lng": "", "locType": "intermediary_or_citywide",
                "exclusion_reason": reason,
                "object_id": ret["object_id"], "reconciliation_status": status,
            })
        rec["chicago_dollars"] = round(rec["chicago_dollars"], 2)
        result["filings"].append(rec)
        for o in ret["officers"]:
            result["officers"].append({"ein": ein, "funder": name, "tax_yr": ret["tax_yr"], **o})
    # funder-level disposition from filing statuses
    if any(s in ("reconciled", "sub5k_bridge") for s in statuses):
        result["disposition"] = "parsed" if any(f["chicago_rows"] for f in result["filings"]) else "parsed_no_chicago_rows"
    elif all(s == "known_attachment_gap" for s in statuses):
        result["disposition"] = "aggregate_only"
    elif all(s == "no_grants" for s in statuses):
        result["disposition"] = "no_grants_in_window"
    else:
        result["disposition"] = "needs_review"
    json.dump(result, open(ckpt, "w"), indent=1)
    return result


def main():
    targets = json.load(open(TARGETS))
    only = set(sys.argv[1:])
    if only:
        targets = [t for t in targets if t["ein"] in only]
    geocoder = Geocoder()
    precedent = build_precedent()
    print(f"phase2: {len(targets)} funders, precedent map {len(precedent)} names", flush=True)
    summary = Counter()
    for i, t in enumerate(targets, 1):
        try:
            res = process_funder(t, geocoder, precedent)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(targets)}] {t['ein']} {t['name'][:40]} CRASHED: {exc}", flush=True)
            summary["crashed"] += 1
            continue
        summary[res["disposition"]] += 1
        rows = len(res["rows"])
        dollars = sum(r["amount"] for r in res["rows"] if isinstance(r["amount"], (int, float)))
        print(
            f"[{i}/{len(targets)}] {res['ein']} {res['name'][:44]:44} "
            f"{res['disposition']:24} filings={len(res['filings'])} chi_rows={rows} ${dollars:,.0f}",
            flush=True,
        )
    geocoder.save()
    print("\nDISPOSITIONS:", dict(summary), flush=True)


if __name__ == "__main__":
    main()
