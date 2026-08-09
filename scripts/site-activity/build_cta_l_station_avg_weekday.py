#!/usr/bin/env python3
"""
FEED 2 — CTA 'L' station average weekday entries.

Builds data/curated/site-activity/cta_l_station_avg_weekday.csv from two
Chicago Data Portal (Socrata) datasets, using RAW PUBLIC RECORDS ONLY.

  Ridership : 5neh-572f  "CTA - Ridership - 'L' Station Entries - Daily Totals"
              https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f
  Geography : 8pix-ypme  "CTA - System Information - List of 'L' Stops"
              https://data.cityofchicago.org/Transportation/CTA-System-Information-List-of-L-Stops/8pix-ypme

HONESTY RULES ENFORCED BY THIS SCRIPT
  * Every emitted number is either a raw published value or an unweighted mean
    of raw published daily values. No coefficients, no capture rates, no
    modelled or imputed ridership, no interpolation.
  * A station with no published weekday rows for the target month is OMITTED
    from the artifact and listed in the omission report. It is never written
    as 0 and never estimated.
  * A station that fails the geographic join is OMITTED (it has no lat/lng we
    can stand behind) and listed in the omission report.
  * prior_year_avg_weekday_entries is left BLANK when the prior-year month is
    absent for that station. Blank means "not published", not "zero".
  * Coordinates are copied verbatim from a real published stop row. Stops of
    the same station are never averaged into a synthetic centroid.

The month is not hard-coded: the script asks the dataset for its own max(date)
and derives the latest COMPLETE calendar month, then proves completeness
(distinct published dates == calendar days in that month) before proceeding.

Only the Python standard library is used. Responses are JSON and CSV; no XML
is parsed anywhere in this pipeline, so no DOCTYPE/ENTITY expansion is ever
possible. (If XML is added later it must be parsed with a resolver that
refuses DOCTYPE and ENTITY declarations outright.)

Usage:
    python3 scripts/site-activity/build_cta_l_station_avg_weekday.py
    python3 scripts/site-activity/build_cta_l_station_avg_weekday.py --month 2026-05
"""

from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

# --------------------------------------------------------------------------
# Source registry — mirrored in data/curated/site-activity/README.md
# --------------------------------------------------------------------------

DOMAIN = "data.cityofchicago.org"

RIDERSHIP = {
    "dataset_id": "5neh-572f",
    "title": "CTA - Ridership - 'L' Station Entries - Daily Totals",
    "publisher": "Chicago Transit Authority (via City of Chicago Data Portal)",
    "verify_url": "https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f",
}

STOPS = {
    "dataset_id": "8pix-ypme",
    "title": "CTA - System Information - List of 'L' Stops",
    "publisher": "Chicago Transit Authority (via City of Chicago Data Portal)",
    "verify_url": "https://data.cityofchicago.org/Transportation/CTA-System-Information-List-of-L-Stops/8pix-ypme",
}

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_CSV = os.path.join(
    REPO_ROOT, "data", "curated", "site-activity", "cta_l_station_avg_weekday.csv"
)
RAW_DIR = os.environ.get(
    "SITE_ACTIVITY_RAW_DIR",
    "/private/tmp/claude-502/-Users-billyndizeye-Desktop/"
    "b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad/site-activity",
)

# CTA daytype codes, published in the dataset description:
#   W = Weekday, A = Saturday, U = Sunday/Holiday
WEEKDAY_CODE = "W"

# Boolean line-service columns in 8pix-ypme -> CTA's public line names.
# Rendered in this fixed order so the `lines` column is stable across runs.
LINE_COLUMNS = [
    ("red", "Red"),
    ("blue", "Blue"),
    ("brn", "Brown"),
    ("g", "Green"),
    ("o", "Orange"),
    ("pnk", "Pink"),
    ("p", "Purple"),
    ("pexp", "Purple Express"),
    ("y", "Yellow"),
]

USER_AGENT = "seccc-incentive-explorer/site-activity-feed2 (public data ingest)"

