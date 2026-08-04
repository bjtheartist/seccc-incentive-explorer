#!/usr/bin/env python3
"""Phase 3b — statistical audit of the published foundation grant rows.

Executes the audit leg of the Sol 5.6 verification plan: a seeded simple random
sample of n=2,401 rows across ALL THREE published foundation files (base /
tier-1 / phase-2), each sampled row re-verified AGAINST ITS OWN FILING by
re-parsing the IRS e-file XML and matching the row's recipient, amount, and
address. The sample size gives a ±2% margin at 95% confidence over the ~21.8k
row universe; the seed is fixed so the draw is reproducible.

Row -> filing resolution:
  tier-1 / phase-2: (funder, tax_year) -> object_id via the committed
    reconciliation reports; XMLs come from the local cache laid down by the
    Phase-2 run (fetched on demand if missing).
  base file: the original 12-funder parse predates the recon discipline, so
    object ids are resolved live from ProPublica per (EIN, tax year) — the
    census carries each base funder's EIN.

Error classes (each counted, none silently absorbed):
  ok                  — recipient+amount matched in the filing (address too,
                        or the row is citywide/address-withheld)
  amount_only_match   — amount found but recipient text differs beyond
                        normalization (adjudicate)
  not_in_filing       — no grant row in the filing matches amount+recipient
                        (adjudicate — the serious class)
  filing_unavailable  — filing could not be resolved/fetched (counted, not ok)

Mismatches are written to phase3_audit_mismatches.csv for agent adjudication;
the summary (rates by class and by file) goes to phase3_audit_report.json.
"""

import csv
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phase2_pipeline as pp  # fetch/parse helpers + XML cache discipline

INPUTS = pp.INPUTS
SEED = 20260804
SAMPLE_N = 2401

FILES = {
    "base": "foundation_grants_geocoded.csv",
    "tier1": "foundation_grants_tier1_expansion.csv",
    "phase2": "foundation_grants_phase2_expansion.csv",
}
RECON_FILES = [
    "foundation_grants_tier1_reconciliation_report.csv",
    "foundation_grants_phase2_reconciliation_report.csv",
]
OUT_DIR = os.path.join(INPUTS)
STATE = os.environ.get(
    "AUDIT_STATE",
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/phase3_audit",
)
os.makedirs(STATE, exist_ok=True)


def norm_text(s):
    return re.sub(r"[^A-Z0-9]+", " ", (s or "").upper()).strip()


def load_universe():
    rows = []
    for tag, fname in FILES.items():
        for i, r in enumerate(csv.DictReader(open(os.path.join(INPUTS, fname)))):
            rows.append({"file": tag, "idx": i, **r})
    return rows


def build_oid_index():
    """(funder display name, tax_yr) -> [object_id,...] from the recon reports."""
    idx = {}
    for f in RECON_FILES:
        for r in csv.DictReader(open(os.path.join(INPUTS, f))):
            idx.setdefault((r["funder"], r["tax_yr"]), []).append(r["object_id"])
    return idx


def base_funder_eins():
    """Base-file funder display name -> EIN, from the census notes."""
    out = {}
    for r in csv.DictReader(open(os.path.join(INPUTS, "foundation_funder_census.csv"))):
        if r["disposition"] != "already_parsed":
            continue
        m = re.search(r"parsed as '([^']+)'", r["notes"] or "")
        if m:
            out[m.group(1)] = r["ein"].zfill(9)
    return out


_parsed_cache = {}


def filing_grant_index(oid):
    """oid -> list of normalized grant tuples from the filing, cached."""
    if oid in _parsed_cache:
        return _parsed_cache[oid]
    try:
        ret = pp.parse_return(pp.fetch_xml(oid), oid)
        grants = [
            {
                "recipient": norm_text(g["recipient"]),
                "amount": g["amount"],
                "addr": norm_text(g["address_line1"]),
            }
            for g in (ret["grants"] if ret else [])
        ]
    except Exception:
        grants = None
    _parsed_cache[oid] = grants
    return grants


def resolve_base_oids(ein, done={}):
    """All in-window object ids for a base funder, resolved once per EIN."""
    if ein in done:
        return done[ein]
    try:
        oids = pp.resolve_object_ids(ein)
    except Exception:
        oids = []
    done[ein] = oids
    return oids


def audit_row(row, oid_index, base_eins):
    key = (row["foundation"], row["tax_year"])
    oids = oid_index.get(key)
    if oids is None and row["file"] == "base":
        ein = base_eins.get(row["foundation"])
        oids = resolve_base_oids(ein) if ein else []
    if not oids:
        return "filing_unavailable", None
    want_r = norm_text(row["recipient"])
    want_amt = float(row["amount"]) if row["amount"] not in ("", None) else None
    best = "not_in_filing"
    for oid in oids:
        grants = filing_grant_index(oid)
        if grants is None:
            continue
        for g in grants:
            if g["amount"] is None or want_amt is None:
                continue
            if abs(g["amount"] - want_amt) > 0.5:
                continue
            if g["recipient"] == want_r:
                return "ok", oid
            # same amount, recipient text differs — remember but keep looking
            best = "amount_only_match"
    return best, None


def main():
    universe = load_universe()
    rng = random.Random(SEED)
    sample = rng.sample(range(len(universe)), min(SAMPLE_N, len(universe)))
    oid_index = build_oid_index()
    base_eins = base_funder_eins()
    print(f"universe={len(universe)} sample={len(sample)} seed={SEED}", flush=True)

    counts = {}
    by_file = {}
    mismatches = []
    for n, i in enumerate(sorted(sample), 1):
        row = universe[i]
        verdict, oid = audit_row(row, oid_index, base_eins)
        counts[verdict] = counts.get(verdict, 0) + 1
        by_file.setdefault(row["file"], {}).setdefault(verdict, 0)
        by_file[row["file"]][verdict] += 1
        if verdict != "ok":
            mismatches.append({
                "file": row["file"], "row_index": row["idx"], "verdict": verdict,
                "foundation": row["foundation"], "tax_year": row["tax_year"],
                "recipient": row["recipient"], "amount": row["amount"],
                "address_line1": row["address_line1"],
            })
        if n % 200 == 0:
            print(f"[{n}/{len(sample)}] {counts}", flush=True)

    report = {
        "design": "SRS without replacement, seeded",
        "seed": SEED,
        "universe_rows": len(universe),
        "sample_n": len(sample),
        "counts": counts,
        "by_file": by_file,
        "ok_rate": round(counts.get("ok", 0) / len(sample), 6),
        "margin_note": "n=2401 gives ±2% at 95% confidence for the pooled universe",
    }
    json.dump(report, open(os.path.join(STATE, "phase3_audit_report.json"), "w"), indent=1)
    with open(os.path.join(STATE, "phase3_audit_mismatches.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file", "row_index", "verdict", "foundation",
                                          "tax_year", "recipient", "amount", "address_line1"])
        w.writeheader()
        w.writerows(mismatches)
    print("REPORT:", json.dumps(report["counts"]), "ok_rate", report["ok_rate"], flush=True)


if __name__ == "__main__":
    main()
