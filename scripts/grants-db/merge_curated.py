#!/usr/bin/env python3
"""Merge tier JSON files into the active grants database. Validates, dedupes, matches catalog, flags."""
import json, re, csv, sys, glob, os, datetime, collections

S = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
AS_OF = datetime.date(2026, 9, 11)
CLOSING_SOON_DAYS = 21

LEVELS = {"City","County","State","Federal","Utility","Private","Foundation","Nonprofit"}
INSTRUMENTS = {"grant","rebate","reimbursement","in_kind","award_drawing","forgivable_loan"}
STATUSES = {"open","rolling","scheduled"}
CADENCES = {"one_time","recurring_scheduled","recurring_unscheduled","rolling","rolling_with_cutoff"}
LEGIT = {"official","pay_to_apply","lead_gen","sweepstakes","unverified"}
REQUIRED = ["id","name","sponsor","level","instrument","status","cadence","amount","eligibility","legitimacy","sourceUrl","evidence","verifiedAt"]

def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

def pdate(s):
    if not s or not isinstance(s, str): return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if not m: return None
    try: return datetime.date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError: return None

catalog = json.load(open(os.path.join(WT, "data", "programs-internal.json")))
cat_by_id = {p["id"]: p for p in catalog}
cat_by_norm = {norm(p["name"]): p["id"] for p in catalog}

files = sorted(f for f in glob.glob(os.path.join(S, "*.json")) if not f.endswith("grants-active.json"))
active, not_active, unconfirmed, disagreements, errors = [], [], [], [], []
tiers_seen = []
for f in files:
    try:
        d = json.load(open(f))
    except Exception as e:
        errors.append({"file": os.path.basename(f), "error": f"JSON parse failed: {e}"}); continue
    tier = d.get("tier") or os.path.basename(f).replace(".json","")
    tiers_seen.append(tier)
    for r in d.get("active", []):
        r["_tier"] = tier
        active.append(r)
    for r in d.get("checkedNotActive", []):
        r["tier"] = tier; not_active.append(r)
    for r in d.get("unconfirmed", []):
        r["tier"] = tier; unconfirmed.append(r)
    for r in d.get("catalogDisagreements", []):
        r["tier"] = tier; disagreements.append(r)

# ---- validate + normalize ----
valid = []
for r in active:
    errs = []
    for k in REQUIRED:
        if k not in r or r[k] in (None, "", [], {}): errs.append(f"missing {k}")
    if r.get("level") not in LEVELS: errs.append(f"level={r.get('level')}")
    if r.get("instrument") not in INSTRUMENTS: errs.append(f"instrument={r.get('instrument')}")
    if r.get("status") not in STATUSES: errs.append(f"status={r.get('status')}")
    if r.get("cadence") not in CADENCES: errs.append(f"cadence={r.get('cadence')}")
    if r.get("legitimacy") not in LEGIT: errs.append(f"legitimacy={r.get('legitimacy')}")
    if not str(r.get("sourceUrl","")).startswith("http"): errs.append("sourceUrl not http")
    vd = pdate(r.get("verifiedAt"))
    if not vd or (AS_OF - vd).days > 1: errs.append(f"verifiedAt={r.get('verifiedAt')}")
    if not isinstance(r.get("amount"), dict) or not r["amount"].get("display"): errs.append("amount.display missing")
    if not isinstance(r.get("eligibility"), dict) or not r["eligibility"].get("summary"): errs.append("eligibility.summary missing")
    w = r.get("window") or {}
    closes = pdate(w.get("closesAt")); opens = pdate(w.get("opensAt"))
    if r.get("status") == "open" and not closes and r.get("cadence") != "rolling_with_cutoff":
        errs.append("open without closesAt (should it be rolling?)")
    if closes and closes < AS_OF and r.get("status") == "open":
        errs.append(f"status open but closesAt {closes} is past")
    if r.get("status") == "scheduled":
        nxt = pdate((r.get("nextWindow") or {}).get("expected")) or opens or closes
        if not nxt: errs.append("scheduled without any dated window")
        elif (nxt - AS_OF).days > 190: errs.append(f"scheduled window {nxt} beyond 6 months")
    # derived fields
    r["daysToClose"] = (closes - AS_OF).days if closes else None
    r["closingSoon"] = bool(closes and 0 <= (closes - AS_OF).days <= CLOSING_SOON_DAYS)
    r["opensInDays"] = (opens - AS_OF).days if opens and opens > AS_OF else None
    # catalog match
    cid = r.get("explorerCatalogId")
    if cid and cid not in cat_by_id:
        errs.append(f"explorerCatalogId {cid} not in catalog"); cid = None
    if not cid:
        cid = cat_by_norm.get(norm(r.get("name")))
    r["explorerCatalogId"] = cid
    r["inExplorerCatalog"] = bool(cid)
    if r.get("isNew") is None:
        r["isNew"] = not bool(cid)
        if r["isNew"] and not r.get("newBecause"): r["newBecause"] = "not in Explorer catalog"
    r["_errors"] = errs
    if errs: errors.append({"tier": r["_tier"], "id": r.get("id"), "name": r.get("name"), "errors": errs})
    valid.append(r)

