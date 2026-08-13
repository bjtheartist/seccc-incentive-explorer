#!/usr/bin/env python3
"""Sol gate finding 2 -- synthetic, no-disk-I/O tests of the identity-stability
properties that build_grant_identity.py / filing_identity.py rely on:

  1. APPEND: adding a brand-new row (new foundation+year block, or a new row at
     the end of an EXISTING block) never changes an existing row's
     source_row_ordinal or stable_id.
  2. INSERT: adding a row into the MIDDLE of one (foundation, tax_year) block
     never changes ordinals/stable_ids for rows in a DIFFERENT block.
  3. UNIQUENESS: node_fingerprint/stable_id are namespaced by
     (tag, foundation, tax_year) so two different filings that happen to report
     identical recipient/amount/purpose text (the exact Robert R McCormick
     Foundation 2022-vs-2023 collision this fixes) never collide.
  4. SUPERSESSION: select_amended_resolved_filings resolves an
     original-vs-amended pair for the same (funder, tax_yr) to the
     higher-object_id (later-filed) return.

Exit code 0 = all assertions passed. Run via
scripts/__tests__/foundation-identity-stability.test.ts (execFileSync), so it
participates in `npm test` / CI like the manifest/docs clean-diff gates.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_grant_identity import assign_ordinals, node_fingerprint, stable_id  # noqa: E402
from filing_identity import select_amended_resolved_filings  # noqa: E402

FAILURES = []


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        FAILURES.append(name)


def synth_row(foundation, tax_year, recipient, amount, purpose="General support"):
    return {
        "foundation": foundation, "tax_year": tax_year, "recipient": recipient,
        "address_line1": "1 Test St", "city": "CHICAGO", "state": "IL",
        "zip": "60601", "amount": amount, "purpose": purpose, "source_form": "990-PF",
        "lat": "41.88", "lng": "-87.63", "locType": "sited",
    }


def full_identity(tag, rows):
    """Compute (ordinal, fingerprint, stable_id) for every row, unresolved-filing
    branch throughout (filing=None) -- exactly the fallback path the McCormick
    bug lived in."""
    out = []
    for row, ordinal in assign_ordinals(rows):
        fp = node_fingerprint(tag, row)
        sid = stable_id(tag, row, None, ordinal, fp)
        out.append({"row": row, "ordinal": ordinal, "fingerprint": fp, "stable_id": sid})
    return out


def main():
    # ── 1. APPEND: new row at the end of an existing block, plus a whole new
    #    block, must not move any existing row's identity. ──────────────────
    baseline_rows = [
        synth_row("Alpha Foundation", "2022", "Org A", "10000"),
        synth_row("Alpha Foundation", "2022", "Org B", "20000"),
        synth_row("Beta Foundation", "2023", "Org C", "30000"),
    ]
    baseline = full_identity("tier1", baseline_rows)
    baseline_by_key = {
        (r["row"]["foundation"], r["row"]["tax_year"], r["row"]["recipient"]): (r["ordinal"], r["stable_id"])
        for r in baseline
    }

    appended_rows = baseline_rows + [
        synth_row("Alpha Foundation", "2022", "Org D", "5000"),  # append to existing block
        synth_row("Gamma Foundation", "2024", "Org E", "1000"),  # append, brand-new block
    ]
    appended = full_identity("tier1", appended_rows)
    stable_after_append = all(
        (r["ordinal"], r["stable_id"])
        == baseline_by_key.get((r["row"]["foundation"], r["row"]["tax_year"], r["row"]["recipient"]), (r["ordinal"], r["stable_id"]))
        for r in appended
        if (r["row"]["foundation"], r["row"]["tax_year"], r["row"]["recipient"]) in baseline_by_key
    )
    check("APPEND: every pre-existing row keeps its exact ordinal + stable_id", stable_after_append)
    new_ids = {r["stable_id"] for r in appended} - {r["stable_id"] for r in baseline}
    check("APPEND: the two new rows get NEW stable_ids (no reuse)", len(new_ids) == 2)

    # ── 2. INSERT: a row inserted into the MIDDLE of block (Alpha, 2022) must
    #    not perturb block (Beta, 2023)'s ordinals/ids. ─────────────────────
    inserted_rows = [
        baseline_rows[0],
        synth_row("Alpha Foundation", "2022", "Org Z (inserted)", "9999"),  # NEW, mid-block
        baseline_rows[1],
        baseline_rows[2],  # Beta Foundation / 2023 / Org C
    ]
    inserted = full_identity("tier1", inserted_rows)
    beta_before = next(r for r in baseline if r["row"]["recipient"] == "Org C")
    beta_after = next(r for r in inserted if r["row"]["recipient"] == "Org C")
    check(
        "INSERT into one block: a DIFFERENT block's ordinal/stable_id is untouched",
        beta_before["ordinal"] == beta_after["ordinal"] and beta_before["stable_id"] == beta_after["stable_id"],
    )
    # Org B's ordinal INSIDE the Alpha/2022 block legitimately shifts (1 -> 2)
    # because a row was inserted before it in the SAME block -- that is
    # expected (the filing's own XML order is what should have determined this
    # in the first place; a same-block mid-insert is only possible via a fresh
    # re-parse of the SAME filing, which reproduces the filing's fixed node
    # order deterministically) and is a DIFFERENT scenario from finding 8's
    # cross-source drop-vs-hold interleaving bug.

    # ── 3. UNIQUENESS: the exact McCormick 2022-vs-2023 collision shape. ────
    mccormick_rows = [
        synth_row("Robert R McCormick Foundation", "2022", "NORTHWESTERN MEMORIAL HEALTHCARE", "500000", "Health"),
        synth_row("Robert R McCormick Foundation", "2023", "NORTHWESTERN MEMORIAL HEALTHCARE", "500000", "Health"),
    ]
    mccormick = full_identity("base", mccormick_rows)
    ids = [r["stable_id"] for r in mccormick]
    check(
        "UNIQUENESS: identical recipient/amount/purpose in DIFFERENT tax years never collides",
        ids[0] != ids[1],
    )
    fps = [r["fingerprint"] for r in mccormick]
    check("UNIQUENESS: node_fingerprint itself differs across tax years", fps[0] != fps[1])

    # ── 4. SUPERSESSION: original vs. amended return resolves to the newer
    #    (higher) object_id. ─────────────────────────────────────────────────
    recon_rows = [
        {
            "funder": "Test Foundation", "tax_yr": "2022", "object_id": "202203179349100001",
            "tax_period_begin": "2022-01-01", "tax_period_end": "2022-12-31", "amended": "N",
            "return_type": "990PF",
        },
        {
            # The amended return: same (funder, tax_yr), filed later, HIGHER
            # object_id, amended flag Y.
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
    # Order independence -- the rule must not depend on which row came first.
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
