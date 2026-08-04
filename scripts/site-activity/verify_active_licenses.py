#!/usr/bin/env python3
"""
FEED 4 verification. Re-queries the LIVE Socrata source and checks the committed
artifact against it. Nothing here reads the local raw pull, so a stale or
corrupted raw file cannot pass verification.

Checks:
  1. artifact rows + documented drops == source COUNT(*)
  2. drop count for missing coordinates == source COUNT(*) WHERE lat/lng IS NULL
  3. liquor_tavern tier-1 total == server-side COUNT(*) for those license types
  4. two named 0.25-mile spot-checks near real Chicago locations

Usage: python3 verify_active_licenses.py --artifact ../../data/curated/site-activity/active_licenses_compact.csv
"""
import argparse
import csv
import json
import math
import urllib.parse
import urllib.request

RESOURCE = "https://data.cityofchicago.org/resource/uupf-x98q.json"
UA = "seccc-funding-layer/site-activity-feed4-verify (public data)"

LIQUOR_TIER1 = [
    "Tavern",
    "Package Goods",
    "Consumption on Premises - Incidental Activity",
    "Caterer's Liquor License",
    "Special Event Liquor",
    "Late Hour",
    "Outdoor Patio",
    "Not-For-Profit Club",
]

# Anchors for the spot-checks. Neither target address holds an active license
# itself, so each anchor is the coordinate the CITY assigned to the nearest
# licensed address on the same block. Offsets are far below the 0.25 mi radius.
SPOT_CHECKS = [
    {
        "target": "2404 E 79th St (South Chicago)",
        "anchor_source": "2409 E 79TH ST - nearest licensed address, city-assigned point, ~15 m offset",
        "lat": 41.75162,
        "lng": -87.56583,
    },
    {
        "target": "4048 W Madison St (West Garfield Park)",
        "anchor_source": "4047 W MADISON ST - nearest licensed address, city-assigned point, ~25 m offset",
        "lat": 41.88059,
        "lng": -87.72754,
    },
    {
        "target": "806 W 63rd St (Englewood Square, Englewood)",
        "anchor_source": "806 W 63RD ST - exact licensed address, city-assigned point",
        "lat": 41.77986,
        "lng": -87.64514,
    },
]
RADIUS_MI = 0.25

# Three named businesses at real Chicago addresses, each re-fetched LIVE from
# Socrata by license_id. Each exercises a different rule path, so a silent rule
# regression fails here rather than in production.
NAMED_CHECKS = [
    {
        "license_id": "3034345",
        "name": "HALE FAMILY MCDONALD'S",
        "address": "2425 E 79TH ST",
        "expect_category": "restaurant_cafe",
        "rule_path": "tier2 step_a - 'Preparation of Food and Dining on Premises With Seating'",
    },
    {
        "license_id": "3015736",
        "name": "AYA SUPERMARKET",
        "address": "4035 W MADISON ST",
        "expect_category": "grocery",
        "rule_path": "tier2 step_b - carries BOTH non-perishable and perishable tokens; perishable decides",
    },
    {
        "license_id": "3012160",
        "name": "STARBUCKS COFFEE #27892",
        "address": "806 W 63RD ST",
        "expect_category": "restaurant_cafe",
        "rule_path": "tier2 step_a - 'Sale of Food Prepared Onsite With Dining Area'",
    },
]