# ---- dedupe across tiers (same normalized name, or same sourceUrl) ----
def url_key(u):
    u = (u or "").lower().split("#")[0].split("?")[0].rstrip("/")
    return re.sub(r"^https?://(www\.)?", "", u)
merged, dupes = [], []
index = {}
def richness(r): return sum(1 for v in r.values() if v not in (None, "", [], {})) + (0 if r["_errors"] else 5)
for r in valid:
    keys = [("n", norm(r["name"])), ("u", url_key(r.get("sourceUrl")))]
    hit = next((index[k] for k in keys if k in index), None)
    if hit is None:
        merged.append(r)
        for k in keys: index[k] = r
    else:
        keep, drop = (hit, r) if richness(hit) >= richness(r) else (r, hit)
        if keep is not hit:
            merged[merged.index(hit)] = keep
            for k in keys: index[k] = keep
        keep.setdefault("notes", "")
        if drop.get("notes") and drop["notes"] not in (keep.get("notes") or ""):
            keep["notes"] = (keep.get("notes") or "") + f" | [{drop['_tier']}] " + drop["notes"]
        keep["_alsoSeenIn"] = sorted(set(keep.get("_alsoSeenIn", []) + [drop["_tier"]]))
        dupes.append({"kept": keep["id"], "dropped": drop["id"], "tiers": [keep["_tier"], drop["_tier"]]})

# ---- sort: closing soonest first, then scheduled by open date, then rolling ----
def sort_key(r):
    if r["status"] == "open": return (0, r["daysToClose"] if r["daysToClose"] is not None else 9999, r["name"])
    if r["status"] == "scheduled":
        nxt = pdate((r.get("nextWindow") or {}).get("expected")) or pdate((r.get("window") or {}).get("opensAt")) or pdate((r.get("window") or {}).get("closesAt"))
        return (1, (nxt - AS_OF).days if nxt else 9999, r["name"])
    return (2, 0, r["name"])
merged.sort(key=sort_key)

# ---- write outputs ----
clean = []
for r in merged:
    row = {k: v for k, v in r.items() if not k.startswith("_")}
    row["tier"] = r["_tier"]; row["validationErrors"] = r["_errors"]
    if r.get("_alsoSeenIn"): row["alsoSeenIn"] = r["_alsoSeenIn"]
    clean.append(row)

counts = {
    "active": len(clean),
    "byStatus": dict(collections.Counter(r["status"] for r in clean)),
    "byCadence": dict(collections.Counter(r["cadence"] for r in clean)),
    "byLevel": dict(collections.Counter(r["level"] for r in clean)),
    "byInstrument": dict(collections.Counter(r["instrument"] for r in clean)),
    "byLegitimacy": dict(collections.Counter(r["legitimacy"] for r in clean)),
    "closingSoon": sum(1 for r in clean if r["closingSoon"]),
    "new": sum(1 for r in clean if r.get("isNew")),
    "inExplorerCatalog": sum(1 for r in clean if r["inExplorerCatalog"]),
    "withValidationErrors": sum(1 for r in clean if r["validationErrors"]),
    "checkedNotActive": len(not_active), "unconfirmed": len(unconfirmed), "catalogDisagreements": len(disagreements),
    "duplicatesMerged": len(dupes), "tiers": tiers_seen,
}
envelope = {
    "schemaVersion": 1,
    "asOfDate": AS_OF.isoformat(),
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "definitions": {
        "status": {"open": "accepting applications with a published close date", "rolling": "accepting on an ongoing basis until funds run out", "scheduled": "not open today; sponsor published an open date or deadline within 6 months"},
        "cadence": {"one_time": "single window, then gone", "recurring_scheduled": "recurs on a published calendar", "recurring_unscheduled": "recurs, next window not yet published (time-bound and recurring)", "rolling": "always open until funds exhausted", "rolling_with_cutoff": "apply anytime but a hard cutoff or prerequisite date exists"},
        "legitimacy": {"official": "government, utility, or established nonprofit; free", "pay_to_apply": "fee or paid membership required", "lead_gen": "a lender or vendor funnel", "sweepstakes": "random drawing", "unverified": "could not confirm on a sponsor page"},
        "closingSoon": f"closes within {CLOSING_SOON_DAYS} days of asOfDate",
        "isNew": "announced or first opened in 2026, or absent from the Explorer's internal program catalog (see newBecause)",
    },
    "counts": counts,
    "active": clean,
    "checkedNotActive": not_active,
    "unconfirmed": unconfirmed,
    "catalogDisagreements": disagreements,
    "validationErrors": errors,
    "duplicatesMerged": dupes,
}
os.makedirs(os.path.join(WT, "data"), exist_ok=True)
out_json = os.path.join(WT, "data", "grants-active.json")
json.dump(envelope, open(out_json, "w"), indent=2, ensure_ascii=False)

