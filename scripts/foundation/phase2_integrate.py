#!/usr/bin/env python3
"""Phase-2 integration: funder checkpoints -> the three committed CSVs + an
honest census register.

Reads every scratchpad checkpoint written by phase2_pipeline.py, applies the
review overrides (display-name corrections and funder-level exclusions decided
by the review pass -- never invented here), and emits:

  foundation_grants_phase2_expansion.csv               13-col, publishable rows
  foundation_grants_phase2_quarantined_DO_NOT_EXPORT.csv  provenance-only
  foundation_grants_phase2_reconciliation_report.csv   per-filing audit trail

It also RECONCILES the census: every EIN's disposition is restated from what
the reconciliation reports actually prove (tier1 + phase2), replacing the
planning-era labels (tier1_queue / grantmaker_verified) that went stale the
moment parsing ran. The census is the register of record; it must not disagree
with the audit trail it points at.

Overrides file (scripts/foundation/phase2_overrides.json), written by the
review pass:
  { "name_overrides": {"<ein>": "Curated Display Name"},
    "excluded_funders": {"<ein>": "reason"} }
Excluded funders keep their recon rows (the audit happened) but publish no
grant rows; their census disposition carries the review reason.
"""

import csv
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
INPUTS = os.path.join(REPO, "data", "curated", "investment-inputs")
STATE_DIR = os.environ.get(
    "PHASE2_STATE",
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/phase2",
)
FUNDER_DIR = os.path.join(STATE_DIR, "funders")
OVERRIDES = os.path.join(HERE, "phase2_overrides.json")

EXPANSION = os.path.join(INPUTS, "foundation_grants_phase2_expansion.csv")
QUARANTINE = os.path.join(INPUTS, "foundation_grants_phase2_quarantined_DO_NOT_EXPORT.csv")
RECON = os.path.join(INPUTS, "foundation_grants_phase2_reconciliation_report.csv")
CENSUS = os.path.join(INPUTS, "foundation_funder_census.csv")
TIER1_RECON = os.path.join(INPUTS, "foundation_grants_tier1_reconciliation_report.csv")

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


def load_overrides():
    if os.path.exists(OVERRIDES):
        return json.load(open(OVERRIDES))
    return {"name_overrides": {}, "excluded_funders": {}}


def write_csv(path, header, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in header})


