#!/usr/bin/env python3
"""
FEED 1 - IDOT AADT (Annual Average Daily Traffic) segments, Chicago bounding box.

SOURCE OF TRUTH (public, no API key):
  https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT/MapServer/0
  Layer 0 = "Traffic Volume" (esriGeometryPolyline), publisher: Illinois Department
  of Transportation, Office of Planning & Programming (Traffic Count Program).

WHAT THIS SCRIPT DOES - AND DOES NOT DO
  DOES:  paginate the public ArcGIS REST query endpoint, keep the raw JSON pages,
         reproject nothing (asks the server for outSR=4326), reduce each polyline
         to its along-line midpoint, and emit one compact CSV row per segment.
  DOES NOT: invent, interpolate, model, smooth, or impute anything. Every AADT
         value and year in the artifact is the integer IDOT published for that
         segment. Segments IDOT does not publish simply do not appear.

MIDPOINT NOTE (documented in the README): the service returns LINE SEGMENTS, not
point count stations. Each row's lat/lng is the point at 50% of the cumulative
2-D path length of that segment's geometry (longitude scaled by cos(mean lat)
so the traversal is length-proportional, not degree-proportional). It is a
geometric reduction of published geometry, never an estimate of a count location.

Stdlib only. No XML is parsed by this script (the endpoint is queried with
f=json); if that ever changes, any XML parsing added here must reject documents
containing DOCTYPE or ENTITY declarations before parsing.

Usage:
  python3 scripts/site-activity/fetch_idot_aadt.py [--raw-dir DIR] [--out FILE]
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

SERVICE_LAYER = (
    "https://gis1.dot.illinois.gov/arcgis/rest/services"
    "/AdministrativeData/AADT/MapServer/0"
)
QUERY_URL = SERVICE_LAYER + "/query"

# Chicago bounding box (task-specified).
BBOX = {"xmin": -87.95, "ymin": 41.62, "xmax": -87.50, "ymax": 42.05}

PAGE_SIZE = 1000  # service maxRecordCount
OUT_FIELDS = "OBJECTID,INVENTORY,ROAD_NAME,MARKED_NAM,COUNTY_NAM,AADT,AADT_YR"
USER_AGENT = "seccc-funding-layer/site-activity (public data ingest)"

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(
    REPO_ROOT, "data", "curated", "site-activity", "idot_aadt_stations.csv"
)
DEFAULT_RAW = (
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/"
    "b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/site-activity/idot_raw"
)


def get_json(params: dict, tries: int = 4, timeout: int = 120) -> dict:
    """GET the ArcGIS query endpoint and return parsed JSON, with retries."""
    url = QUERY_URL + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if "error" in payload:
                raise RuntimeError(f"ArcGIS error: {payload['error']}")
            return payload
        except Exception as exc:  # noqa: BLE001 - retry any transport/service error
            last = exc
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"request failed after {tries} tries: {last}")


def bbox_params() -> dict:
    return {
        "geometry": f"{BBOX['xmin']},{BBOX['ymin']},{BBOX['xmax']},{BBOX['ymax']}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }


def source_count() -> int:
    """The source's OWN count for the bbox - the number we verify against."""
    params = {**bbox_params(), "where": "1=1", "returnCountOnly": "true", "f": "json"}
    return int(get_json(params)["count"])


def fetch_pages(raw_dir: str) -> list:
    """Paginate the layer, persist each raw page, return all features."""
    os.makedirs(raw_dir, exist_ok=True)
    features, offset, page = [], 0, 0
    while True:
        params = {
            **bbox_params(),
            "where": "1=1",
            "outFields": OUT_FIELDS,
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "6",  # ~0.1 m; no information loss at street scale
            "orderByFields": "OBJECTID ASC",  # stable pagination
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE_SIZE),
            "f": "json",
        }
        payload = get_json(params)
        batch = payload.get("features", [])
        with open(os.path.join(raw_dir, f"page_{page:04d}.json"), "w") as fh:
            json.dump(payload, fh)
        features.extend(batch)
        sys.stderr.write(f"  page {page}: {len(batch)} features (total {len(features)})\n")
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        page += 1
    return features


def polyline_midpoint(paths: list) -> tuple | None:
    """Point at 50% of cumulative 2-D length along the concatenated paths."""
    pts = []
    for part in paths or []:
        for xy in part:
            if not pts or (xy[0], xy[1]) != pts[-1]:
                pts.append((xy[0], xy[1]))
    if not pts:
        return None
    if len(pts) == 1:
        return pts[0]

    mean_lat = sum(p[1] for p in pts) / len(pts)
    kx = math.cos(math.radians(mean_lat))  # degrees-lon -> comparable ground units

    seg_len, total = [], 0.0
    for a, b in zip(pts, pts[1:]):
        d = math.hypot((b[0] - a[0]) * kx, b[1] - a[1])
        seg_len.append(d)
        total += d
    if total == 0:
        return pts[0]

    target, run = total / 2.0, 0.0
    for (a, b), d in zip(zip(pts, pts[1:]), seg_len):
        if run + d >= target:
            t = (target - run) / d if d else 0.0
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        run += d
    return pts[-1]


def in_bbox(lng: float, lat: float) -> bool:
    return (
        BBOX["xmin"] <= lng <= BBOX["xmax"] and BBOX["ymin"] <= lat <= BBOX["ymax"]
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=DEFAULT_RAW)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    sys.stderr.write(f"[{date.today().isoformat()}] source: {SERVICE_LAYER}\n")
    expected = source_count()
    sys.stderr.write(f"source returnCountOnly for bbox = {expected}\n")

    feats = fetch_pages(args.raw_dir)
    sys.stderr.write(f"fetched features = {len(feats)}\n")

    rows, no_geom, outside = [], 0, 0
    for f in feats:
        a = f.get("attributes", {})
        mid = polyline_midpoint((f.get("geometry") or {}).get("paths"))
        if mid is None:
            no_geom += 1  # explicit omission, never a 0/0 coordinate
            continue
        lng, lat = mid
        if not in_bbox(lng, lat):
            outside += 1  # segment crosses the bbox edge; midpoint falls outside
            continue
        road = (a.get("ROAD_NAME") or "").strip()
        if not road:
            road = ""  # IDOT published no road name; left blank, never invented
        rows.append(
            {
                "station_or_segment_id": a["OBJECTID"],
                "road_name": road,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "aadt": a["AADT"],
                "aadt_year": a["AADT_YR"],
            }
        )

    rows.sort(key=lambda r: r["station_or_segment_id"])

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", newline="") as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=[
                "station_or_segment_id",
                "road_name",
                "lat",
                "lng",
                "aadt",
                "aadt_year",
            ],
        )
        w.writeheader()
        w.writerows(rows)

    years = {}
    for r in rows:
        years[r["aadt_year"]] = years.get(r["aadt_year"], 0) + 1

    sys.stderr.write("\n--- VERIFICATION ---\n")
    sys.stderr.write(f"source count (bbox intersect) : {expected}\n")
    sys.stderr.write(f"features retrieved            : {len(feats)}\n")
    sys.stderr.write(f"dropped, no usable geometry   : {no_geom}\n")
    sys.stderr.write(f"dropped, midpoint outside bbox: {outside}\n")
    sys.stderr.write(f"rows written                  : {len(rows)}\n")
    sys.stderr.write(f"blank road_name (as published): "
                     f"{sum(1 for r in rows if not r['road_name'])}\n")
    sys.stderr.write("aadt_year histogram           : "
                     + ", ".join(f"{y}:{n}" for y, n in sorted(years.items())) + "\n")
    sys.stderr.write(f"wrote {args.out}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
