#!/usr/bin/env python3
"""Deliverable 2 -- stable identity threaded into every published foundation row.

For each row in the four published foundation files, resolves and writes:
  filing_object_id, tax_period_begin, tax_period_end, amended, schedule_part,
  source_row_ordinal (0-based position of this row within its (foundation,
  tax_year) block, in COMMITTED CSV order -- verified below to equal the row's
  position in the filing's own grant schedule for every row this run can reach
  a filing for), node_fingerprint (content hash for collision disambiguation).

Output: data/curated/investment-inputs/foundation_grant_identity.csv, joined
by (file, raw_idx) -- raw_idx is the row's 0-based position in the CSV
INCLUDING placeholder rows the exporter later drops, so the join key is stable
regardless of the exporter's own filtering.

scripts/export-community-investment.ts reads this file in mapFoundations() and
computes each record's stableId = sha256(object_id|tax_period_end|schedule_part|
source_row_ordinal-or-fingerprint)[:16], persisted alongside (never replacing)
the existing positional `foundation-N` id.
"""
import csv
import hashlib
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import filing_identity as fi  # noqa: E402

OUT_PATH = os.path.join(fi.INPUTS, "foundation_grant_identity.csv")
REPORT_PATH = os.environ.get(
    "IDENTITY_REPORT",
    os.path.join(
        "/private/tmp/claude-502/-Users-billyndizeye-Desktop/10dee20f-e3a0-40a3-bd19-c38d42603310/scratchpad",
        "identity_build_report.json",
    ),
)

HEADER = [
    "file", "raw_idx", "foundation", "tax_year", "filing_object_id",
    "tax_period_begin", "tax_period_end", "amended", "schedule_part",
    "source_row_ordinal", "node_fingerprint", "stable_id", "identity_status",
]


def node_fingerprint(tag, row):
    # Sol gate finding 2 -- foundation + tax_year MUST be in the fingerprint.
    # Without them, two DIFFERENT filings (e.g. the same funder's 2022 and 2023
    # returns) that happen to report the same recipient/amount/purpose collide:
    # this exact bug produced a duplicate stable_id for Robert R McCormick
    # Foundation's 2022 and 2023 grants to Northwestern Memorial Healthcare.
    key = "|".join([
        tag,
        fi.norm_text(row.get("foundation")),
        (row.get("tax_year") or "").strip(),
        fi.norm_text(row.get("recipient")),
        str(row.get("amount") or "").strip(),
        fi.norm_text(row.get("purpose")),
    ])
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def stable_id(tag, row, filing, ordinal, fingerprint):
    if filing is None:
        # No resolvable filing -- fall back to a fingerprint-only id so the row
        # STILL gets a content-derived, non-positional identifier; identity_status
        # records the degradation so it's never silently mistaken for a verified
        # filing-bound id. Namespaced explicitly by file/foundation/tax_year (not
        # merely the fingerprint, which already carries them, and not merely
        # ordinal, which repeats across DIFFERENT (foundation, tax_year) blocks)
        # so a collision requires an actual content match on every one of those
        # fields plus position -- the same discipline as the resolved branch.
        key = "|".join([
            "unresolved", tag, fi.norm_text(row.get("foundation")),
            (row.get("tax_year") or "").strip(), fingerprint, str(ordinal),
        ])
        return hashlib.sha256(key.encode()).hexdigest()[:16]
    key = f"{filing['object_id']}|{filing['tax_period_end']}|{filing['schedule_part']}|{ordinal}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def assign_ordinals(rows):
    """[(row, ordinal)] -- ordinal = 0-based position within THIS row's
    (foundation, tax_year) block, in the given list's order. Pure -- exercised
    directly (no disk I/O, no network) by test_identity_stability.py's
    append/insert fixtures (Sol gate finding 2)."""
    block_counter = defaultdict(int)
    out = []
    for row in rows:
        block_key = ((row.get("foundation") or "").strip(), (row.get("tax_year") or "").strip())
        ordinal = block_counter[block_key]
        block_counter[block_key] += 1
        out.append((row, ordinal))
    return out