# Sourced annotations for stations whose PUBLISHED value is a true zero.
# A published zero is a real measurement ("no one entered, the station is not
# open"), which is categorically different from missing data. We keep the raw
# zero and attach a citation so a reader can never mistake a closed station for
# a low-activity one. Every entry here must carry a public verify URL.
STATION_STATUS_ANNOTATIONS = {
    "40260": (
        "CTA closed State/Lake on 2026-01-05 for full station reconstruction "
        "(reopening expected 2029); verify: "
        "https://www.transitchicago.com/construction-to-begin-in-january-on-new-fully-accessible-statelake-cta-station/"
    ),
}


# --------------------------------------------------------------------------
# Socrata access
# --------------------------------------------------------------------------


def soda(dataset_id: str, params: dict, timeout: int = 120):
    """GET a Socrata SODA JSON endpoint. Returns parsed JSON."""
    url = "https://{}/resource/{}.json?{}".format(
        DOMAIN, dataset_id, urllib.parse.urlencode(params)
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError("HTTP {} from {}".format(resp.status, url))
        return json.loads(resp.read().decode("utf-8"))


def dataset_vintage(dataset_id: str, timeout: int = 60) -> str:
    """Publisher's own last-updated timestamp for the dataset (UTC ISO-8601)."""
    url = "https://{}/api/views/{}.json".format(DOMAIN, dataset_id)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        meta = json.loads(resp.read().decode("utf-8"))
    ts = meta.get("rowsUpdatedAt")
    if not ts:
        return ""
    return dt.datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%dT%H:%M:%SZ")


def month_bounds(year: int, month: int):
    last = calendar.monthrange(year, month)[1]
    return (
        "{:04d}-{:02d}-01T00:00:00".format(year, month),
        "{:04d}-{:02d}-{:02d}T23:59:59".format(year, month, last),
        last,
    )


def write_raw(name: str, payload) -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    return path


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------


def latest_full_month():
    """Ask the dataset for its own coverage; derive the latest COMPLETE month."""
    row = soda(RIDERSHIP["dataset_id"], {"$select": "max(date) as maxd, min(date) as mind, count(*) as n"})[0]
    maxd = dt.datetime.strptime(row["maxd"][:10], "%Y-%m-%d").date()
    mind = dt.datetime.strptime(row["mind"][:10], "%Y-%m-%d").date()
    total_rows = int(row["n"])

    days_in_max_month = calendar.monthrange(maxd.year, maxd.month)[1]
    if maxd.day == days_in_max_month:
        y, m = maxd.year, maxd.month  # the max month ran to its final day
    else:
        y, m = (maxd.year - 1, 12) if maxd.month == 1 else (maxd.year, maxd.month - 1)
    return y, m, maxd, mind, total_rows


def fetch_month(year: int, month: int, label: str):
    """Download every published daily row for one calendar month."""
    start, end, days_in_month = month_bounds(year, month)
    rows = soda(
        RIDERSHIP["dataset_id"],
        {
            "$select": "station_id, stationname, date, daytype, rides",
            "$where": "date between '{}' and '{}'".format(start, end),
            "$order": "station_id, date",
            "$limit": "200000",
        },
    )
    write_raw("raw_5neh-572f_{:04d}-{:02d}.json".format(year, month), rows)

    # Publisher-side count for the same filter — the number we verify against.
    src_count = int(
        soda(
            RIDERSHIP["dataset_id"],
            {
                "$select": "count(*) as n",
                "$where": "date between '{}' and '{}'".format(start, end),
            },
        )[0]["n"]
    )
    if src_count != len(rows):
        raise RuntimeError(
            "{}: downloaded {} rows but source counts {}".format(label, len(rows), src_count)
        )

    dates = {r["date"][:10] for r in rows}
    complete = len(dates) == days_in_month
    return {
        "label": label,
        "year": year,
        "month": month,
        "rows": rows,
        "source_count": src_count,
        "distinct_dates": len(dates),
        "days_in_month": days_in_month,
        "complete": complete,
    }


def avg_weekday_by_station(rows):
    """Unweighted mean of published daytype='W' daily entries, per station."""
    acc = defaultdict(lambda: {"sum": 0, "n": 0, "name": None})
    for r in rows:
        if r.get("daytype") != WEEKDAY_CODE:
            continue
        sid = str(int(r["station_id"]))
        a = acc[sid]
        a["sum"] += int(r["rides"])
        a["n"] += 1
        a["name"] = r.get("stationname")
    return {
        sid: {"avg": a["sum"] / a["n"], "n_days": a["n"], "name": a["name"]}
        for sid, a in acc.items()
        if a["n"] > 0
    }


def fetch_stops():
    """Station geography + line service, keyed by map_id (the ridership station_id)."""
    rows = soda(
        STOPS["dataset_id"],
        {"$select": ":*, *", "$order": "map_id, stop_id", "$limit": "5000"},
    )
    write_raw("raw_8pix-ypme_stops.json", rows)

    src_count = int(soda(STOPS["dataset_id"], {"$select": "count(*) as n"})[0]["n"])
    if src_count != len(rows):
        raise RuntimeError(
            "stops: downloaded {} rows but source counts {}".format(len(rows), src_count)
        )

    stations = {}
    coord_conflicts = []
    for r in rows:
        mid = r.get("map_id")
        if mid is None:
            continue
        sid = str(int(mid))
        loc = r.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        st = stations.setdefault(
            sid,
            {
                "station_name": r.get("station_name") or "",
                "lines": set(),
                "lat": None,
                "lng": None,
                "coord_stop_id": None,
                "stop_ids": [],
            },
        )
        st["stop_ids"].append(r.get("stop_id"))
        for col, pretty in LINE_COLUMNS:
            if r.get(col) in (True, "true", "True"):
                st["lines"].add(pretty)
        if lat and lng:
            if st["lat"] is None:
                # First published stop row for this station wins. Verbatim copy,
                # never a computed centroid.
                st["lat"], st["lng"] = lat, lng
                st["coord_stop_id"] = r.get("stop_id")
            elif (st["lat"], st["lng"]) != (lat, lng):
                coord_conflicts.append((sid, st["station_name"], st["lat"], st["lng"], lat, lng))

    return {
        "stations": stations,
        "row_count": len(rows),
        "source_count": src_count,
        "coord_conflicts": coord_conflicts,
    }


def order_lines(line_set):
    order = [p for _, p in LINE_COLUMNS]
    return "|".join(sorted(line_set, key=order.index))


def last_nonzero_date(station_id: str):
    """Raw lookup: the most recent published date this station had rides > 0."""
    r = soda(
        RIDERSHIP["dataset_id"],
        {
            "$select": "max(date) as d",
            "$where": "station_id = {} AND rides > 0".format(int(station_id)),
        },
    )
    d = r[0].get("d") if r else None
    return d[:10] if d else None


def zero_status_note(station_id: str, n_weekdays: int, month: str) -> str:
    """Explain a published zero from raw evidence, plus a sourced citation."""
    last = last_nonzero_date(station_id)
    note = (
        "PUBLISHED ZERO, NOT MISSING DATA: source reports 0 entries on all {} "
        "weekdays of {}. Last published date with entries > 0: {}. Station is "
        "not in service - do not read as low ridership."
    ).format(n_weekdays, month, last or "none in dataset")
    extra = STATION_STATUS_ANNOTATIONS.get(station_id)
    return note + (" " + extra if extra else "")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="Force target month as YYYY-MM (default: latest complete)")
    args = ap.parse_args()

    retrieved = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print("retrieval_date_utc: {}".format(retrieved))

    y, m, maxd, mind, total_rows = latest_full_month()
    print("ridership dataset coverage: {} .. {}  ({} rows total)".format(mind, maxd, total_rows))
    if args.month:
        y, m = int(args.month[:4]), int(args.month[5:7])
    target_month = "{:04d}-{:02d}".format(y, m)
    print("target month (latest complete): {}".format(target_month))

    cur = fetch_month(y, m, target_month)
    if not cur["complete"]:
        raise RuntimeError(
            "{} is not a complete month: {} distinct dates vs {} calendar days".format(
                target_month, cur["distinct_dates"], cur["days_in_month"]
            )
        )

    prior_label = "{:04d}-{:02d}".format(y - 1, m)
    try:
        prior = fetch_month(y - 1, m, prior_label)
    except Exception as exc:  # pragma: no cover - network/absent month
        print("prior-year month {} unavailable: {}".format(prior_label, exc))
        prior = None

    cur_avg = avg_weekday_by_station(cur["rows"])
    prior_avg = avg_weekday_by_station(prior["rows"]) if prior else {}

    stops = fetch_stops()
    stations = stops["stations"]

    rows_out = []
    omitted_no_geo = []
    omitted_no_weekday = []
    zero_stations = []

    for sid in sorted(cur_avg, key=lambda s: -cur_avg[s]["avg"]):
        rec = cur_avg[sid]
        st = stations.get(sid)
        if st is None or not st["lat"] or not st["lng"]:
            omitted_no_geo.append((sid, rec["name"], round(rec["avg"], 1)))
            continue
        note = ""
        if rec["avg"] == 0:
            note = zero_status_note(sid, rec["n_days"], target_month)
            zero_stations.append((sid, rec["name"], note))
        rows_out.append(
            {
                "station_id": sid,
                # Ridership file's own station label is authoritative for the
                # ridership row; kept verbatim.
                "station_name": rec["name"] or st["station_name"],
                "lines": order_lines(st["lines"]),
                "lat": st["lat"],
                "lng": st["lng"],
                "avg_weekday_entries": "{:.1f}".format(rec["avg"]),
                "month": target_month,
                # Blank == not published for that station/month. Never a zero.
                "prior_year_avg_weekday_entries": (
                    "{:.1f}".format(prior_avg[sid]["avg"]) if sid in prior_avg else ""
                ),
                "status_note": note,
            }
        )

    # Stations present in the geography file but with no published weekday
    # ridership row for the target month: explicit omissions, never zeros.
    ridership_ids = {str(int(r["station_id"])) for r in cur["rows"]}
    for sid, st in stations.items():
        if sid not in cur_avg:
            omitted_no_weekday.append(
                (sid, st["station_name"], "in ridership file" if sid in ridership_ids else "absent from ridership file")
            )

    os.makedirs(os.path.dirname(OUT_CSV), exist_ok=True)
    fields = [
        "station_id",
        "station_name",
        "lines",
        "lat",
        "lng",
        "avg_weekday_entries",
        "month",
        "prior_year_avg_weekday_entries",
        # Trailing, additive column. Empty for every ordinary station; carries a
        # sourced explanation wherever the published value is a true zero.
        "status_note",
    ]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows_out)

    # ---------------- verification report ----------------
    weekday_rows = sum(1 for r in cur["rows"] if r["daytype"] == WEEKDAY_CODE)
    weekday_dates = len({r["date"][:10] for r in cur["rows"] if r["daytype"] == WEEKDAY_CODE})

    print("")
    print("=== VERIFICATION ===")
    print("ridership vintage (publisher rowsUpdatedAt): {}".format(dataset_vintage(RIDERSHIP["dataset_id"])))
    print("stops vintage (publisher rowsUpdatedAt):     {}".format(dataset_vintage(STOPS["dataset_id"])))
    print("{}: downloaded {} rows == source count({}) : {}".format(
        target_month, len(cur["rows"]), cur["source_count"], len(cur["rows"]) == cur["source_count"]))
    print("{}: distinct dates {} == calendar days {} : {}".format(
        target_month, cur["distinct_dates"], cur["days_in_month"], cur["complete"]))
    print("{}: weekday(daytype=W) rows {} across {} weekday dates".format(
        target_month, weekday_rows, weekday_dates))
    if prior:
        print("{}: downloaded {} rows == source count({}) : {}".format(
            prior_label, len(prior["rows"]), prior["source_count"], len(prior["rows"]) == prior["source_count"]))
        print("{}: distinct dates {} == calendar days {} : {}".format(
            prior_label, prior["distinct_dates"], prior["days_in_month"], prior["complete"]))
    print("stops: downloaded {} rows == source count({}) : {}".format(
        stops["row_count"], stops["source_count"], stops["row_count"] == stops["source_count"]))
    print("stops: {} distinct map_id stations".format(len(stations)))

    # Independent cross-check: recompute every average server-side with
    # Socrata's own aggregation engine and diff against our local arithmetic.
    start, end, _ = month_bounds(y, m)
    remote = soda(
        RIDERSHIP["dataset_id"],
        {
            "$select": "station_id, avg(rides) as a, count(*) as n",
            "$where": "date between '{}' and '{}' AND daytype = '{}'".format(start, end, WEEKDAY_CODE),
            "$group": "station_id",
            "$limit": "5000",
        },
    )
    max_delta, delta_station = 0.0, None
    for r in remote:
        sid = str(int(r["station_id"]))
        d = abs(float(r["a"]) - cur_avg[sid]["avg"])
        if d > max_delta:
            max_delta, delta_station = d, sid
    print("cross-check vs Socrata server-side avg(rides): {} stations, max abs delta {:.9f} ({})".format(
        len(remote), max_delta, delta_station or "n/a"))

    # Coordinate conflicts: stops of one station published at different points
    # (e.g. a subway platform and an elevated platform). We copy ONE real
    # published stop's coordinates verbatim (lowest stop_id) — never a centroid.
    seen_conflict = sorted({(c[0], c[1]) for c in stops["coord_conflicts"]})
    print("stations whose stop rows carry differing coordinates: {}".format(len(seen_conflict)))
    for sid, nm in seen_conflict:
        st = stations[sid]
        print("   {} {!r}: using stop_id {} at {},{} (verbatim, lowest stop_id of {})".format(
            sid, nm, st["coord_stop_id"], st["lat"], st["lng"], sorted(st["stop_ids"])))
    print("")
    print("join key: 5neh-572f.station_id  ==  8pix-ypme.map_id (integer parent-station id)")
    print("stations with weekday ridership in {}: {}".format(target_month, len(cur_avg)))
    print("artifact rows written: {}".format(len(rows_out)))
    print("OMITTED - ridership but no geographic join: {}".format(len(omitted_no_geo)))
    for o in omitted_no_geo:
        print("   omit(no geo) station_id={} name={!r} avg_weekday={}".format(*o))
    print("OMITTED - in stops file but no weekday ridership in {}: {}".format(target_month, len(omitted_no_weekday)))
    for o in omitted_no_weekday:
        print("   omit(no ridership) station_id={} name={!r} ({})".format(*o))
    blanks = sum(1 for r in rows_out if r["prior_year_avg_weekday_entries"] == "")
    print("blank prior_year values (not published, NOT zero): {}".format(blanks))
    print("PUBLISHED ZEROS (kept verbatim, annotated, never dropped): {}".format(len(zero_stations)))
    for sid, nm, note in zero_stations:
        print("   zero station_id={} name={!r}".format(sid, nm))
        print("      {}".format(note))
    annotated = {sid for sid, _, _ in zero_stations}
    unsourced = [s for s in annotated if s not in STATION_STATUS_ANNOTATIONS]
    if unsourced:
        print("   WARNING: published zeros with no sourced annotation: {}".format(unsourced))

    print("")
    print("=== SPOT CHECKS (by CTA station_id — the two Garfields share a name) ===")
    # station_id -> (label, real-world location the coordinates must land near)
    want = [
        ("40240", "79th (Red)", "79th St & S State St, Chatham/Greater Grand Crossing"),
        ("40450", "95th/Dan Ryan (Red)", "95th St & S State St, Roseland"),
        ("40510", "Garfield (Green)", "E 55th St & S Prairie Ave, Washington Park"),
        ("41170", "Garfield (Red)", "W Garfield Blvd & Dan Ryan, New City/Fuller Park"),
    ]
    by_id = {r["station_id"]: r for r in rows_out}
    for sid, label, where in want:
        h = by_id.get(sid)
        if not h:
            print("  {} ({}): NOT FOUND in artifact".format(label, sid))
            continue
        print("  {} -> id {} name={!r} lines={} lat/lng {},{}".format(
            label, sid, h["station_name"], h["lines"], h["lat"], h["lng"]))
        print("      avg_weekday_entries={} [{}]  prior_year={}   expect near: {}".format(
            h["avg_weekday_entries"], h["month"],
            h["prior_year_avg_weekday_entries"] or "(blank - not published)", where))

    print("")
    print("artifact: {}  ({} bytes)".format(OUT_CSV, os.path.getsize(OUT_CSV)))
    print("raw downloads: {}".format(RAW_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
