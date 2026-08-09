#!/usr/bin/env python3
"""
FEED 4 raw fetch: Chicago Business Licenses - Current Active (Socrata uupf-x98q).

Downloads the raw rows needed for categorization into the scratchpad. No
transformation, no invention: this script only pages the public Socrata
endpoint and writes what the API returned.

Source of truth:
  dataset id : uupf-x98q
  publisher  : City of Chicago / Dept. of Business Affairs & Consumer Protection
  verify URL : https://data.cityofchicago.org/d/uupf-x98q

Response format is JSON only. No XML is parsed anywhere in this feed, so no
DOCTYPE/ENTITY expansion surface exists.

Usage:
  python3 fetch_active_licenses.py --out /path/to/raw_active_licenses.json
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

DOMAIN = "data.cityofchicago.org"
DATASET_ID = "uupf-x98q"
RESOURCE = f"https://{DOMAIN}/resource/{DATASET_ID}.json"

# Only the columns this feed needs. Keeping the projection narrow keeps the
# raw pull small and makes the committed artifact's provenance obvious.
SELECT_COLS = [
    "license_id",
    "doing_business_as_name",
    "legal_name",
    "license_description",
    "business_activity",
    "address",
    "zip_code",
    "latitude",
    "longitude",
    "account_number",
    "site_number",
]

PAGE_SIZE = 10000
USER_AGENT = "seccc-funding-layer/site-activity-feed4 (public data pull)"


def _get(url, params, retries=4):
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status}")
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - surface after retries
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"request failed after {retries} attempts: {full}\n{last}")


def source_count():
    """COUNT(*) as the source itself reports it - the verification baseline."""
    rows = _get(RESOURCE, {"$select": "count(*) as n"})
    return int(rows[0]["n"])


def fetch_all():
    out = []
    offset = 0
    while True:
        page = _get(
            RESOURCE,
            {
                "$select": ",".join(SELECT_COLS),
                "$order": "license_id",
                "$limit": PAGE_SIZE,
                "$offset": offset,
            },
        )
        if not page:
            break
        out.extend(page)
        sys.stderr.write(f"  fetched {len(out)} rows\n")
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="path to write raw JSON")
    args = ap.parse_args()

    expected = source_count()
    sys.stderr.write(f"source COUNT(*) = {expected}\n")

    rows = fetch_all()
    sys.stderr.write(f"downloaded rows = {len(rows)}\n")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"source_count": expected, "rows": rows}, fh)

    if len(rows) != expected:
        sys.stderr.write(
            f"WARNING: downloaded {len(rows)} != source COUNT(*) {expected}. "
            "Do not publish until reconciled.\n"
        )
        return 1
    sys.stderr.write("row count reconciles with source COUNT(*)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
