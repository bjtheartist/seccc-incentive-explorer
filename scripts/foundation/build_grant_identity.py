#!/usr/bin/env python3
"""Deliverable 2 -- stable identity threaded into every published foundation row.

For each row in the four published foundation files, resolves and writes:
  filing_object_id, tax_period_begin, tax_period_end, amended, schedule_part,
  source_row_ordinal (see IDENTITY MODEL below), node_fingerprint (content
  hash for collision disambiguation), stable_id.

IDENTITY MODEL (Sol gate finding 2, round 2 -- "IDs must survive a middle
insert of a DISTINCT row with zero downstream renumbering"):

  stable_id is derived from the row's OWN CONTENT (recipient, amount,
  purpose, address_line1 -- see content_key()) within the (filing object id,
  schedule/part) namespace for a resolved filing, or the
  (tag, foundation, tax_year) namespace as a fallback when the filing did not
  resolve. It NEVER depends on the row's raw position in the committed CSV.

  The `source_row_ordinal` column is NOT a CSV position. It is an
  OCCURRENCE INDEX: how many EARLIER rows in the same (foundation, tax_year)
  block share this row's EXACT content_key. It is 0 for every row whose
  content is unique within its block -- the overwhelming majority -- which is
  why inserting, at ANY position, a row whose content differs from every
  other row in its block changes NO other row's stable_id: the occurrence
  counter for a given content_key only advances when ANOTHER row with that
  SAME content_key is encountered, and counting is keyed by content, not by
  position.

  DOCUMENTED BOUNDARY: when a filing genuinely contains two or more
  IDENTICAL rows (the audit's 236 duplicate-candidate groups -- e.g. the Arie
  and Ida Crown Memorial / START EARLY $1,000,000 pair, where the FILING
  ITSELF lists the same recipient/amount/purpose/address twice), those rows
  are, by definition, indistinguishable by content alone. The ONLY way to
  give them distinct ids is an OCCURRENCE SUFFIX (0, 1, 2, ...) counted
  strictly WITHIN that identical set. This suffix IS positionally sensitive
  in one narrow case: inserting a THIRD row with the SAME content as an
  existing identical pair, between them, reassigns which of the (still only
  content-indistinguishable) rows gets suffix 0 vs 1 vs 2. This is accepted
  as an inherent limit of content-based identity applied to genuinely
  identical source rows -- there is no content left to key on -- and is
  DELIBERATELY OUT OF SCOPE for the "survives a middle insert" guarantee,
  which applies to inserting a DISTINCT row (the common, real case: a fresh
  parse of a NEW or re-filed return). It never affects a row whose content is
  unique in its block, which is the overwhelming majority of the ~26,501-row
  universe (only 504 of 26,501 rows -- 1.9% -- fall into a duplicate-content
  group at all).

Output: data/curated/investment-inputs/foundation_grant_identity.csv, joined
by (file, raw_idx) -- raw_idx is the row's 0-based position in the CSV
INCLUDING placeholder rows the exporter later drops, so the JOIN key is
stable regardless of the exporter's own filtering. raw_idx is used ONLY to
join this file back to the source CSV row for lookup -- never as an input to
stable_id.

scripts/export-community-investment.ts reads this file in mapFoundations()
and persists each record's stableId alongside (never replacing) the existing
positional `foundation-N` id.
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


def content_key(row):
    """The row's OWN content signature -- recipient + amount + purpose +
    address, normalized. THIS, not CSV position, is what stable_id derives
    from (Sol gate finding 2). Two rows with the same content_key in the same
    (foundation, tax_year) block are the "genuinely identical duplicate"
    case documented in the module docstring above."""
    return "|".join([
        fi.norm_text(row.get("recipient")),
        str(row.get("amount") or "").strip(),
        fi.norm_text(row.get("purpose")),
        fi.norm_text(row.get("address_line1")),
    ])


def node_fingerprint(tag, row):
    # Sol gate finding 2 (round 1) -- foundation + tax_year MUST be in the
    # fingerprint. Without them, two DIFFERENT filings (e.g. the same
    # funder's 2022 and 2023 returns) that happen to report the same
    # recipient/amount/purpose collide: this exact bug produced a duplicate
    # stable_id for Robert R McCormick Foundation's 2022 and 2023 grants to
    # Northwestern Memorial Healthcare.
    key = "|".join([
        tag,
        fi.norm_text(row.get("foundation")),
        (row.get("tax_year") or "").strip(),
        content_key(row),
    ])
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def stable_id(tag, row, filing, occurrence, fingerprint):
    if filing is None:
        # No resolvable filing -- fall back to a fingerprint-only id so the row
        # STILL gets a content-derived, non-positional identifier; identity_status
        # records the degradation so it's never silently mistaken for a verified
        # filing-bound id. `occurrence` here disambiguates only genuinely
        # identical rows (see module docstring) -- it is 0 for every row whose
        # content is unique in its block.
        key = "|".join([
            "unresolved", tag, fi.norm_text(row.get("foundation")),
            (row.get("tax_year") or "").strip(), fingerprint, str(occurrence),
        ])
        return hashlib.sha256(key.encode()).hexdigest()[:16]
    # Resolved branch: node-content fingerprint WITHIN the (filing object,
    # schedule/part) namespace -- exactly Sol gate finding 2's required shape.
    key = f"{filing['object_id']}|{filing['tax_period_end']}|{filing['schedule_part']}|{fingerprint}|{occurrence}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def assign_occurrence_indices(rows):
    """[(row, occurrence_index)] -- occurrence_index = how many EARLIER rows
    (in the given list's order) within the SAME (foundation, tax_year) block
    share this row's EXACT content_key. 0 for a row whose content is unique
    in its block (the overwhelming majority); 0, 1, 2, ... only within a
    group of genuinely IDENTICAL rows.

    Because the counter is keyed by (foundation, tax_year, content_key)
    rather than raw position, inserting a DISTINCT row anywhere in the block
    -- start, middle, or end -- changes NO other row's occurrence_index or
    stable_id: the count for a given content_key only advances when ANOTHER
    row with that SAME content_key is seen. Pure -- no disk I/O, no network --
    exercised directly by test_identity_stability.py's middle-insert/append
    fixtures against a FROZEN COMMITTED baseline (never regenerated by the
    test itself).
    """
    seen_counts = defaultdict(int)
    out = []
    for row in rows:
        block_key = (
            (row.get("foundation") or "").strip(),
            (row.get("tax_year") or "").strip(),
            content_key(row),
        )
        occurrence = seen_counts[block_key]
        seen_counts[block_key] += 1
        out.append((row, occurrence))
    return out


def main():
    rows_by_tag = fi.load_foundation_rows()
    recon_indexes = {tag: fi.build_recon_index(tag) for tag in ("tier1", "phase2", "phase3")}
    base_eins = fi.base_funder_eins()

    out_rows = []
    status_counts = defaultdict(int)

    for tag, rows in rows_by_tag.items():
        for row, occurrence in assign_occurrence_indices(rows):
            filing = fi.resolve_filing_for_row(tag, row, recon_indexes, base_eins)
            fp = node_fingerprint(tag, row)

            status = "unresolved_filing"
            if filing is not None:
                status = "resolved"
                grants = fi.filing_grants(filing["object_id"])
                if grants is not None:
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
                "source_row_ordinal": occurrence,
                "node_fingerprint": fp,
                "stable_id": stable_id(tag, row, filing, occurrence, fp),
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
