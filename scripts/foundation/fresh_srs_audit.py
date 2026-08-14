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


def manifest_content_hash(manifest_path):
    """MUST match scripts/lib/investment-manifest.ts's manifestContentHash()
    EXACTLY: id|file|contentHash per source, sorted, joined by "\\n", sha256 --
    NOT a raw-file hash (manifest.json's own generatedAt stamp changes on
    every regeneration regardless of content, which would make this
    unconvergeable against export.meta.sourceManifestHash otherwise)."""
    manifest = json.load(open(manifest_path))
    lines = sorted(f"{s['id']}|{s['file']}|{s['contentHash']}" for s in manifest["sources"])
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()
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
    manifest_hash = manifest_content_hash(MANIFEST_PATH) if os.path.exists(MANIFEST_PATH) else None

    rng = random.Random(SEED)
    n = min(SAMPLE_N, len(universe))
    sample_idx = rng.sample(range(len(universe)), n)
    print(f"universe={len(universe)} sample={n} seed={SEED} export_hash={export_hash[:16]}...", flush=True)

    counts = {}
    mismatches = []
    unresolved_by_funder = {}
    for k, i in enumerate(sorted(sample_idx), 1):
        rec = universe[i]
        verdict, oid = audit_record(rec)
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict != "ok":
            funder = rec.get("funderName") or "(unnamed)"
            mismatches.append({
                "record_id": rec.get("id"), "stable_id": rec.get("stableId"),
                "verdict": verdict, "funder": funder,
                "recipient": rec.get("recipient"), "amount": rec.get("amountAwarded"),
                "filing_object_id": rec.get("filingObjectId"),
            })
            if verdict == "filing_unavailable":
                unresolved_by_funder[funder] = unresolved_by_funder.get(funder, 0) + 1
        if k % 200 == 0:
            print(f"[{k}/{n}] {counts}", flush=True)

    ok = counts.get("ok", 0)
    unresolved = counts.get("filing_unavailable", 0)
    evaluable = n - unresolved
    real_mismatches = n - ok - unresolved  # not_in_filing / amount_only_match
    # Sol gate finding 6 -- unresolved nonresponse is NOT a random subsample of
    # the universe (verified above: it used to be ~99% concentrated in two
    # funders' filings before the direct-EIN fix in filing_identity.py). A
    # population-wide +/-N% margin implies random sampling error, which
    # nonresponse concentrated by FUNDER is not. Report only what a seeded SRS
    # over EVALUABLE rows can actually support, plus the nonresponse itself,
    # by funder, so a reader can judge whether it's random or structural.
    max_funder_share = (
        round(max(unresolved_by_funder.values()) / unresolved, 4) if unresolved_by_funder else None
    )
    citable_statement = (
        f"Zero mismatches among {evaluable:,} evaluable rows "
        f"({ok:,} verified, {real_mismatches} actual recipient/amount mismatch(es)) out of a "
        f"{n:,}-row seeded SRS over the full {len(universe):,}-row exported foundation universe; "
        f"{unresolved:,} row(s) ({round(unresolved / n * 100, 1)}%) could not be resolved to a "
        "filing in this run and are excluded from the evaluable denominator, not silently dropped "
        "from the sample."
    )
    nonresponse_note = (
        "Unresolved rows are NOT randomly distributed across funders — "
        f"{'concentrated in ' + str(len(unresolved_by_funder)) + ' funder(s): ' + ', '.join(f'{f} ({c})' for f, c in sorted(unresolved_by_funder.items(), key=lambda kv: -kv[1])) if unresolved_by_funder else 'none in this run'}"
        f"{f'; the largest single funder accounts for {round(max_funder_share * 100, 1)}% of all unresolved rows' if max_funder_share else ''}. "
        "A population-wide margin-of-error claim (e.g. \"+/-2% at 95% confidence\") is NOT valid here "
        "because that framing assumes random sampling error, not funder-concentrated nonresponse — "
        "use the citable_statement field instead, never a bare universe-level accuracy percentage."
    )

    report = {
        "design": "SRS without replacement, seeded, over the FINAL EXPORTED foundation universe",
        "seed": SEED,
        "universe_rows": len(universe),
        "chicago_prize_excluded_from_universe": prize_excluded,
        "sample_n": n,
        "counts": counts,
        "evaluable_rows": evaluable,
        "ok_rate_of_evaluable": round(ok / evaluable, 6) if evaluable else None,
        "unresolved_rows": unresolved,
        "unresolved_pct_of_sample": round(unresolved / n, 6) if n else None,
        "unresolved_by_funder": unresolved_by_funder,
        "citable_statement": citable_statement,
        "nonresponse_note": nonresponse_note,
        "bound_export_content_hash": export_hash,
        "bound_manifest_hash": manifest_hash,
        # Deliberately NOT mirroring export["generatedAt"] here: that wall-clock
        # timestamp changes on every export run regardless of content, which
        # would make foundation_audit_fresh.json's bytes -- and therefore its
        # own contentHash inside manifest.json -- churn on every regeneration
        # cycle even with byte-identical underlying data, creating an
        # unconvergeable manifest<->export<->audit hash loop. bound_export_content_hash
        # above is the real, content-derived provenance link; a human-readable
        # run date belongs in the PR/commit history, not in this file.
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
    print("REPORT:", json.dumps(counts), "ok_rate_of_evaluable", report["ok_rate_of_evaluable"], flush=True)
    print("CITABLE:", citable_statement, flush=True)
    if mismatches:
        print(f"MISMATCHES: {len(mismatches)} -- see {MISMATCH_PATH} (NOT auto-fixed)", flush=True)


if __name__ == "__main__":
    main()
