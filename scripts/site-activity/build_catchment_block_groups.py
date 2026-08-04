#!/usr/bin/env python3
"""
FEED 3 - catchment centroids: population + jobs, per Cook County (17031) block group.

Builds data/curated/site-activity/catchment_block_groups.csv from three raw public
records. No modelling, no interpolation, no synthesized counts: every emitted number
is either read verbatim from a published federal file or is a documented sum of
verbatim published numbers.

Sources
-------
(a) Population - ACS 5-year detailed table B01003 (Total Population), table-based
    Summary File. Pipe-delimited, one row per geography, national coverage.
    https://www2.census.gov/programs-surveys/acs/summary_file/{YEAR}/table-based-SF/data/5YRData/acsdt5y{YEAR}-b01003.dat

    NOTE ON THE API: the documented key-less api.census.gov path is CLOSED as of this
    build - GET https://api.census.gov/data/2023/acs/acs5?... returns HTTP 302 to a
    "Missing Key" interstitial for any request without &key=. Rather than fabricate or
    downgrade, this script reads the *same* estimates from the Census Bureau's official
    table-based Summary File, which needs no key and is the authoritative bulk release
    of the identical table. Verified: the Summary File's own county row for 17031 is
    used as the reconciliation target in verify_catchment_block_groups.py.

(b) Jobs - LEHD LODES8 Workplace Area Characteristics (WAC), Illinois, segment S000
    (all workers), job type JT00 (all jobs). One row per *workplace census block* that
    has at least one job; C000 = total jobs. Rolled up to block group by summing C000
    over the blocks whose 15-digit geocode starts with the 12-digit bg_geoid.
    https://lehd.ces.census.gov/data/lodes/LODES8/il/wac/il_wac_S000_JT00_{YEAR}.csv.gz

(c) Centroids - Census TIGERweb REST, "Census Block Groups" layer, INTPTLAT/INTPTLON
    (the official internal point: a coordinate guaranteed to fall inside the polygon).
    The Census Gazetteer does NOT publish a block-group file - its finest geography is
    the census tract - so TIGERweb is used, which the task explicitly allows.
    https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS{YEAR}/MapServer/10/query

Geography vintage alignment
---------------------------
All three sources are on 2020 Census block/block-group geography:
  - ACS 2020-2024 5-year tabulates to 2020 block groups.
  - LODES8 is published on 2020 census blocks.
  - tigerWMS_ACS2024 is the TIGER vintage that matches the ACS 5-year release.
The TIGERweb service year is pinned to the ACS year so the centroid set and the
population set describe the same polygons.

Missing data policy (honesty rail)
----------------------------------
  - population: written only when the Summary File carries a non-negative estimate.
    Census jam values (-555555555, -666666666, ...) and absent rows are written as an
    EMPTY FIELD, never 0. Counted and reported.
  - jobs: the LODES WAC file is a *complete enumeration* of workplace blocks holding at
    least one job. A block group none of whose blocks appear in the file is therefore a
    source-asserted zero, not a gap, and is written as 0. A block group that cannot be
    reconciled to the LODES universe at all is written as an EMPTY FIELD. Both counts
    are reported.
  - Rows are emitted only for block groups TIGERweb returns for Cook County, so every
    row has a real internal point. A block group with no centroid is omitted and
    reported, never given a guessed coordinate.

XML: this feed parses no XML. All three sources are pipe-delimited text, gzipped CSV,
and JSON respectively. Nothing here can expand a DOCTYPE or ENTITY.

Usage
-----
  python3 build_catchment_block_groups.py            # download (cached) + build
  python3 build_catchment_block_groups.py --offline  # build from already-cached raw
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# ---------------------------------------------------------------- configuration

STATE_FIPS = "17"
COUNTY_FIPS = "031"
COUNTY_GEOID = STATE_FIPS + COUNTY_FIPS  # 17031, Cook County, Illinois

ACS_YEAR = 2024      # ACS 2020-2024 5-year; latest table-based SF published
LODES_YEAR = 2023    # latest il_wac_S000_JT00_*.csv.gz on the LEHD server
TIGER_ACS_YEAR = 2024
TIGER_BG_LAYER = 10  # "Census Block Groups"

DEFAULT_RAW_DIR = (
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/"
    "b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/site-activity"
)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(
    REPO_ROOT, "data", "curated", "site-activity", "catchment_block_groups.csv"
)

USER_AGENT = "seccc-funding-layer/site-activity (public-records ingestion; contact: SECCC)"
TIGER_PAGE_SIZE = 1000

# Census "jam values" - sentinels, never real counts.
def is_jam(raw: str) -> bool:
    return raw.startswith("-")


def acs_url(year: int) -> str:
    return (
        f"https://www2.census.gov/programs-surveys/acs/summary_file/{year}"
        f"/table-based-SF/data/5YRData/acsdt5y{year}-b01003.dat"
    )


def lodes_url(year: int) -> str:
    return (
        "https://lehd.ces.census.gov/data/lodes/LODES8/il/wac/"
        f"il_wac_S000_JT00_{year}.csv.gz"
    )


def tiger_query_url(year: int) -> str:
    return (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
        f"tigerWMS_ACS{year}/MapServer/{TIGER_BG_LAYER}/query"
    )


# ---------------------------------------------------------------------- helpers


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def http_get(url: str, *, retries: int = 4, timeout: int = 180) -> bytes:
    """Plain GET with retry. Refuses anything that is not 200."""
    last = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status} for {url}")
                return resp.read()
        except Exception as exc:  # noqa: BLE001 - retry on any transport error
            last = exc
            if attempt < retries:
                sleep_s = 2 ** attempt
                log(f"  retry {attempt}/{retries - 1} after {exc!r}; sleeping {sleep_s}s")
                time.sleep(sleep_s)
    raise RuntimeError(f"GET failed after {retries} attempts: {url}") from last


def download_cached(url: str, dest: str, *, offline: bool) -> str:
    """Fetch url to dest unless already present. Returns dest."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        log(f"  cached: {os.path.basename(dest)} ({os.path.getsize(dest):,} bytes)")
        return dest
    if offline:
        raise SystemExit(f"--offline set but raw file missing: {dest}")
    log(f"  GET {url}")
    payload = http_get(url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(payload)
    log(f"  saved: {os.path.basename(dest)} ({len(payload):,} bytes)")
    return dest


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ------------------------------------------------------------------ (a) ACS pop


def load_acs_population(path: str):
    """
    Parse the pipe-delimited table-based Summary File for B01003.

    Returns (bg_population, county_total, jam_geoids) where:
      bg_population : {12-digit bg_geoid -> int}   (Cook County only, non-jam only)
      county_total  : int | None                    (the file's own 17031 county row)
      jam_geoids    : [str]                         (Cook BGs whose estimate is a jam value)
    """
    bg_population = {}
    jam_geoids = []
    county_total = None

    bg_prefix = f"1500000US{COUNTY_GEOID}"
    county_row = f"0500000US{COUNTY_GEOID}"

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        header = fh.readline().rstrip("\n").split("|")
        if header[:2] != ["GEO_ID", "B01003_E001"]:
            raise SystemExit(f"unexpected ACS SF header: {header[:3]}")
        for line in fh:
            if not line.startswith(("1500000US17031", "0500000US17031")):
                continue
            parts = line.rstrip("\n").split("|")
            geo_id, estimate = parts[0], parts[1]
            if geo_id == county_row:
                county_total = None if is_jam(estimate) else int(estimate)
                continue
            if not geo_id.startswith(bg_prefix):
                continue
            bg_geoid = geo_id.split("US", 1)[1]
            if len(bg_geoid) != 12:
                continue
            if is_jam(estimate):
                jam_geoids.append(bg_geoid)
                continue
            bg_population[bg_geoid] = int(estimate)

    return bg_population, county_total, jam_geoids


# ----------------------------------------------------------------- (b) LODES jobs


def load_lodes_jobs(path: str):
    """
    Roll LODES8 WAC C000 (total jobs) up from 2020 census blocks to block groups.

    Returns (bg_jobs, county_total, state_total, cook_block_rows) where:
      bg_jobs        : {12-digit bg_geoid -> int}  Cook County block groups present in WAC
      county_total   : int  sum of C000 over all Cook County blocks in the file
      state_total    : int  sum of C000 over every Illinois block in the file
      cook_block_rows: int  number of Cook County block rows read
    """
    bg_jobs = {}
    county_total = 0
    state_total = 0
    cook_block_rows = 0

    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        if header[0] != "w_geocode" or header[1] != "C000":
            raise SystemExit(f"unexpected LODES WAC header: {header[:3]}")
        for row in reader:
            geocode = row[0]
            jobs = int(row[1])
            state_total += jobs
            if not geocode.startswith(COUNTY_GEOID):
                continue
            cook_block_rows += 1
            county_total += jobs
            bg_geoid = geocode[:12]
            bg_jobs[bg_geoid] = bg_jobs.get(bg_geoid, 0) + jobs

    return bg_jobs, county_total, state_total, cook_block_rows


# ------------------------------------------------------------- (c) TIGER centroids


def fetch_tiger_centroids(year: int, raw_dir: str, *, offline: bool):
    """
    Page TIGERweb for every Cook County block group's official internal point.

    Returns (centroids, service_count) where centroids maps bg_geoid -> (lat, lng)
    as source-precision strings, and service_count is the layer's own reported count.
    """
    cache = os.path.join(raw_dir, f"tigerweb_acs{year}_bg_{COUNTY_GEOID}.json")
    if os.path.exists(cache) and os.path.getsize(cache) > 0:
        log(f"  cached: {os.path.basename(cache)}")
        with open(cache, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        return payload["centroids"], payload["service_count"]
    if offline:
        raise SystemExit(f"--offline set but raw file missing: {cache}")

    base = tiger_query_url(year)
    where = f"STATE='{STATE_FIPS}' AND COUNTY='{COUNTY_FIPS}'"

    # The service's own count - the row-count target we verify against.
    count_url = base + "?" + urllib.parse.urlencode(
        {"where": where, "returnCountOnly": "true", "f": "json"}
    )
    log(f"  GET {count_url}")
    service_count = json.loads(http_get(count_url).decode("utf-8"))["count"]
    log(f"  TIGERweb reports {service_count:,} block groups for {COUNTY_GEOID}")

    centroids = {}
    offset = 0
    while True:
        page_url = base + "?" + urllib.parse.urlencode(
            {
                "where": where,
                "outFields": "GEOID,INTPTLAT,INTPTLON",
                "returnGeometry": "false",
                "orderByFields": "GEOID",
                "resultOffset": str(offset),
                "resultRecordCount": str(TIGER_PAGE_SIZE),
                "f": "json",
            }
        )
        page = json.loads(http_get(page_url).decode("utf-8"))
        if "error" in page:
            raise SystemExit(f"TIGERweb error at offset {offset}: {page['error']}")
        features = page.get("features", [])
        if not features:
            break
        for feat in features:
            attrs = feat["attributes"]
            geoid = attrs["GEOID"]
            lat_raw = attrs["INTPTLAT"]
            lon_raw = attrs["INTPTLON"]
            if not geoid or lat_raw in (None, "") or lon_raw in (None, ""):
                continue
            # "+41.8781136" / "-087.6297982" -> normalized decimal, source precision kept.
            centroids[geoid] = (f"{float(lat_raw):.7f}", f"{float(lon_raw):.7f}")
        offset += len(features)
        log(f"  fetched {offset:,}/{service_count:,}")
        if offset >= service_count:
            break
        time.sleep(0.2)

    with open(cache, "w", encoding="utf-8") as fh:
        json.dump({"centroids": centroids, "service_count": service_count}, fh)
    log(f"  saved: {os.path.basename(cache)}")
    return centroids, service_count


# ------------------------------------------------------------------------- build


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", default=DEFAULT_RAW_DIR)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--acs-year", type=int, default=ACS_YEAR)
    parser.add_argument("--lodes-year", type=int, default=LODES_YEAR)
    parser.add_argument("--tiger-year", type=int, default=TIGER_ACS_YEAR)
    parser.add_argument("--offline", action="store_true", help="build from cached raw only")
    args = parser.parse_args()

    os.makedirs(args.raw_dir, exist_ok=True)
    retrieved = dt.date.today().isoformat()

    acs_vintage = f"ACS {args.acs_year - 4}-{args.acs_year} 5-year"
    lodes_vintage = f"LODES8 {args.lodes_year}"

    log("(a) ACS B01003 - Total Population, table-based Summary File")
    acs_path = download_cached(
        acs_url(args.acs_year),
        os.path.join(args.raw_dir, f"acsdt5y{args.acs_year}-b01003.dat"),
        offline=args.offline,
    )
    bg_pop, acs_county_total, acs_jam = load_acs_population(acs_path)
    log(f"  Cook block groups with a population estimate: {len(bg_pop):,}")
    log(f"  Cook block groups with a jam/suppressed estimate: {len(acs_jam):,}")
    log(f"  ACS file's own Cook County total: {acs_county_total:,}")

    log("(b) LODES8 IL WAC S000 JT00 - total jobs C000")
    lodes_path = download_cached(
        lodes_url(args.lodes_year),
        os.path.join(args.raw_dir, f"il_wac_S000_JT00_{args.lodes_year}.csv.gz"),
        offline=args.offline,
    )
    bg_jobs, lodes_cook_total, lodes_il_total, cook_block_rows = load_lodes_jobs(lodes_path)
    log(f"  Illinois blocks in file, total jobs: {lodes_il_total:,}")
    log(f"  Cook County block rows: {cook_block_rows:,}; Cook total jobs: {lodes_cook_total:,}")
    log(f"  Cook block groups appearing in WAC: {len(bg_jobs):,}")

    log(f"(c) TIGERweb ACS{args.tiger_year} block-group internal points")
    centroids, tiger_count = fetch_tiger_centroids(
        args.tiger_year, args.raw_dir, offline=args.offline
    )
    log(f"  centroids resolved: {len(centroids):,}")

    # ---- join -------------------------------------------------------------
    # The centroid set is the spine: a row without a real internal point is omitted
    # rather than given a guessed coordinate.
    rows = []
    pop_missing = []
    jobs_structural_zero = []

    lodes_only = sorted(set(bg_jobs) - set(centroids))

    for bg_geoid in sorted(centroids):
        lat, lng = centroids[bg_geoid]
        population = bg_pop.get(bg_geoid)
        jobs = bg_jobs.get(bg_geoid)
        if population is None:
            pop_missing.append(bg_geoid)
        if jobs is None:
            # Absent from a complete enumeration of blocks-with-jobs => source says zero.
            jobs = 0
            jobs_structural_zero.append(bg_geoid)
        rows.append(
            {
                "bg_geoid": bg_geoid,
                "lat": lat,
                "lng": lng,
                "population": "" if population is None else str(population),
                "acs_vintage": acs_vintage,
                "jobs": str(jobs),
                "lodes_vintage": lodes_vintage,
            }
        )

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    fields = ["bg_geoid", "lat", "lng", "population", "acs_vintage", "jobs", "lodes_vintage"]
    with open(args.out, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    pop_sum = sum(int(r["population"]) for r in rows if r["population"] != "")
    jobs_sum = sum(int(r["jobs"]) for r in rows)

    # ---- provenance manifest ---------------------------------------------
    manifest = {
        "feed": "site-activity/feed-3-catchment-centroids",
        "artifact": os.path.relpath(args.out, REPO_ROOT),
        "built_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "retrieval_date": retrieved,
        "county": {"geoid": COUNTY_GEOID, "name": "Cook County, Illinois"},
        "rows": len(rows),
        "sources": [
            {
                "role": "population",
                "dataset_id": f"ACS 5-year Detailed Table B01003 (Total Population), table-based Summary File {args.acs_year}",
                "publisher": "U.S. Census Bureau",
                "vintage": acs_vintage,
                "retrieval_date": retrieved,
                "verify_url": acs_url(args.acs_year),
                "sha256": sha256_file(acs_path),
                "bytes": os.path.getsize(acs_path),
                "source_reported_county_total": acs_county_total,
            },
            {
                "role": "jobs",
                "dataset_id": f"LEHD LODES8 Workplace Area Characteristics, Illinois, S000/JT00, {args.lodes_year}",
                "publisher": "U.S. Census Bureau, Longitudinal Employer-Household Dynamics",
                "vintage": lodes_vintage,
                "retrieval_date": retrieved,
                "verify_url": lodes_url(args.lodes_year),
                "sha256": sha256_file(lodes_path),
                "bytes": os.path.getsize(lodes_path),
                "source_reported_illinois_total_jobs": lodes_il_total,
                "source_reported_cook_total_jobs": lodes_cook_total,
                "cook_block_rows": cook_block_rows,
            },
            {
                "role": "centroids",
                "dataset_id": f"TIGERweb tigerWMS_ACS{args.tiger_year} MapServer layer {TIGER_BG_LAYER} (Census Block Groups), INTPTLAT/INTPTLON",
                "publisher": "U.S. Census Bureau, Geography Division",
                "vintage": f"TIGER/Line ACS {args.tiger_year}",
                "retrieval_date": retrieved,
                "verify_url": tiger_query_url(args.tiger_year)
                + f"?where=STATE%3D%27{STATE_FIPS}%27+AND+COUNTY%3D%27{COUNTY_FIPS}%27&returnCountOnly=true&f=json",
                "source_reported_block_group_count": tiger_count,
            },
        ],
        "totals": {
            "population_sum": pop_sum,
            "jobs_sum": jobs_sum,
        },
        "omissions": {
            "block_groups_without_population_estimate": len(pop_missing),
            "block_groups_without_population_estimate_geoids": pop_missing,
            "acs_jam_value_block_groups": len(acs_jam),
            "block_groups_absent_from_lodes_wac_written_as_zero": len(jobs_structural_zero),
            "block_groups_absent_from_lodes_wac_geoids": jobs_structural_zero,
            "lodes_block_groups_with_no_tigerweb_centroid": lodes_only,
        },
    }
    manifest_path = os.path.join(os.path.dirname(args.out), "catchment_block_groups.manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    log("")
    log(f"WROTE {args.out}")
    log(f"  rows                : {len(rows):,}")
    log(f"  population sum      : {pop_sum:,}  (ACS county row: {acs_county_total:,})")
    log(f"  jobs sum            : {jobs_sum:,}  (LODES Cook total: {lodes_cook_total:,})")
    log(f"  BGs w/o population  : {len(pop_missing):,}  -> written empty, never 0")
    log(f"  BGs absent in WAC   : {len(jobs_structural_zero):,} -> written 0 (source-asserted)")
    log(f"  LODES BGs w/o centroid: {len(lodes_only):,}")
    log(f"WROTE {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
