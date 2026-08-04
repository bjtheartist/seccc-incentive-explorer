#!/usr/bin/env python3
"""
FEED 4 build: categorize Chicago active business licenses into the compact artifact.

Input : raw JSON from fetch_active_licenses.py
Rules : license_categories.json (committed alongside this script)
Output: data/curated/site-activity/active_licenses_compact.csv
        columns -> license_id, name, category, lat, lng

Honesty rules enforced here:
  * Every output row traces to one source license row by license_id.
  * Rows without BOTH latitude and longitude are DROPPED and COUNTED. They are
    never given a placeholder, a centroid, or an interpolated coordinate.
  * Categorization is exact-string matching only (see license_categories.json for
    why substring matching is unsafe on this data). Unmatched -> "other".
  * No coefficients, capture rates, visitor counts, or synthesized values exist
    anywhere in this pipeline. The artifact reports licenses, nothing more.

Usage:
  python3 build_active_licenses.py --raw RAW.json --rules license_categories.json \
      --out ../../data/curated/site-activity/active_licenses_compact.csv \
      --stats-out /tmp/feed4_stats.json
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter

MAX_ARTIFACT_BYTES = 10 * 1024 * 1024  # 10 MB budget from the build spec

# Chicago bounding box, used ONLY to detect obviously-corrupt coordinates
# (e.g. 0,0 nulls-as-zero). Rows outside are dropped and counted, never moved.
CHI_LAT = (41.60, 42.10)
CHI_LNG = (-87.95, -87.50)


def load_rules(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def split_activity(value):
    """business_activity is '|'-separated. Return trimmed, non-empty parts."""
    if not value:
        return []
    return [p.strip() for p in value.split("|") if p.strip()]


class Categorizer:
    def __init__(self, rules):
        self.precedence = rules["category_precedence"]

        # tier 1: exact license_description -> category
        self.t1 = {}
        for cat, vals in rules["tier1_license_description_exact"].items():
            if cat.startswith("_"):
                continue
            for v in vals:
                self.t1[v] = cat

        # tier 2: ordered food split for Retail Food Establishment
        f = rules["tier2_food_split"]
        self.food_desc = f["applies_to_license_description"]
        self.food_steps = [
            (set(f["step_a_dining_on_premises__restaurant_cafe"]), "restaurant_cafe"),
            (set(f["step_b_perishable_food_retail__grocery"]), "grocery"),
            (set(f["step_c_prepared_food_no_seating__restaurant_cafe"]), "restaurant_cafe"),
            (set(f["step_d_non_perishable_only__retail_general"]), "retail_general"),
        ]

        # tier 3: exact business_activity token -> set of categories
        self.t3 = {}
        for cat, vals in rules["tier3_business_activity_exact"].items():
            if cat.startswith("_"):
                continue
            for v in vals:
                self.t3.setdefault(v, set()).add(cat)

        self.rank = {c: i for i, c in enumerate(self.precedence)}

    def categorize(self, row):
        """Return (category, tier_that_decided)."""
        desc = (row.get("license_description") or "").strip()

        # --- tier 1 -------------------------------------------------------
        if desc in self.t1:
            return self.t1[desc], "tier1_license_description"

        tokens = split_activity(row.get("business_activity"))

        # --- tier 2: food split, ordered, first step that hits wins -------
        if desc == self.food_desc:
            for step_tokens, cat in self.food_steps:
                if any(t in step_tokens for t in tokens):
                    return cat, "tier2_food_split"
            return "other", "tier2_food_unmatched"

        # --- tier 3: exact activity tokens, precedence resolves ties ------
        hits = set()
        for t in tokens:
            hits |= self.t3.get(t, set())
        if hits:
            best = min(hits, key=lambda c: self.rank[c])
            return best, "tier3_business_activity"

        return "other", "unmatched"


def parse_coord(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stats-out")
    ap.add_argument(
        "--drop-name",
        action="store_true",
        help="omit the name column (used only if the artifact exceeds 10 MB)",
    )
    args = ap.parse_args()

    with open(args.raw, encoding="utf-8") as fh:
        payload = json.load(fh)
    rows = payload["rows"]
    source_count = payload.get("source_count")

    if source_count is not None and len(rows) != source_count:
        sys.stderr.write(
            f"ABORT: raw rows {len(rows)} != source COUNT(*) {source_count}\n"
        )
        return 1

    cat = Categorizer(load_rules(args.rules))

    stats = {
        "source_count": source_count,
        "raw_rows": len(rows),
        "dropped_no_coordinates": 0,
        "dropped_outside_chicago_bbox": 0,
        "dropped_missing_license_id": 0,
        "written_rows": 0,
        "by_category": Counter(),
        "by_tier": Counter(),
        "dropped_no_coords_by_category": Counter(),
    }

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    fields = ["license_id", "name", "category", "lat", "lng"]
    if args.drop_name:
        fields = ["license_id", "category", "lat", "lng"]

    seen_ids = set()
    dup_ids = 0

    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(fields)

        for r in rows:
            category, tier = cat.categorize(r)
            stats["by_tier"][tier] += 1

            lic = (r.get("license_id") or "").strip()
            if not lic:
                stats["dropped_missing_license_id"] += 1
                continue

            lat = parse_coord(r.get("latitude"))
            lng = parse_coord(r.get("longitude"))
            if lat is None or lng is None:
                stats["dropped_no_coordinates"] += 1
                stats["dropped_no_coords_by_category"][category] += 1
                continue
            if not (CHI_LAT[0] <= lat <= CHI_LAT[1] and CHI_LNG[0] <= lng <= CHI_LNG[1]):
                stats["dropped_outside_chicago_bbox"] += 1
                continue

            if lic in seen_ids:
                dup_ids += 1
            seen_ids.add(lic)

            name = (r.get("doing_business_as_name") or r.get("legal_name") or "").strip()

            # 5 decimal places ~= 1.1 m. Enough for site context, keeps bytes down.
            if args.drop_name:
                w.writerow([lic, category, f"{lat:.5f}", f"{lng:.5f}"])
            else:
                w.writerow([lic, name, category, f"{lat:.5f}", f"{lng:.5f}"])

            stats["written_rows"] += 1
            stats["by_category"][category] += 1

    size = os.path.getsize(out_path)
    stats["artifact_bytes"] = size
    stats["artifact_mb"] = round(size / 1024 / 1024, 3)
    stats["duplicate_license_ids"] = dup_ids
    stats["by_category"] = dict(stats["by_category"])
    stats["by_tier"] = dict(stats["by_tier"])
    stats["dropped_no_coords_by_category"] = dict(stats["dropped_no_coords_by_category"])

    # reconciliation: written + all drops must equal the raw row count
    accounted = (
        stats["written_rows"]
        + stats["dropped_no_coordinates"]
        + stats["dropped_outside_chicago_bbox"]
        + stats["dropped_missing_license_id"]
    )
    stats["reconciles"] = accounted == stats["raw_rows"]

    sys.stderr.write(json.dumps(stats, indent=2) + "\n")
    if args.stats_out:
        with open(args.stats_out, "w", encoding="utf-8") as fh:
            json.dump(stats, fh, indent=2)

    if not stats["reconciles"]:
        sys.stderr.write("ABORT: row accounting does not reconcile\n")
        return 1
    if size > MAX_ARTIFACT_BYTES and not args.drop_name:
        sys.stderr.write(
            f"NOTE: artifact is {stats['artifact_mb']} MB (> 10 MB). "
            "Re-run with --drop-name.\n"
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