out_csv = os.path.join(WT, "data", "grants-active.csv")
cols = ["id","name","sponsor","level","instrument","status","closingSoon","daysToClose","cadence","opensAt","closesAt","closesAtTime","windowLabel","nextWindowExpected","amountDisplay","amountShare","geography","entityTypes","stage","demographicRestriction","useOfFunds","keyExclusions","costToApply","legitimacy","isNew","newBecause","inExplorerCatalog","explorerCatalogId","applyUrl","sourceUrl","verifiedAt","evidence","notes","tier","validationErrors"]
with open(out_csv, "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(cols)
    for r in clean:
        win = r.get("window") or {}; el = r.get("eligibility") or {}; am = r.get("amount") or {}
        w.writerow([r.get("id"), r.get("name"), r.get("sponsor"), r.get("level"), r.get("instrument"), r.get("status"), r.get("closingSoon"), r.get("daysToClose"), r.get("cadence"), win.get("opensAt"), win.get("closesAt"), win.get("closesAtTime"), win.get("label"), (r.get("nextWindow") or {}).get("expected"), am.get("display"), am.get("share"), el.get("geography"), ";".join(el.get("entityTypes") or []), el.get("stage"), el.get("demographicRestriction"), ";".join(el.get("useOfFunds") or []), el.get("keyExclusions"), r.get("costToApply"), r.get("legitimacy"), r.get("isNew"), r.get("newBecause"), r.get("inExplorerCatalog"), r.get("explorerCatalogId"), r.get("applyUrl"), r.get("sourceUrl"), r.get("verifiedAt"), r.get("evidence"), r.get("notes"), r.get("tier"), "; ".join(r.get("validationErrors") or [])])

# ---- summary markdown ----
lines = [f"# Active grants database — summary (as of {AS_OF})", "",
         f"Tiers merged: {', '.join(tiers_seen)}", "",
         "| Metric | Count |", "|---|---|"]
for k in ["active","closingSoon","new","inExplorerCatalog","withValidationErrors","checkedNotActive","unconfirmed","catalogDisagreements","duplicatesMerged"]:
    lines.append(f"| {k} | {counts[k]} |")
for k in ["byStatus","byCadence","byLevel","byInstrument","byLegitimacy"]:
    lines.append(f"| {k} | {', '.join(f'{a} {b}' for a,b in sorted(counts[k].items()))} |")
lines += ["", "## Closing within 21 days", "", "| Closes | Program | Amount | Who | Source |", "|---|---|---|---|---|"]
for r in clean:
    if r["closingSoon"]:
        lines.append(f"| {(r.get('window') or {}).get('closesAt')} | {r['name']} ({r['sponsor']}) | {(r.get('amount') or {}).get('display')} | {(r.get('eligibility') or {}).get('summary','')[:120]} | {r['sourceUrl']} |")
lines += ["", "## Scheduled windows (not open today, date published)", "", "| Opens / due | Program | Amount | Source |", "|---|---|---|---|"]
for r in clean:
    if r["status"] == "scheduled":
        w = r.get("window") or {}
        lines.append(f"| {w.get('opensAt') or (r.get('nextWindow') or {}).get('expected')} → {w.get('closesAt') or ''} | {r['name']} ({r['sponsor']}) | {(r.get('amount') or {}).get('display')} | {r['sourceUrl']} |")
lines += ["", "## New (not in Explorer catalog, or first opened in 2026)", ""]
for r in clean:
    if r.get("isNew"): lines.append(f"- **{r['name']}** ({r['sponsor']}, {r['level']}, {r['status']}): {(r.get('amount') or {}).get('display')}. {r.get('newBecause') or ''}")
lines += ["", "## Catalog disagreements", ""]
for d in disagreements: lines.append(f"- `{d.get('explorerCatalogId')}`: catalog says {d.get('catalogSays')}; verified today: {d.get('verifiedToday')} ({d.get('sourceUrl')})")
lines += ["", "## Validation errors (rows kept, flagged)", ""]
for e in errors: lines.append(f"- [{e.get('tier')}] {e.get('name') or e.get('file')}: {', '.join(e.get('errors', [e.get('error','')]))}")
lines += ["", "## Unconfirmed leads", ""]
for u in unconfirmed: lines.append(f"- [{u.get('tier')}] {u.get('name')} ({u.get('sponsor')}): {u.get('whyUnconfirmed')}")
open(os.path.join(S, "SUMMARY.md"), "w").write("\n".join(lines) + "\n")
print(json.dumps(counts, indent=1))
print("wrote", out_json, out_csv, os.path.join(S, "SUMMARY.md"))