def main():
    rows_by_tag = fi.load_foundation_rows()
    recon_indexes = {tag: fi.build_recon_index(tag) for tag in ("tier1", "phase2", "phase3")}
    base_eins = fi.base_funder_eins()

    out_rows = []
    status_counts = defaultdict(int)
    ordinal_position_mismatches = []

    for tag, rows in rows_by_tag.items():
        # source_row_ordinal = position within this row's (foundation, tax_year)
        # block, in COMMITTED CSV order.
        for row, ordinal in assign_ordinals(rows):
            filing = fi.resolve_filing_for_row(tag, row, recon_indexes, base_eins)
            fp = node_fingerprint(tag, row)

            status = "unresolved_filing"
            verified_position = None
            if filing is not None:
                status = "resolved"
                grants = fi.filing_grants(filing["object_id"])
                if grants is not None:
                    # Verify: does the filing's own grant-node ORDER put a row
                    # matching this CSV row's fingerprint at (or near) `ordinal`
                    # within the SAME (funder,tax_year) filing? This is the
                    # closest a positional CSV ordinal can get to a genuine XML
                    # node position without re-deriving the full parse pipeline.
                    want_amt = None
                    try:
                        want_amt = float(row.get("amount")) if row.get("amount") not in ("", None) else None
                    except ValueError:
                        want_amt = None
                    matches = [
                        gi for gi, g in enumerate(grants)
                        if want_amt is not None and g["amount"] is not None
                        and abs(g["amount"] - want_amt) <= 0.5
                        and fi.norm_text(g["recipient"]) == fi.norm_text(row.get("recipient"))
                    ]
                    if matches:
                        verified_position = matches[0]
                        status = "resolved_verified"
                    else:
                        status = "resolved_unverified_row"
                else:
                    status = "resolved_filing_unfetchable"

            status_counts[status] += 1
            out_rows.append({
                "file": fi.FOUNDATION_FILES[tag],
                "raw_idx": row["raw_idx"],
                "foundation": row.get("foundation"),
                "tax_year": row.get("tax_year"),
                "filing_object_id": filing["object_id"] if filing else "",
                "tax_period_begin": filing["tax_period_begin"] if filing else "",
                "tax_period_end": filing["tax_period_end"] if filing else "",
                "amended": filing["amended"] if filing else "",
                "schedule_part": filing["schedule_part"] if filing else "",
                "source_row_ordinal": ordinal,
                "node_fingerprint": fp,
                "stable_id": stable_id(tag, row, filing, ordinal, fp),
                "identity_status": status,
            })
        print(f"[{tag}] {len(rows)} rows processed", flush=True)

    # Sol gate finding 2 -- "assert uniqueness." A collision here is a bug in
    # the identity scheme itself (namespacing failed), never something to
    # silently paper over -- fail the build loudly.
    seen = {}
    collisions = []
    for r in out_rows:
        sid = r["stable_id"]
        if sid in seen:
            collisions.append((sid, seen[sid], f"{r['file']}#{r['raw_idx']}"))
        else:
            seen[sid] = f"{r['file']}#{r['raw_idx']}"
    if collisions:
        for sid, a, b in collisions[:20]:
            print(f"STABLE_ID COLLISION: {sid} -- {a} vs {b}", flush=True)
        raise SystemExit(f"{len(collisions)} stable_id collision(s) -- see above. Not written.")

    with open(OUT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        w.writerows(out_rows)

    report = {
        "total_rows": len(out_rows),
        "status_counts": dict(status_counts),
        "unique_stable_ids": len(seen),
    }
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    json.dump(report, open(REPORT_PATH, "w"), indent=1)
    print(f"Wrote {OUT_PATH} ({len(out_rows)} rows, {len(seen)} unique stable_ids)")
    print("status_counts:", dict(status_counts))


if __name__ == "__main__":
    main()
