#!/usr/bin/env python3
"""Deliverable 6 -- fresh seeded SRS audit over the FINAL EXPORTED foundation
universe, bound to the export content hash (consult Q3 / F1).

Supersedes phase3_audit.py's n=2,401 sample, which covered only base+tier1+
phase2 (~21.8k rows) and predates Phase-3 (audit finding 2). This audit draws
from data/private/community-investment.json's own `foundation`-source records
-- the ACTUAL committed universe, dedupe-adjudication and placeholder-drops
already applied -- and re-verifies each sampled row against its own IRS filing
by re-parsing the cached/fetched e-file XML.

Each sampled record already carries its own filingObjectId (deliverable 2
identity), so this audit does not need to re-derive filing identity the way
phase3_audit.py did -- a record whose identity did not resolve gets verdict
"filing_unavailable", counted, never silently dropped from the denominator.

If ANY sampled row mismatches its filing: stop is not literal (the full sample
still runs so the error rate is a real statistic), but the mismatch is written
to the report and NEVER silently "fixed" -- adjudication is a human's job.
"""
import csv
import hashlib
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import phase2_pipeline as pp  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXPORT_PATH = os.path.join(REPO, "data", "private", "community-investment.json")
MANIFEST_PATH = os.path.join(REPO, "data", "curated", "investment-inputs", "manifest.json")
STATE = os.environ.get(
    "FRESH_AUDIT_STATE",
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/10dee20f-e3a0-40a3-bd19-c38d42603310/scratchpad",
)
os.makedirs(STATE, exist_ok=True)
REPORT_PATH = os.path.join(REPO, "data", "curated", "investment-inputs", "foundation_audit_fresh.json")
MISMATCH_PATH = os.path.join(STATE, "fresh_audit_mismatches.csv")

SEED = 20260813  # today's date (session date), fixed for reproducibility
SAMPLE_N = 2401


def norm_text(s):
    return re.sub(r"[^A-Z0-9]+", " ", (s or "").upper()).strip()


_grants_cache = {}


def filing_grants(object_id):
    if object_id in _grants_cache:
        return _grants_cache[object_id]
    try:
        ret = pp.parse_return(pp.fetch_xml(object_id), object_id)
        grants = ret["grants"] if ret else None
    except Exception as exc:  # noqa: BLE001
        print(f"WARN oid {object_id}: fetch/parse failed: {exc}", file=sys.stderr)
        grants = None
    _grants_cache[object_id] = grants
    return grants


def audit_record(rec):
    oid = rec.get("filingObjectId")
    if not oid:
        return "filing_unavailable", None
    grants = filing_grants(oid)
    if grants is None:
        return "filing_unavailable", None
    want_r = norm_text(rec.get("recipient"))
    want_amt = rec.get("amountAwarded")
    if want_amt is None:
        return "filing_unavailable", None
    best = "not_in_filing"
    for g in grants:
        if g["amount"] is None:
            continue
        if abs(g["amount"] - float(want_amt)) > 0.5:
            continue
        if norm_text(g["recipient"]) == want_r:
            return "ok", oid
        best = "amount_only_match"
    return best, None


def main():
    export = json.load(open(EXPORT_PATH))
    export_hash = export["meta"].get("exportContentHash", "")
    # Chicago Prize rows are mapped into the `foundation` source (mapChicagoPrize)
    # but are NOT IRS-filing rows -- consult Q3 requires them OUT of this SRS and
    # reported separately as an 18/18 census check (chicago_prize_census_check.py).
    PRIZE_FUNDER = "Pritzker Traubert Foundation — Chicago Prize"
    universe = [
        r for r in export["records"]
        if r["source"] == "foundation" and r.get("funderName") != PRIZE_FUNDER
    ]
    prize_excluded = sum(
        1 for r in export["records"] if r["source"] == "foundation" and r.get("funderName") == PRIZE_FUNDER
    )
    print(f"excluded {prize_excluded} Chicago Prize rows from the IRS-filing SRS universe (consult Q3)", flush=True)
    manifest_hash = None
    if os.path.exists(MANIFEST_PATH):
        manifest_hash = hashlib.sha256(open(MANIFEST_PATH, "rb").read()).hexdigest()

    rng = random.Random(SEED)
    n = min(SAMPLE_N, len(universe))
    sample_idx = rng.sample(range(len(universe)), n)
    print(f"universe={len(universe)} sample={n} seed={SEED} export_hash={export_hash[:16]}...", flush=True)

    counts = {}
    mismatches = []
    for k, i in enumerate(sorted(sample_idx), 1):
        rec = universe[i]
        verdict, oid = audit_record(rec)
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict != "ok":
            mismatches.append({
                "record_id": rec.get("id"), "stable_id": rec.get("stableId"),
                "verdict": verdict, "funder": rec.get("funderName"),
                "recipient": rec.get("recipient"), "amount": rec.get("amountAwarded"),
                "filing_object_id": rec.get("filingObjectId"),
            })
        if k % 200 == 0:
            print(f"[{k}/{n}] {counts}", flush=True)

    report = {
        "design": "SRS without replacement, seeded, over the FINAL EXPORTED foundation universe",
        "seed": SEED,
        "universe_rows": len(universe),
        "chicago_prize_excluded_from_universe": prize_excluded,
        "sample_n": n,
        "counts": counts,
        "ok_rate": round(counts.get("ok", 0) / n, 6) if n else None,
        "margin_note": f"n={n} gives approximately +/-2% at 95% confidence over a ~{len(universe)}-row universe",
        "bound_export_content_hash": export_hash,
        "bound_manifest_hash": manifest_hash,
        "generated_at": export.get("generatedAt"),
        "note": (
            "Supersedes foundation_audit_2026-08-04.json (n=2,401 over base+tier1+phase2 "
            "only, ~21.8k rows). This audit covers the FULL four-file exported foundation "
            "universe (base+tier1+phase2+phase3), bound to the export's own content hash. "
            "Chicago Prize (18 rows) is reported separately -- see chicago_prize_census_check.json "
            "-- as a census check, not part of this SRS (consult Q3)."
        ),
    }
    json.dump(report, open(REPORT_PATH, "w"), indent=1)
    with open(MISMATCH_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["record_id", "stable_id", "verdict", "funder", "recipient", "amount", "filing_object_id"])
        w.writeheader()
        w.writerows(mismatches)

    print(f"Wrote {REPORT_PATH}")
    print("REPORT:", json.dumps(counts), "ok_rate", report["ok_rate"], flush=True)
    if mismatches:
        print(f"MISMATCHES: {len(mismatches)} -- see {MISMATCH_PATH} (NOT auto-fixed)", flush=True)


if __name__ == "__main__":
    main()
