#!/usr/bin/env python3
"""Sol gate finding 4 (round 2) -- synthetic, no-disk-I/O adversarial fixtures
for chicago_prize_census_check.py's match_prize_rows(): a same-amount but
WRONG-recipient row must come back UNMATCHED (never a false positive on
amount alone), and two announcement rows competing for the SAME export
record must leave exactly one matched -- consumed-tracking blocking reuse,
never a double-match.

Exit code 0 = all assertions passed. Run via
scripts/__tests__/chicago-prize-adversarial.test.ts (execFileSync).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chicago_prize_census_check import match_prize_rows  # noqa: E402

FAILURES = []


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        FAILURES.append(name)


def main():
    # ── 1. Same amount, WRONG recipient -- must NOT match. ──────────────────
    source_rows = [
        {"initiative": "Totally Unrelated Initiative", "amount": "10000000", "source_url": "https://example.org/announcement"},
    ]
    prize_records = [
        {"id": "prize-0", "recipient": "Always Growing, Auburn Gresham (Chicago Prize winner)", "amountAwarded": 10000000.0},
    ]
    results, ok = match_prize_rows(source_rows, prize_records)
    check(
        "wrong-recipient/same-amount row is reported UNMATCHED (not a false positive on amount alone)",
        results[0]["matched_export_record_id"] is None and not results[0]["ok"],
    )
    check("wrong-recipient row does not count toward `ok`", ok == 0)

    # ── 2. Two announcement rows compete for ONE export record -- exactly one
    #    matches; consumed-tracking blocks reuse for the second. ────────────
    source_rows2 = [
        {"initiative": "Sankofa Wellness Village (Chicago Prize winner)", "amount": "10000000", "source_url": "https://example.org/a1"},
        # A second row with the SAME initiative text and amount -- competing
        # for the identical single export record.
        {"initiative": "Sankofa Wellness Village (Chicago Prize winner)", "amount": "10000000", "source_url": "https://example.org/a2"},
    ]
    prize_records2 = [
        {"id": "prize-7", "recipient": "Sankofa Wellness Village (Chicago Prize winner)", "amountAwarded": 10000000.0},
    ]
    results2, ok2 = match_prize_rows(source_rows2, prize_records2)
    matched_ids2 = [r["matched_export_record_id"] for r in results2 if r["matched_export_record_id"]]
    check(
        "exactly ONE of the two competing rows matches the single export record",
        len(matched_ids2) == 1 and matched_ids2[0] == "prize-7",
    )
    check(
        "the SECOND competing row is left UNMATCHED (consumed-tracking blocks reuse, never a double-match)",
        results2[1]["matched_export_record_id"] is None and not results2[1]["ok"],
    )
    check("only one row counts as ok even though two rows wanted the same record", ok2 == 1)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("All adversarial Chicago Prize matching assertions passed.")


if __name__ == "__main__":
    main()