def main():
    ov = load_overrides()
    names = ov.get("name_overrides", {})
    excluded = ov.get("excluded_funders", {})

    funders = []
    for fn in sorted(os.listdir(FUNDER_DIR)):
        if fn.endswith(".json"):
            funders.append(json.load(open(os.path.join(FUNDER_DIR, fn))))
    if not funders:
        sys.exit("no checkpoints found -- run phase2_pipeline.py first")

    expansion_rows, quarantine_rows, recon_rows = [], [], []
    census_updates = {}
    tallies = Counter()

    for f in funders:
        ein = f["ein"]
        display = names.get(ein, f["name"])
        renamed = display != f["name"]

        for rec in f["filings"]:
            rec = dict(rec)
            if renamed:
                rec["funder"] = display
            recon_rows.append(rec)

        if ein in excluded:
            reason = excluded[ein]
            for q in f["quarantined"]:
                q = dict(q)
                q["foundation"] = display
                quarantine_rows.append(q)
            for r in f["rows"]:
                q = dict(r)
                q["foundation"] = display
                q.update({
                    "lat": "", "lng": "", "locType": "intermediary_or_citywide",
                    "exclusion_reason": f"review_excluded: {reason}",
                    "object_id": "", "reconciliation_status": "review_excluded",
                })
                quarantine_rows.append(q)
            census_updates[ein] = {
                "disposition": "review_excluded",
                "phase2_note": reason,
                "phase2_status": "review_excluded",
                "chicago_rows": 0, "chicago_dollars": 0.0,
                "filings": len(f["filings"]),
            }
            tallies["review_excluded"] += 1
            continue

        for r in f["rows"]:
            r = dict(r)
            if renamed:
                r["foundation"] = display
            expansion_rows.append(r)
        for q in f["quarantined"]:
            q = dict(q)
            if renamed:
                q["foundation"] = display
            quarantine_rows.append(q)

        chi_rows = sum(rec["chicago_rows"] for rec in f["filings"])
        chi_dollars = round(sum(rec["chicago_dollars"] for rec in f["filings"]), 2)
        disposition = {
            "parsed": "parsed_phase2",
            "parsed_no_chicago_rows": "parsed_phase2_no_chicago_rows",
            "aggregate_only": "aggregate_only",
            "no_efile_in_window": "no_efile_in_window",
            "no_grants_in_window": "no_grants_in_window",
            "needs_review": "needs_review",
            "resolve_failed": "needs_review",
        }.get(f["disposition"], "needs_review")
        census_updates[ein] = {
            "disposition": disposition,
            "phase2_status": f["disposition"],
            "phase2_note": "; ".join(f["notes"])[:300],
            "chicago_rows": chi_rows, "chicago_dollars": chi_dollars,
            "filings": len(f["filings"]),
        }
        tallies[disposition] += 1

    write_csv(EXPANSION, EXPANSION_HEADER, expansion_rows)
    write_csv(QUARANTINE, QUARANTINE_HEADER, quarantine_rows)
    write_csv(RECON, RECON_HEADER, recon_rows)

    # ── census reconciliation: the register must match the audit trail ──
    tier1_parsed = {}
    for r in csv.DictReader(open(TIER1_RECON)):
        e = r["ein"].zfill(9)
        t = tier1_parsed.setdefault(e, {"statuses": set(), "filings": 0, "rows": 0, "dollars": 0.0})
        t["statuses"].add(r["status"])
        t["filings"] += 1
        t["rows"] += int(r["chicago_rows"] or 0)
        t["dollars"] += float(r["chicago_dollars"] or 0)

    census = list(csv.DictReader(open(CENSUS)))
    header = list(census[0].keys())
    for col in ("phase2_status", "phase2_filings", "phase2_chicago_rows", "phase2_chicago_dollars", "phase2_note"):
        if col not in header:
            header.append(col)
    restated = Counter()
    for row in census:
        ein = row["ein"].zfill(9)
        for col in ("phase2_status", "phase2_filings", "phase2_chicago_rows", "phase2_chicago_dollars", "phase2_note"):
            row.setdefault(col, "")
        if ein in census_updates:
            u = census_updates[ein]
            row["disposition"] = u["disposition"]
            row["phase2_status"] = u["phase2_status"]
            row["phase2_filings"] = u["filings"]
            row["phase2_chicago_rows"] = u["chicago_rows"]
            row["phase2_chicago_dollars"] = u["chicago_dollars"]
            row["phase2_note"] = u["phase2_note"]
        elif ein in tier1_parsed and row["disposition"] in ("tier1_queue", "grantmaker_verified", "needs_review"):
            t = tier1_parsed[ein]
            has_pub = "reconciled" in t["statuses"]
            row["disposition"] = "parsed_tier1" if has_pub else "aggregate_only"
            row["tier1_status"] = "parsed" if has_pub else "aggregate_only"
            row["tier1_filings"] = t["filings"]
            row["tier1_chicago_rows"] = t["rows"]
            row["tier1_chicago_dollars"] = round(t["dollars"], 2)
            if not row.get("tier1_note"):
                row["tier1_note"] = "disposition restated from tier1 reconciliation report (planning label had gone stale)"
            restated[row["disposition"]] += 1
    write_csv(CENSUS, header, census)

    dollars = sum(float(r["amount"]) for r in expansion_rows if r["amount"] not in ("", None))
    print(f"expansion rows: {len(expansion_rows)}  (${dollars:,.2f})")
    print(f"quarantine rows: {len(quarantine_rows)}")
    print(f"recon filings: {len(recon_rows)}  statuses: {dict(Counter(r['status'] for r in recon_rows))}")
    print(f"funder dispositions: {dict(tallies)}")
    print(f"tier1 census restatements: {dict(restated)}")
    print(f"distinct phase2 funders published: {len({r['foundation'] for r in expansion_rows})}")


if __name__ == "__main__":
    main()