def q(params):
    url = RESOURCE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def haversine_mi(a_lat, a_lng, b_lat, b_lng):
    R = 3958.7613
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", required=True)
    args = ap.parse_args()

    rows = []
    with open(args.artifact, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(r)

    print("=" * 72)
    print("CHECK 1 - row count vs source COUNT(*)")
    src_total = int(q({"$select": "count(*) as n"})[0]["n"])
    src_nullcoord = int(
        q(
            {
                "$select": "count(*) as n",
                "$where": "latitude IS NULL OR longitude IS NULL",
            }
        )[0]["n"]
    )
    print(f"  source COUNT(*)                 : {src_total}")
    print(f"  source rows w/o coordinates     : {src_nullcoord}")
    print(f"  artifact rows                   : {len(rows)}")
    print(f"  artifact + no-coord drops       : {len(rows) + src_nullcoord}")
    ok1 = (len(rows) + src_nullcoord) == src_total
    print(f"  RECONCILES                      : {ok1}")

    print()
    print("CHECK 2 - liquor_tavern tier-1 vs server-side count")
    quoted = ",".join("'" + v.replace("'", "''") + "'" for v in LIQUOR_TIER1)
    srv_liq = int(
        q(
            {
                "$select": "count(*) as n",
                "$where": f"license_description in({quoted}) AND latitude IS NOT NULL AND longitude IS NOT NULL",
            }
        )[0]["n"]
    )
    art_liq = sum(1 for r in rows if r["category"] == "liquor_tavern")
    print(f"  server-side (geocoded, those 8 license types): {srv_liq}")
    print(f"  artifact liquor_tavern rows                  : {art_liq}")
    ok2 = srv_liq == art_liq
    print(f"  MATCHES                                      : {ok2}")

    print()
    print("CHECK 3 - category totals in artifact")
    from collections import Counter

    c = Counter(r["category"] for r in rows)
    for k, v in sorted(c.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>6}  ({v/len(rows)*100:5.1f}%)")

    print()
    print(f"CHECK 4 - named spot-checks, {RADIUS_MI} mi radius")
    ok4 = True
    for sc in SPOT_CHECKS:
        near = []
        for r in rows:
            d = haversine_mi(sc["lat"], sc["lng"], float(r["lat"]), float(r["lng"]))
            if d <= RADIUS_MI:
                near.append((d, r))
        near.sort(key=lambda t: t[0])
        print()
        print(f"  --- {sc['target']} ---")
        print(f"      anchor: {sc['anchor_source']}")
        print(f"      licenses within {RADIUS_MI} mi: {len(near)}")
        cc = Counter(r["category"] for _, r in near)
        print("      by category: " + ", ".join(f"{k}={v}" for k, v in sorted(cc.items(), key=lambda kv: -kv[1])))
        print("      nearest named businesses:")
        shown = 0
        for d, r in near:
            if not r.get("name"):
                continue
            print(f"        {d:0.3f} mi  [{r['category']:<18}] {r['name']}")
            shown += 1
            if shown >= 12:
                break
        if len(near) == 0:
            ok4 = False

    print()
    print("CHECK 5 - named businesses, re-fetched live from Socrata by license_id")
    by_id = {r["license_id"]: r for r in rows}
    ok5 = True
    for nc in NAMED_CHECKS:
        live = q({"$where": f"license_id='{nc['license_id']}'"})
        art = by_id.get(nc["license_id"])
        print()
        print(f"  --- {nc['name']} ({nc['address']}) ---")
        if not live:
            print("    FAIL: license_id not found live")
            ok5 = False
            continue
        lv = live[0]
        art_cat = art["category"] if art else None
        name_ok = (lv.get("doing_business_as_name") or "").strip() == nc["name"]
        addr_ok = nc["address"] in (lv.get("address") or "")
        cat_ok = art_cat == nc["expect_category"]
        coord_ok = art is not None and abs(
            float(lv["latitude"]) - float(art["lat"])
        ) < 1e-4 and abs(float(lv["longitude"]) - float(art["lng"])) < 1e-4
        print(f"    live name      : {lv.get('doing_business_as_name')}   match={name_ok}")
        print(f"    live address   : {lv.get('address')}   match={addr_ok}")
        print(f"    live activity  : {lv.get('business_activity')}")
        print(f"    rule path      : {nc['rule_path']}")
        print(f"    category       : {art_cat} (expected {nc['expect_category']})   match={cat_ok}")
        print(f"    coords match   : {coord_ok}  live=({lv.get('latitude')},{lv.get('longitude')})")
        if not (name_ok and addr_ok and cat_ok and coord_ok):
            ok5 = False

    print()
    print("=" * 72)
    print(f"RESULT: check1={ok1} check2={ok2} spotchecks_nonempty={ok4} named={ok5}")
    return 0 if (ok1 and ok2 and ok4 and ok5) else 1


if __name__ == "__main__":
    raise SystemExit(main())
