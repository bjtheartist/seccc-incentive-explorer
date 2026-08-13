#!/usr/bin/env python3
"""Sol gate finding 2 (round 2) -- synthetic, no-disk-I/O tests of the
identity-stability properties build_grant_identity.py / filing_identity.py
rely on, verified against a FROZEN COMMITTED baseline fixture
(scripts/foundation/fixtures/identity_baseline.json, generated ONCE by a
throwaway script and checked in -- this test file NEVER regenerates it):

  1. MIDDLE-INSERT of a DISTINCT row: every OTHER baseline row's stable_id is
     BYTE-IDENTICAL to the frozen fixture, not merely "consistent with a
     freshly recomputed copy of itself" (round 1's defect).
  2. APPEND of a new row/block: same byte-identical guarantee.
  3. The DOCUMENTED IDENTICAL-DUPLICATE BOUNDARY (see
     build_grant_identity.py's module docstring): the fixture's own Org B
     duplicate pair gets occurrence suffixes 0/1, asserted explicitly here,
     with the narrow case where the guarantee does NOT extend (inserting a
     THIRD identical-content row between them) also asserted and explained.
  4. UNIQUENESS: node_fingerprint/stable_id are namespaced by
     (tag, foundation, tax_year) so two different filings that happen to
     report identical recipient/amount/purpose text (the exact Robert R
     McCormick Foundation 2022-vs-2023 collision this fixes) never collide.
  5. SUPERSESSION: select_amended_resolved_filings resolves an
     original-vs-amended pair for the same (funder, tax_yr) to the
     higher-object_id (later-filed) return.

Exit code 0 = all assertions passed. Run via
scripts/__tests__/foundation-identity-stability.test.ts (execFileSync), so it
participates in `npm test` / CI like the manifest/docs clean-diff gates.
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_grant_identity import assign_occurrence_indices, node_fingerprint, stable_id  # noqa: E402
from filing_identity import select_amended_resolved_filings  # noqa: E402

FAILURES = []
FIXTURE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "identity_baseline.json")


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        FAILURES.append(name)


def synth_row(foundation, tax_year, recipient, amount, purpose="General support", address="1 Test St"):
    return {
        "foundation": foundation, "tax_year": tax_year, "recipient": recipient,
        "address_line1": address, "city": "CHICAGO", "state": "IL",
        "zip": "60601", "amount": amount, "purpose": purpose, "source_form": "990-PF",
        "lat": "41.88", "lng": "-87.63", "locType": "sited",
    }


def full_identity(tag, rows):
    """Compute (occurrence, fingerprint, stable_id) for every row,
    unresolved-filing branch throughout (filing=None) -- exactly the fallback
    path the McCormick bug lived in, and the same branch the frozen fixture
    was generated against."""
    out = []
    for row, occurrence in assign_occurrence_indices(rows):
        fp = node_fingerprint(tag, row)
        sid = stable_id(tag, row, None, occurrence, fp)
        out.append({"row": row, "occurrence": occurrence, "fingerprint": fp, "stable_id": sid})
    return out


def row_key(row):
    return (row["foundation"], row["tax_year"], row["recipient"], row["amount"], row["purpose"])


def main():
    fixture = json.load(open(FIXTURE_PATH))
    tag = fixture["tag"]
    baseline_rows = fixture["baseline_rows"]
    baseline_identities = fixture["baseline_identities"]
    # Positional correspondence: assign_occurrence_indices/full_identity
    # preserve input order (verified by construction in
    # build_grant_identity.py), so baseline_identities[i] is the frozen
    # ground truth for baseline_rows[i] -- INDEXED, not content-keyed, because
    # two genuinely-identical rows (the Org B pair) share the same content and
    # would collide as a dict key. Matching is done by Python object identity
    # (`is`) below: the SAME baseline_rows[i] object reference is reused
    # (never copied) when building every modified row list, so `is` reliably
    # identifies "this is still the same original row" even after a
    # middle-insert or append.
    check(
        "frozen fixture loaded with the expected row/identity counts",
        len(baseline_rows) == 6 and len(baseline_identities) == 6,
    )
    frozen_by_object_id = {
        id(baseline_rows[i]): (baseline_identities[i]["occurrence"], baseline_identities[i]["stable_id"])
        for i in range(len(baseline_rows))
    }

    def check_baseline_preserved(modified_rows, label):
        computed = full_identity(tag, modified_rows)
        mismatches = []
        for r in computed:
            frozen = frozen_by_object_id.get(id(r["row"]))
            if frozen is None:
                continue  # a newly added row, not part of the frozen baseline
            if (r["occurrence"], r["stable_id"]) != frozen:
                mismatches.append((row_key(r["row"]), frozen, (r["occurrence"], r["stable_id"])))
        check(label, len(mismatches) == 0)
        if mismatches:
            print("  mismatches:", mismatches)
        return computed

    # ── 1. MIDDLE-INSERT of a DISTINCT row into the Alpha/2022 block -- every
    #    OTHER baseline row's (occurrence, stable_id) must be BYTE-IDENTICAL
    #    to the frozen fixture. ───────────────────────────────────────────────
    distinct_insert = synth_row("Alpha Foundation", "2022", "Org Z (inserted, distinct)", "9999", "Distinct purpose")
    middle_inserted_rows = baseline_rows[:2] + [distinct_insert] + baseline_rows[2:]
    check_baseline_preserved(
        middle_inserted_rows,
        "MIDDLE-INSERT of a distinct row: every OTHER baseline row is BYTE-IDENTICAL to the frozen fixture (zero downstream renumbering)",
    )

    # ── 2. APPEND -- a new row at the end of an existing block, plus a whole
    #    new block, same byte-identical guarantee for every baseline row. ────
    new_row_1 = synth_row("Alpha Foundation", "2022", "Org F (appended, distinct)", "6000")
    new_row_2 = synth_row("Gamma Foundation", "2024", "Org G (new block)", "7000")
    appended_rows = baseline_rows + [new_row_1, new_row_2]
    appended = check_baseline_preserved(
        appended_rows, "APPEND: every baseline row is BYTE-IDENTICAL to the frozen fixture"
    )
    new_sids = {r["stable_id"] for r in appended if id(r["row"]) not in frozen_by_object_id}
    check("APPEND: the two new rows get NEW stable_ids (no reuse)", len(new_sids) == 2)

    # ── 3. DOCUMENTED IDENTICAL-DUPLICATE BOUNDARY (build_grant_identity.py's
    #    module docstring). The fixture's Org B pair (genuinely identical
    #    content) gets occurrence suffixes 0 and 1 -- asserted against the
    #    frozen values. ───────────────────────────────────────────────────────
    org_b_frozen = [frozen_by_object_id[id(r)] for r in baseline_rows if r["recipient"].startswith("Org B")]
    check(
        "IDENTICAL-DUPLICATE BOUNDARY: the frozen fixture's Org B pair has occurrence suffixes {0, 1}",
        sorted(occ for occ, _ in org_b_frozen) == [0, 1],
    )
    check(
        "IDENTICAL-DUPLICATE BOUNDARY: the two Org B stable_ids are DIFFERENT from each other despite identical content",
        len({sid for _, sid in org_b_frozen}) == 2,
    )
    # The narrow, DOCUMENTED exception: inserting a THIRD row with the SAME
    # content as the Org B pair, BETWEEN them, reassigns which one gets
    # suffix 1 vs 2 -- there is no content left to key on among identical
    # rows, so THIS specific case is explicitly out of scope for the
    # middle-insert guarantee (see the module docstring's "DOCUMENTED
    # BOUNDARY" paragraph). Asserted here so the boundary is proven, not
    # merely claimed.
    org_b_rows = [r for r in baseline_rows if r["recipient"].startswith("Org B")]
    first_b_row, second_b_row = org_b_rows[0], org_b_rows[1]
    third_identical = dict(first_b_row)  # a THIRD row, byte-identical content to the Org B pair
    idx_first_b = baseline_rows.index(first_b_row)
    rows_with_third_identical_inserted_between = (
        baseline_rows[: idx_first_b + 1] + [third_identical] + baseline_rows[idx_first_b + 1 :]
    )
    perturbed = full_identity(tag, rows_with_third_identical_inserted_between)
    second_b_after = next(r for r in perturbed if r["row"] is second_b_row)
    frozen_second_b_occurrence = frozen_by_object_id[id(second_b_row)][0]
    check(
        "IDENTICAL-DUPLICATE BOUNDARY (documented exception): inserting a THIRD identical-content row BETWEEN an "
        "existing identical pair DOES perturb the second row's occurrence suffix (1 -> 2) -- this is the one "
        "case content-based identity cannot make position-independent, and it is explicitly out of scope",
        second_b_after["occurrence"] == frozen_second_b_occurrence + 1,
    )

    # ── 4. UNIQUENESS: the exact McCormick 2022-vs-2023 collision shape. ────
    mccormick_rows = [
        synth_row("Robert R McCormick Foundation", "2022", "NORTHWESTERN MEMORIAL HEALTHCARE", "500000", "Health"),
        synth_row("Robert R McCormick Foundation", "2023", "NORTHWESTERN MEMORIAL HEALTHCARE", "500000", "Health"),
    ]
    mccormick = full_identity("base", mccormick_rows)
    ids = [r["stable_id"] for r in mccormick]
    check("UNIQUENESS: identical recipient/amount/purpose in DIFFERENT tax years never collides", ids[0] != ids[1])
    fps = [r["fingerprint"] for r in mccormick]
    check("UNIQUENESS: node_fingerprint itself differs across tax years", fps[0] != fps[1])

    # ── 5. SUPERSESSION: original vs. amended return resolves to the newer
    #    (higher) object_id. ─────────────────────────────────────────────────
    recon_rows = [
        {
            "funder": "Test Foundation", "tax_yr": "2022", "object_id": "202203179349100001",
            "tax_period_begin": "2022-01-01", "tax_period_end": "2022-12-31", "amended": "N",
            "return_type": "990PF",
        },
        {
            "funder": "Test Foundation", "tax_yr": "2022", "object_id": "202303179349100099",
            "tax_period_begin": "2022-01-01", "tax_period_end": "2022-12-31", "amended": "Y",
            "return_type": "990PF",
        },
    ]
    resolved = select_amended_resolved_filings(recon_rows)
    winner = resolved[("Test Foundation", "2022")]
    check(
        "SUPERSESSION: the amended (higher object_id) return wins over the original",
        winner["object_id"] == "202303179349100099" and winner["amended"] == "Y",
    )
    resolved_reversed = select_amended_resolved_filings(list(reversed(recon_rows)))
    check(
        "SUPERSESSION: resolution is order-independent",
        resolved_reversed[("Test Foundation", "2022")]["object_id"] == "202303179349100099",
    )

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("All identity-stability assertions passed.")


if __name__ == "__main__":
    main()
