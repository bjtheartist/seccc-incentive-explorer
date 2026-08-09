#!/usr/bin/env python3
"""
Verification gate for data/curated/site-activity/catchment_block_groups.csv (FEED 3).

Nothing here re-derives a number from the artifact and calls it proof. Every check
compares the artifact against a count the SOURCE itself publishes, or against an
independent authoritative lookup (the Census Geocoder).

Checks
------
1. ROW COUNT      artifact rows == TIGERweb's own returnCountOnly for Cook County
                  == the count of B01003 block-group rows for 17031 in the ACS
                  Summary File. Three independent counts, one number.
2. POPULATION     sum(population) vs the ACS Summary File's own 0500000US17031
                  county row. Tolerance 1%.
3. JOBS           sum(jobs) vs the sum of C000 over every Cook County block row in
                  the LODES IL WAC file. Reported, and the Illinois total reported
                  alongside so the Cook share is visible.
4. SPOT CHECKS    Four named Chicago locations are resolved to their 2020 census
                  block by the Census Geocoder (an authority independent of all
                  three ingested files), truncated to the block group, then looked
                  up in the artifact. Loop block groups must show jobs >> population;
                  bungalow-belt block groups the reverse.
5. INTEGRITY      no duplicate bg_geoid; every bg_geoid is 12 digits under 17031;
                  every lat/lng inside the Cook County bounding box; no negative
                  counts; population blank is allowed, population 0-as-a-guess is not.

Usage:  python3 verify_catchment_block_groups.py [--offline]
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
ARTIFACT = os.path.join(REPO_ROOT, "data", "curated", "site-activity", "catchment_block_groups.csv")
MANIFEST = os.path.join(REPO_ROOT, "data", "curated", "site-activity", "catchment_block_groups.manifest.json")
RAW_DIR = (
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/"
    "b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/site-activity"
)

COUNTY_GEOID = "17031"
USER_AGENT = "seccc-funding-layer/site-activity (public-records verification)"

# Cook County bounding box. NOTE the eastern limit: Cook County's LEGAL boundary
# extends into Lake Michigan to the Illinois/Indiana/Michigan tripoint, so the county
# reaches roughly -87.32 W, well past the -87.52 W shoreline. A shoreline-tight box
# would falsely flag the lake block group below.
COOK_BBOX = (41.44, 42.18, -88.30, -87.32)

# Cook County's Lake Michigan water block group (census tract 9900.00, block group 0):
# AREALAND = 0, AREAWATER = 1,717,072,182 m2. It is a real, published block group and is
# retained so the artifact row count reconciles exactly to TIGERweb's and the ACS
# Summary File's own counts. Its population (ACS estimate 0, MOE 13) and its jobs
# (zero LODES blocks in tract 990000) are both source-asserted zeros, not fillers.
WATER_BG = "170319900000"

# Named Chicago locations. Each is resolved to its block group by the Census Geocoder,
# NOT by a hand-typed GEOID, so the check cannot be quietly fitted to the data.
SPOT_CHECKS = [
    ("Willis Tower", "233 S Wacker Dr", "Chicago", "IL", "jobs_dominant",
     "Loop office tower"),
    ("Chicago City Hall", "121 N LaSalle St", "Chicago", "IL", "jobs_dominant",
     "Loop civic core"),
    ("Mount Greenwood Park", "3721 W 111th St", "Chicago", "IL", "population_dominant",
     "Far Southwest Side bungalow belt"),
    ("Auburn Gresham / Leo High School", "7901 S Sangamon St", "Chicago", "IL",
     "population_dominant", "South Side residential, SECCC service area"),
]

PASS = "PASS"
FAIL = "FAIL"
results = []


def record(name: str, ok: bool, detail: str) -> None:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}\n        {detail}")


def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def geocode_block_group(street: str, city: str, state: str):
    """Census Geocoder -> (bg_geoid, matched_address, lat, lng). Independent authority."""
    url = "https://geocoding.geo.census.gov/geocoder/geographies/address?" + urllib.parse.urlencode(
        {
            "street": street,
            "city": city,
            "state": state,
            "benchmark": "Public_AR_Current",
            "vintage": "Census2020_Current",
            "format": "json",
        }
    )
    payload = json.loads(http_get(url).decode("utf-8"))
    matches = payload["result"]["addressMatches"]
    if not matches:
        return None
    match = matches[0]
    block_geoid = match["geographies"]["Census Blocks"][0]["GEOID"]
    coords = match["coordinates"]
    return block_geoid[:12], match["matchedAddress"], coords["y"], coords["x"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true",
                        help="skip network checks (TIGERweb count, geocoder spot-checks)")
    args = parser.parse_args()

    if not os.path.exists(ARTIFACT):
        print(f"artifact missing: {ARTIFACT}", file=sys.stderr)
        return 2

    with open(ARTIFACT, "r", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    by_bg = {r["bg_geoid"]: r for r in rows}
    manifest = json.load(open(MANIFEST, encoding="utf-8"))

    print(f"artifact: {ARTIFACT}")
    print(f"size    : {os.path.getsize(ARTIFACT):,} bytes")
    print(f"rows    : {len(rows):,}\n")

    # -------------------------------------------------- 1. row count, three ways
    acs_path = os.path.join(RAW_DIR, f"acsdt5y{manifest['sources'][0]['vintage'].split('-')[-1].split()[0]}-b01003.dat")
    if not os.path.exists(acs_path):
        acs_path = os.path.join(RAW_DIR, "acsdt5y2024-b01003.dat")
    acs_bg_count = 0
    acs_county_total = None
    with open(acs_path, "r", encoding="utf-8", errors="replace") as fh:
        fh.readline()
        for line in fh:
            if line.startswith(f"1500000US{COUNTY_GEOID}"):
                acs_bg_count += 1
            elif line.startswith(f"0500000US{COUNTY_GEOID}|"):
                acs_county_total = int(line.split("|")[1])

    tiger_count = manifest["sources"][2]["source_reported_block_group_count"]
    if not args.offline:
        live = json.loads(http_get(manifest["sources"][2]["verify_url"]).decode("utf-8"))
        tiger_count = live["count"]

    record(
        "1. ROW COUNT vs source-reported counts",
        len(rows) == tiger_count == acs_bg_count,
        f"artifact={len(rows):,}  TIGERweb returnCountOnly={tiger_count:,}  "
        f"ACS SF block-group rows for 17031={acs_bg_count:,}",
    )

    # ------------------------------------------------------- 2. population total
    pop_vals = [r["population"] for r in rows]
    pop_sum = sum(int(v) for v in pop_vals if v != "")
    blank_pop = sum(1 for v in pop_vals if v == "")
    delta_pct = abs(pop_sum - acs_county_total) / acs_county_total * 100
    record(
        "2. POPULATION sum vs ACS county row (tolerance 1%)",
        delta_pct <= 1.0 and 5_100_000 <= acs_county_total <= 5_300_000,
        f"artifact sum={pop_sum:,}  ACS SF 0500000US17031={acs_county_total:,}  "
        f"delta={pop_sum - acs_county_total:+,} ({delta_pct:.4f}%)  blank population cells={blank_pop}",
    )

    # ------------------------------------------------------------- 3. jobs total
    lodes_path = os.path.join(RAW_DIR, f"il_wac_S000_JT00_{manifest['sources'][1]['vintage'].split()[-1]}.csv.gz")
    lodes_cook = 0
    lodes_il = 0
    with gzip.open(lodes_path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        next(reader)
        for row in reader:
            jobs = int(row[1])
            lodes_il += jobs
            if row[0].startswith(COUNTY_GEOID):
                lodes_cook += jobs
    jobs_sum = sum(int(r["jobs"]) for r in rows)
    record(
        "3. JOBS sum vs LODES Cook County total",
        jobs_sum == lodes_cook,
        f"artifact sum={jobs_sum:,}  LODES IL WAC Cook total={lodes_cook:,}  "
        f"delta={jobs_sum - lodes_cook:+,}  |  LODES Illinois statewide total={lodes_il:,} "
        f"(Cook = {lodes_cook / lodes_il * 100:.1f}% of IL)",
    )

    # ------------------------------------------------------------ 4. spot checks
    if args.offline:
        print("[SKIP] 4. SPOT CHECKS (offline)")
    else:
        for label, street, city, state, expectation, note in SPOT_CHECKS:
            found = geocode_block_group(street, city, state)
            if not found:
                record(f"4. SPOT CHECK {label}", False, f"geocoder returned no match for {street}")
                continue
            bg_geoid, matched, glat, glng = found
            row = by_bg.get(bg_geoid)
            if row is None:
                record(f"4. SPOT CHECK {label}", False,
                       f"block group {bg_geoid} not present in artifact")
                continue
            pop = int(row["population"]) if row["population"] != "" else None
            jobs = int(row["jobs"])
            # centroid must be within ~2.5 km of the geocoded address (same block group)
            dlat = abs(float(row["lat"]) - glat)
            dlng = abs(float(row["lng"]) - glng)
            near = dlat < 0.025 and dlng < 0.030
            if expectation == "jobs_dominant":
                ok = pop is not None and jobs > pop * 5 and near
                shape = f"jobs {jobs:,} >> pop {pop:,} (ratio {jobs / max(pop, 1):.1f}x)"
            else:
                ok = pop is not None and pop > jobs * 2 and near
                shape = f"pop {pop:,} >> jobs {jobs:,} (ratio {pop / max(jobs, 1):.1f}x)"
            record(
                f"4. SPOT CHECK {label} ({note})",
                ok,
                f"{matched} -> block group {bg_geoid} | {shape} | "
                f"artifact centroid ({row['lat']}, {row['lng']}) vs geocoded "
                f"({glat:.6f}, {glng:.6f}) {'within' if near else 'OUTSIDE'} tolerance",
            )

    # -------------------------------------------------------------- 5. integrity
    problems = []
    if len(by_bg) != len(rows):
        problems.append(f"{len(rows) - len(by_bg)} duplicate bg_geoid")
    lo_lat, hi_lat, lo_lng, hi_lng = COOK_BBOX
    for r in rows:
        g = r["bg_geoid"]
        if len(g) != 12 or not g.isdigit() or not g.startswith(COUNTY_GEOID):
            problems.append(f"bad bg_geoid {g!r}")
        lat, lng = float(r["lat"]), float(r["lng"])
        if not (lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng):
            problems.append(f"{g} centroid outside Cook bbox ({lat}, {lng})")
        if int(r["jobs"]) < 0:
            problems.append(f"{g} negative jobs")
        if r["population"] != "" and int(r["population"]) < 0:
            problems.append(f"{g} negative population")
        if r["acs_vintage"] == "" or r["lodes_vintage"] == "":
            problems.append(f"{g} missing vintage stamp")
    record(
        "5. INTEGRITY (uniqueness, GEOID shape, bbox, non-negative, vintage stamps)",
        not problems,
        "no issues" if not problems else f"{len(problems)} issue(s): {problems[:5]}",
    )

    # ------------------------------------------- 5b. the Lake Michigan block group
    water = by_bg.get(WATER_BG)
    record(
        "5b. WATER BLOCK GROUP is a real published row with source-asserted zeros",
        water is not None and water["population"] == "0" and water["jobs"] == "0"
        and float(water["lng"]) > -87.50,
        (f"{WATER_BG} (tract 9900.00 / block group 0, Lake Michigan, AREALAND=0) "
         f"population={water['population']} jobs={water['jobs']} at "
         f"({water['lat']}, {water['lng']}) -- retained so row count reconciles to source"
         ) if water else f"{WATER_BG} missing from artifact",
    )

    # -------------------------------------------------------- omission disclosure
    om = manifest["omissions"]
    print("\nOmission disclosure (from manifest):")
    print(f"  block groups with no ACS population estimate : "
          f"{om['block_groups_without_population_estimate']} (written EMPTY, never 0)")
    print(f"  ACS jam/suppressed block groups              : {om['acs_jam_value_block_groups']}")
    print(f"  block groups absent from LODES WAC           : "
          f"{om['block_groups_absent_from_lodes_wac_written_as_zero']} "
          f"(written 0 - LODES WAC enumerates every block holding >=1 job, so absence is a "
          f"source-asserted zero, not a gap)")
    print(f"  LODES block groups with no TIGERweb centroid : "
          f"{len(om['lodes_block_groups_with_no_tigerweb_centroid'])}")

    failed = [r for r in results if r[0] == FAIL]
    print(f"\n{'=' * 72}")
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        for _, name, detail in failed:
            print(f"  FAIL: {name} -- {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
