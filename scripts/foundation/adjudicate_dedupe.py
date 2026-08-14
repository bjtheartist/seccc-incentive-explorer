#!/usr/bin/env python3
"""Deliverable 3 -- adjudicate the indistinguishable foundation groups.

Scans all four published foundation files for rows sharing (funder, recipient,
address, amount, tax_year, purpose) -- the same key the audit used to find 236
groups / 504 rows. For every group with 2+ rows, resolves the filing behind it
and re-fetches/parses that filing's own grant schedule to count how many
matching grant nodes the FILING ITSELF contains (`filing_match_count`):

  filing_match_count >= csv_group_count
    -> KEEP ALL, flagged: "Two source line items; award-level distinctness not
       independently verified." (consult Q1 default -- the filing really does
       publish that many identical-looking rows; that alone doesn't prove or
       disprove two distinct awards)

  filing_match_count < csv_group_count
    -> COLLAPSE the excess: this proves the CSV/extractor produced MORE copies
       than the filing publishes -- extractor duplication (consult Q1 collapse
       criterion 4, direct filing inspection). Drop (csv_group_count -
       filing_match_count) rows, keep filing_match_count.

  filing unresolved/unparseable
    -> KEEP ALL, flagged, evidence "identity unresolved -- defaulted to
       keep-with-flag (safe default)."

Output:
  data/curated/investment-inputs/foundation_dedupe_ledger.json -- per-group
    verdict, evidence, dollars, and the (file, raw_idx) rows involved.
  data/curated/investment-inputs/foundation_dedupe_actions.csv -- one row per
    (file, raw_idx) with action in {keep, keep-flagged, collapse} and the flag
    text -- exactly what scripts/export-community-investment.ts joins against.
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import filing_identity as fi  # noqa: E402

LEDGER_PATH = os.path.join(fi.INPUTS, "foundation_dedupe_ledger.json")
ACTIONS_PATH = os.path.join(fi.INPUTS, "foundation_dedupe_actions.csv")
FLAG_TEXT = "Two source line items; award-level distinctness not independently verified."


def group_key(row):
    return (
        fi.norm_text(row.get("foundation")),
        fi.norm_text(row.get("recipient")),
        fi.norm_text(row.get("address_line1")),
        (row.get("amount") or "").strip(),
        (row.get("tax_year") or "").strip(),
        fi.norm_text(row.get("purpose")),
    )


def main():
    rows_by_tag = fi.load_foundation_rows()
    recon_indexes = {tag: fi.build_recon_index(tag) for tag in ("tier1", "phase2", "phase3")}
    base_eins = fi.base_funder_eins()

    groups = defaultdict(list)  # key -> [(tag, row), ...]
    for tag, rows in rows_by_tag.items():
        for row in rows:
            if not (row.get("amount") or "").strip():
                continue
            groups[group_key(row)].append((tag, row))

    candidate_groups = {k: v for k, v in groups.items() if len(v) >= 2}
    print(f"candidate groups: {len(candidate_groups)}", flush=True)

    ledger = []
    actions = []  # {file, raw_idx, action, flag}
    collapsed_rows = 0
    collapsed_dollars = 0.0
    flagged_rows = 0
    flagged_dollars = 0.0
    arie_crown_note = None

    for n, (key, members) in enumerate(sorted(candidate_groups.items()), 1):
        tag0, row0 = members[0]
        filing = fi.resolve_filing_for_row(tag0, row0, recon_indexes, base_eins)
        amount = float(row0.get("amount") or 0)
        csv_group_count = len(members)

        filing_match_count = None
        evidence = ""
        if filing is None:
            verdict = "kept-flagged"
            evidence = "identity unresolved -- defaulted to keep-with-flag (safe default)."
        else:
            grants = fi.filing_grants(filing["object_id"])
            if grants is None:
                verdict = "kept-flagged"
                evidence = f"filing {filing['object_id']} unfetchable/unparseable -- defaulted to keep-with-flag."
            else:
                want_r = fi.norm_text(row0.get("recipient"))
                want_addr = fi.norm_text(row0.get("address_line1"))
                want_purpose = fi.norm_text(row0.get("purpose"))
                # Sol gate finding 9 -- include purpose in the filing comparison
                # (in addition to recipient/amount/address) going forward, so a
                # future group with the SAME recipient/amount/address but a
                # DIFFERENT stated purpose is not silently treated as identical.
                # Purpose text is the least standardized of the four fields
                # (free text, prone to filer-side truncation/paraphrase), so it
                # only NARROWS a match when both sides have a non-empty purpose
                # that actually differs -- an empty purpose on either side never
                # blocks a match on the other three fields.
                filing_match_count = sum(
                    1 for g in grants
                    if g["amount"] is not None and abs(g["amount"] - amount) <= 0.5
                    and fi.norm_text(g["recipient"]) == want_r
                    and fi.norm_text(g["address_line1"]) == want_addr
                    and (not want_purpose or not fi.norm_text(g.get("purpose")) or fi.norm_text(g.get("purpose")) == want_purpose)
                )
                if filing_match_count >= csv_group_count:
                    verdict = "kept-flagged"
                    evidence = (
                        f"Filing {filing['object_id']} itself contains {filing_match_count} matching "
                        f"grant row(s) for this recipient/amount/address -- {FLAG_TEXT}"
                    )
                else:
                    verdict = "collapsed"
                    evidence = (
                        f"Filing {filing['object_id']} contains only {filing_match_count} matching grant "
                        f"row(s) but the CSV carries {csv_group_count} -- extractor duplication proven by "
                        f"direct filing inspection; collapsed to {filing_match_count}."
                    )

        group_members = [
            {"file": fi.FOUNDATION_FILES[tag], "raw_idx": row["raw_idx"]} for tag, row in members
        ]
        ledger.append({
            "group_id": n,
            "funder": row0.get("foundation"),
            "recipient": row0.get("recipient"),
            "address_line1": row0.get("address_line1"),
            "amount": amount,
            "tax_year": row0.get("tax_year"),
            "purpose": row0.get("purpose"),
            "csv_group_count": csv_group_count,
            "filing_object_id": filing["object_id"] if filing else None,
            "filing_match_count": filing_match_count,
            "verdict": verdict,
            "evidence": evidence,
            "dollars_at_stake": round(amount * (csv_group_count - 1), 2),
            "members": group_members,
        })

        if verdict == "collapsed":
            excess = csv_group_count - (filing_match_count or 0)
            collapsed_rows += excess
            collapsed_dollars += amount * excess
            for tag, row in members[:excess]:
                actions.append({"file": fi.FOUNDATION_FILES[tag], "raw_idx": row["raw_idx"], "action": "collapse", "flag": ""})
            for tag, row in members[excess:]:
                actions.append({"file": fi.FOUNDATION_FILES[tag], "raw_idx": row["raw_idx"], "action": "keep", "flag": ""})
        else:
            flagged_rows += csv_group_count
            flagged_dollars += amount * csv_group_count
            for tag, row in members:
                actions.append({"file": fi.FOUNDATION_FILES[tag], "raw_idx": row["raw_idx"], "action": "keep-flagged", "flag": FLAG_TEXT})

        # Sol gate finding 9 (LOW) -- the funder is "Arie and Ida Crown Memorial",
        # not "Arie Crown"; the exact-substring check above never matched. Fixed
        # to test for the normalized tokens that are actually present.
        funder_norm = fi.norm_text(row0.get("foundation"))
        if "ARIE" in funder_norm and "CROWN" in funder_norm and "START EARLY" in fi.norm_text(row0.get("recipient")):
            arie_crown_note = ledger[-1]

        if n % 25 == 0:
            print(f"[{n}/{len(candidate_groups)}] collapsed_rows={collapsed_rows} flagged_rows={flagged_rows}", flush=True)

    summary = {
        "candidate_groups": len(candidate_groups),
        "candidate_rows": sum(len(v) for v in candidate_groups.values()),
        "collapsed_rows": collapsed_rows,
        "collapsed_dollars": round(collapsed_dollars, 2),
        "kept_flagged_groups": sum(1 for g in ledger if g["verdict"] == "kept-flagged"),
        "kept_flagged_rows": flagged_rows,
        "kept_flagged_dollars": round(flagged_dollars, 2),
        "arie_crown_start_early": arie_crown_note,
    }

    json.dump({"summary": summary, "groups": ledger}, open(LEDGER_PATH, "w"), indent=1)
    with open(ACTIONS_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file", "raw_idx", "action", "flag"])
        w.writeheader()
        w.writerows(actions)

    print(f"Wrote {LEDGER_PATH}")
    print(f"Wrote {ACTIONS_PATH}")
    print("SUMMARY:", json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
