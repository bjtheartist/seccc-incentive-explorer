#!/usr/bin/env python3
"""Deliverable 6 (consult Q3) -- Chicago Prize 18/18 CENSUS check, separate from
the IRS-filing SRS (Chicago Prize rows are award announcements, not 990 filing
rows -- a different evidence protocol, per consult Q3/Q7).

For every one of the 18 committed chicago_prize.csv rows: confirms it reaches
the export as a `foundation`-source record with the SAME amount, and that the
row carries a live, https, per-award announcement source_url (the citation the
CSV bridge to the outside announcement -- see data/curated/investment-inputs/
chicago_prize.csv). This is a structural completeness census (18/18 rows
present, dollars tie, every row cites its own announcement) -- NOT a live
re-fetch of each press release; that is a documented scope boundary, not a
silent gap.
"""
import csv
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSV_PATH = os.path.join(REPO, "data", "curated", "investment-inputs", "chicago_prize.csv")
EXPORT_PATH = os.path.join(REPO, "data", "private", "community-investment.json")
OUT_PATH = os.path.join(REPO, "data", "curated", "investment-inputs", "chicago_prize_census_check.json")

PRIZE_FUNDER = "Pritzker Traubert Foundation — Chicago Prize"


def main():
    source_rows = list(csv.DictReader(open(CSV_PATH)))
    export = json.load(open(EXPORT_PATH))
    prize_records = [r for r in export["records"] if r["source"] == "foundation" and r.get("funderName") == PRIZE_FUNDER]

    # Sol gate finding 4 (BLOCKER) -- "The checker can reuse one export record
    # for multiple announcement rows and, when an amount exists, does not
    # require the recipient to match." Fixed with (a) a CONSUMED set so a
    # record matched once is removed from the candidate pool for every
    # subsequent row, and (b) recipient match REQUIRED unconditionally,
    # amount match required IN ADDITION whenever the CSV publishes one --
    # never amount-only.
    consumed_ids = set()
    results = []
    ok = 0
    for i, row in enumerate(source_rows):
        want_amt = float(row["amount"]) if row.get("amount") else None
        # mapChicagoPrize maps `initiative` (not `recipient_orgs`) to the export
        # record's `recipient` field -- see scripts/export-community-investment.ts.
        want_recipient = (row.get("initiative") or "").strip()
        has_url = bool(row.get("source_url", "").strip().startswith("https://"))
        match = None
        for rec in prize_records:
            if rec["id"] in consumed_ids:
                continue
            rec_amt = rec.get("amountAwarded")
            recipient_match = bool(want_recipient) and want_recipient in (rec.get("recipient") or "")
            if not recipient_match:
                continue
            if want_amt is None:
                # A finalist/planning-stage row with no dollar figure yet
                # published -- the export must ALSO carry no amount (never a
                # stale/invented figure).
                if rec_amt is None:
                    match = rec
                    break
            elif rec_amt is not None and abs(rec_amt - want_amt) <= 0.5:
                match = rec
                break
        if match is not None:
            consumed_ids.add(match["id"])
        row_ok = match is not None and has_url
        if row_ok:
            ok += 1
        results.append({
            "csv_row": i, "initiative": want_recipient, "amount": want_amt,
            "matched_export_record_id": match["id"] if match else None,
            "has_announcement_url": has_url,
            "source_url": row.get("source_url"),
            "ok": row_ok,
        })

    # One-to-one: every consumed id must be unique by construction, but assert
    # it explicitly so a future refactor that reintroduces reuse fails loudly.
    matched_ids = [r["matched_export_record_id"] for r in results if r["matched_export_record_id"]]
    if len(matched_ids) != len(set(matched_ids)):
        raise SystemExit("Chicago Prize census: a record was matched to more than one row -- one-to-one violated.")

    report = {
        "design": "18/18 census check (every published Chicago Prize row, not a sample)",
        "scope_note": (
            "Structural completeness census, ONE-TO-ONE (a matched export record is consumed "
            "and never reused for a later row): confirms every committed chicago_prize.csv row "
            "reaches the export with a tying RECIPIENT and, when the source publishes one, a "
            "tying amount, and that the row carries its own https announcement source_url. This "
            "is citation PRESENCE ONLY -- it does NOT re-fetch or verify the content of each "
            "press release in this run; that is a documented scope boundary, and public copy "
            "describing this check must say citation presence, not that each announcement's "
            "content was independently confirmed."
        ),
        "csv_rows": len(source_rows),
        "export_prize_records": len(prize_records),
        "ok": ok,
        "total": len(source_rows),
        "all_ok": ok == len(source_rows),
        "one_to_one_verified": len(matched_ids) == len(set(matched_ids)),
        "rows": results,
    }
    json.dump(report, open(OUT_PATH, "w"), indent=1)
    print(f"Wrote {OUT_PATH}")
    print(f"Chicago Prize census: {ok}/{len(source_rows)} rows OK")
    if ok != len(source_rows):
        for r in results:
            if not r["ok"]:
                print("MISMATCH:", r)


if __name__ == "__main__":
    main()
