# Site Activity Context — source register

Every artifact in this directory is built from **raw public records only**. There are
no modeled coefficients, no capture rates, no synthesized visitor counts, and no
interpolated values anywhere in these files. Each row traces to a single published
record that can be re-fetched from the verify-URL below.

**Rules this directory is held to**

- A value appears here only if a public agency published it. If an agency published
  nothing for a place, that place is **absent** — never zero, never a guess.
- Where a geometry had to be reduced (a line to a point), the reduction is stated
  explicitly and is a transformation of published geometry, never an estimate of an
  unpublished location.
- Ingestion scripts live in `scripts/site-activity/` so any row can be regenerated.
- Raw downloads are kept out of the repo (scratchpad only); committed artifacts carry
  the minimum columns needed.

Each feed owns one `## Feed N` section below **and** a machine-readable sidecar
(`<artifact>.manifest.json`) holding the same provenance. Feeds are built by separate
processes writing into this shared file — **append your section, never rewrite the
file** — and the sidecar manifest is the authoritative copy if the two ever disagree.

---

## Feed 1 — IDOT AADT (Annual Average Daily Traffic) segments, Chicago bounding box

| Field | Value |
| --- | --- |
| **Artifact** | `data/curated/site-activity/idot_aadt_stations.csv` |
| **Dataset id** | `AdministrativeData/AADT` — MapServer **layer 0, "Traffic Volume"** |
| **Publisher** | Illinois Department of Transportation (IDOT) — Traffic Count Program, via the Getting Around Illinois ArcGIS server (`gis1.dot.illinois.gov`) |
| **Access** | Public ArcGIS REST, **no API key** |
| **Vintage** | Per-row, carried in `aadt_year`: **2016–2025**, concentrated in 2025 (10,908 rows) and 2022 (9,956 rows). The service publishes **no** `lastEditDate` / `editingInfo`, so there is no single service-level vintage to report — the per-row count year is the only vintage IDOT states, and it is passed through unmodified. |
| **Retrieved** | **2026-08-04** |
| **Ingestion script** | `scripts/site-activity/fetch_idot_aadt.py` (python3, stdlib only) |
| **Rows** | **23,242** |
| **File size** | 1.1 MB |
| **Sidecar manifest** | `data/curated/site-activity/idot_aadt_stations.manifest.json` |
| **Artifact sha256** | `9382bcfa533e4c056d9066657a16ff8b5f8fcf45c95a20d7739a88b8a0aba250` |

### Verify URLs (public, no key, paste into a browser)

- **Layer landing page / field definitions**
  `https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT/MapServer/0`
- **The source's own row count for this exact bounding box** — returns `{"count":24178}`
  `https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT/MapServer/0/query?geometry=-87.95%2C41.62%2C-87.5%2C42.05&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=1%3D1&returnCountOnly=true&f=json`
- **Any single row**, substituting its `station_or_segment_id` for `224714`
  `https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT/MapServer/0/query?where=OBJECTID%3D224714&outFields=OBJECTID%2CROAD_NAME%2CAADT%2CAADT_YR&returnGeometry=false&f=json`
- **Program context** — IDOT Traffic Count Program / Getting Around Illinois
  `https://www.gettingaroundillinois.com/` · `https://apps.dot.illinois.gov/gist2/`

### Columns

| Column | Meaning |
| --- | --- |
| `station_or_segment_id` | The layer's `OBJECTID`. **Why not `INVENTORY`:** IDOT's inventory number is a *route* identifier and repeats across many segments (e.g. `016  91547 000000` covers multiple 79th St segments), so it cannot key a row. `OBJECTID` is unique and is the value the per-row verify-URL accepts. |
| `road_name` | IDOT's `ROAD_NAME`, trimmed. **57 rows are blank** because IDOT published no road name for that segment. Blank is an explicit omission — no name was inferred from neighbors or geometry. |
| `lat`, `lng` | WGS84 (EPSG:4326), 6 decimals. **Segment midpoint — see below.** |
| `aadt` | IDOT's `AADT` integer, passed through unchanged. |
| `aadt_year` | IDOT's `AADT_YR` integer — the year that count was taken. |

### Line → point reduction (required disclosure)

**This service returns line segments, not point count stations.** Layer 0 geometry
type is `esriGeometryPolyline`. Each row's `lat`/`lng` is the point at **50 % of the
cumulative 2-D path length** of that segment's own published geometry (longitude
scaled by `cos(mean latitude)` so the traversal is length-proportional rather than
degree-proportional). This is a deterministic reduction of published geometry. It is
**not** an estimate of where a counter was physically installed, and it should not be
read as one. The AADT value applies to the whole segment, not to the midpoint.

Verified: every midpoint lies within its own segment's envelope, and the maximum
distance of any midpoint from its own polyline is **0.069 m** (6-decimal rounding).

### Geographic filter and the 936 excluded rows

The bounding box is **lat 41.62 – 42.05, lng −87.95 – −87.50**. The service query used
`esriSpatialRelIntersects`, which returns **24,178** segments — including segments that
merely cross the box edge. Of those, **936 have a midpoint that falls outside the box**
and were dropped so that every committed row's coordinates are genuinely inside the
stated box. Nothing was clipped, re-anchored, or moved to make it fit.

**This bounding box is not the City of Chicago boundary.** It is a rectangle that
contains Chicago and also covers parts of Evanston, Skokie, Cicero, Berwyn, Oak Park,
Burbank, Calumet City and other near suburbs. Rows here are "inside the Chicago
bounding box", not "inside Chicago". Any downstream use that needs city limits must
apply a municipal-boundary filter of its own.

### Verification performed 2026-08-04

| Check | Result |
| --- | --- |
| Source's own count for the bbox (`returnCountOnly`) | 24,178 |
| Features actually retrieved by paging | **24,178 — exact match** |
| Dropped: no usable geometry | 0 |
| Dropped: midpoint outside bbox | 936 |
| Rows written | 23,242 |
| Duplicate `station_or_segment_id` | 0 |
| `aadt` null or ≤ 0 | 0 (IDOT publishes no null/zero AADT in this box) |
| `aadt_year` null or 0 | 0 |
| Attribute fidelity: CSV re-checked field-by-field against the raw API payloads | 23,242 / 23,242 exact, **0 mismatches** |
| `lat` range | 41.620007 – 42.050000 (inside box) |
| `lng` range | −87.949960 – −87.525127 (inside box) |
| `aadt` min / median / max | 20 / 14,200 / 343,600 |

**Named spot-checks** (nearest segment midpoint to a real Chicago intersection; each
value was then **re-read from the live service** by `OBJECTID`, not from local state):

| Location | Segment id | Road | AADT | Year | Midpoint | Offset from intersection |
| --- | --- | --- | --- | --- | --- | --- |
| 79th St @ Cottage Grove Ave (Chatham) | 224714 | 79th St | **9,100** | 2022 | 41.751303, −87.604260 | 115 m |
| Western Ave @ 63rd St (Chicago Lawn) | 222436 | Western Ave | **29,000** | 2022 | 41.778873, −87.683643 | 40 m |
| Stony Island Ave @ 79th St (Avalon Park) | 224613 | Stony Island Ave | **33,100** | 2022 | 41.752180, −87.585850 | 159 m |

Plausibility notes, stated honestly rather than tuned:

- **79th St** was expected at roughly 10–20k. Across the 89 IDOT segments on 79th St
  within the Chicago city stretch (lng −87.75 to −87.53) the distribution is
  min 9,100 / p25 12,900 / **median 16,000** / p75 18,100 / max 22,700 — inside the
  expected band. The Cottage Grove segment at 9,100 is the low end of that corridor,
  and it is reported as published rather than replaced with the corridor median.
- **Western Ave** 29,000 and **Stony Island Ave** 33,100 are consistent with six-to-
  eight-lane arterials.
- The 343,600 maximum is **Dan Ryan Expwy (I-90/94), 2025** — an expressway segment,
  not an arterial. Downstream consumers that want street-level activity should filter
  expressway rows out; they are retained here because IDOT published them and the
  bounding box is the only filter this artifact applies.

### Known limitations

- AADT is an **annual average daily** volume by IDOT's own methodology; it is not a
  measured count for any particular day, and it is not pedestrian traffic.
- Coverage is IDOT's inventoried network. Many local/residential Chicago streets are
  **not counted at all** and are therefore simply absent — their absence means "IDOT
  published no count", not "no traffic".
- Mixed vintages: a 2016 row and a 2025 row sit side by side. Always read `aadt_year`
  before comparing two segments.
- No XML is parsed in this pipeline (the endpoint is queried with `f=json`). If XML
  ingestion is ever added, it must reject documents containing `DOCTYPE` or `ENTITY`
  declarations before parsing.

### Fallback source — not used

`data.illinois.gov` / the IDOT open-data AADT shapefile was **not** used. The ArcGIS
REST service above was reachable and authoritative throughout, so it is the sole
source for this artifact.

---

## Feed 2 — CTA "L" station average weekday entries

| Field | Value |
| --- | --- |
| **Artifact** | `data/curated/site-activity/cta_l_station_avg_weekday.csv` |
| **Dataset id (ridership)** | `5neh-572f` — "CTA - Ridership - 'L' Station Entries - Daily Totals" |
| **Dataset id (geography)** | `8pix-ypme` — "CTA - System Information - List of 'L' Stops" |
| **Publisher** | Chicago Transit Authority, via the City of Chicago Data Portal (Socrata) |
| **Access** | Public Socrata SODA endpoints, **no API key** |
| **Data vintage (the measured month)** | **2026-05** (May 2026) — the latest **complete** calendar month in the dataset. Prior-year comparison month: **2025-05**. |
| **Publisher vintage — ridership** | `rowsUpdatedAt` = **2026-07-10T14:27:47Z**. Dataset coverage 2001-01-01 → **2026-05-31**. |
| **Publisher vintage — stops** | `rowsUpdatedAt` = **2025-11-19T18:14:37Z** |
| **Retrieved** | **2026-08-04** |
| **Ingestion script** | `scripts/site-activity/build_cta_l_station_avg_weekday.py` (python3, stdlib only) |
| **Rows** | **144** (every station the CTA published for the month) |
| **File size** | 10.5 KB |

### How the month is chosen (not hard-coded)

The script asks the dataset for its own `max(date)`, then derives the latest month that
ran to its final calendar day, and **proves completeness before using it**: distinct
published dates must equal the number of calendar days in that month. May 2026 passed
with 31/31 days. `--month YYYY-MM` can pin a specific month for reproducibility.

### Verify URLs (public, no key, paste into a browser)

- **Ridership dataset landing page**
  `https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f`
- **Stops / geography dataset landing page**
  `https://data.cityofchicago.org/Transportation/CTA-System-Information-List-of-L-Stops/8pix-ypme`
- **The source's own row count for the month** — returns `{"n":"4464"}`
  `https://data.cityofchicago.org/resource/5neh-572f.json?$select=count(*)%20as%20n&$where=date%20between%20%272026-05-01T00:00:00%27%20and%20%272026-05-31T23:59:59%27`
- **Every raw weekday row behind one station** (substitute any `station_id`; `40240` = 79th)
  `https://data.cityofchicago.org/resource/5neh-572f.json?$select=date,daytype,rides&$where=station_id=40240%20AND%20daytype=%27W%27%20AND%20date%20between%20%272026-05-01T00:00:00%27%20and%20%272026-05-31T23:59:59%27&$order=date`
- **The source computing the same average itself** — returns `avg_weekday = 3838.8`, `weekdays = 20`
  `https://data.cityofchicago.org/resource/5neh-572f.json?$select=station_id,avg(rides)%20as%20avg_weekday,count(*)%20as%20weekdays&$where=station_id=40240%20AND%20daytype=%27W%27%20AND%20date%20between%20%272026-05-01T00:00:00%27%20and%20%272026-05-31T23:59:59%27&$group=station_id`
- **The published coordinates for one station**
  `https://data.cityofchicago.org/resource/8pix-ypme.json?map_id=40240&$select=map_id,station_name,station_descriptive_name,location`
- **State/Lake closure (context for the one published zero)**
  `https://www.transitchicago.com/construction-to-begin-in-january-on-new-fully-accessible-statelake-cta-station/`

### Columns

| Column | Meaning |
| --- | --- |
| `station_id` | CTA parent-station id. This is `station_id` in `5neh-572f` **and** `map_id` in `8pix-ypme` — the join key. |
| `station_name` | Taken verbatim from the **ridership** file's `stationname`. **Deliberately not** the stops file's `station_name`: the stops file labels both Garfield stations simply "Garfield", while the ridership file disambiguates them as `Garfield-Dan Ryan` (Red) and `Garfield-South Elevated` (Green). The ridership label is the one that uniquely identifies the row. |
| `lines` | Pipe-separated CTA line names, derived from the boolean service columns (`red`,`blue`,`brn`,`g`,`o`,`pnk`,`p`,`pexp`,`y`) on the station's stop rows, unioned across platforms and emitted in a fixed order. 17 distinct combinations. |
| `lat`, `lng` | WGS84, **copied verbatim** from one real published stop row. See the coordinate note below. |
| `avg_weekday_entries` | Unweighted mean of the published daily `rides` values where `daytype = 'W'`, over the 20 weekdays of the month. One decimal. |
| `month` | `2026-05` on every row. |
| `prior_year_avg_weekday_entries` | Same computation for 2025-05. **Blank means the source published nothing for that station that month — it never means zero.** 0 blanks in this build. |
| `status_note` | Trailing, additive column. **Empty on 143 of 144 rows.** Carries a sourced explanation wherever the published value is a true zero — see below. |

### `daytype` and what "weekday" means

CTA publishes a `daytype` code per row: **`W` = Weekday, `A` = Saturday, `U` = Sunday/Holiday.**
Only `daytype = 'W'` rows are averaged. May 2026 breaks down as 20 `W` + 5 `A` + 6 `U` = 31 days.
Note that CTA codes **holidays as `U`**, so Memorial Day (2026-05-25, a Monday) is excluded
from the weekday average by the publisher's own classification, not by ours.

### Entries, not ridership

`rides` in this dataset counts **entries** (faregate/turnstile entries at that station).
It does not count exits, transfers between lines inside paid areas, or people who pass
the station without entering. A station average is therefore a measure of **boardings at
that station**, and must not be presented as foot traffic, visitor count, or total
ridership of the line.

### The join

**Join key: `5neh-572f.station_id` = `8pix-ypme.map_id`** (integer parent-station id, the
`4xxxx` range). Names were **not** used for joining — the duplicate "Garfield" labels in the
stops file would have collided.

| Join outcome | Count |
| --- | --- |
| Stations with weekday ridership in 2026-05 | 144 |
| Stations in the stops file (distinct `map_id`) | 144 |
| **Joined successfully** | **144 (100 %)** |
| Failed to join → omitted for lack of coordinates | **0** |
| In stops file but no weekday ridership → omitted | **0** |

No station in this feed failed to join, so there are no geography-driven omissions to report.

### Coordinate note — one real point, never a centroid

`8pix-ypme` publishes one row per **stop** (platform/direction), 302 rows across 144
stations, so most stations have 2+ rows. The script copies the coordinates of a single
real published stop row (lowest `stop_id`, deterministic) and **never averages platforms
into a synthetic centroid**.

Exactly **one** station publishes materially different coordinates across its own stops:
**Roosevelt (`41400`)**, whose subway and elevated platforms sit ~70 m apart
(`41.867405,-87.62659` vs `41.867368,-87.627402`). The committed row uses `stop_id` 30080
at `41.867405,-87.62659` — a real published point, not a midpoint between them.

### The one published zero — State/Lake (`40260`)

`State/Lake` is written with `avg_weekday_entries = 0.0`. **This is a published measurement,
not missing data, and it is not an imputed zero.** The source reports `rides = 0` for all
31 days of May 2026; the last date with entries > 0 is **2026-01-31**, and monthly totals
run 178,990 (Dec 2025) → 15,976 (Jan 2026) → **0** from Feb 2026 onward.

That drop matches the public record: CTA closed State/Lake on **2026-01-05** for a full
station reconstruction, with reopening expected in 2029
(`https://www.transitchicago.com/construction-to-begin-in-january-on-new-fully-accessible-statelake-cta-station/`).

The row is **kept, not dropped** — dropping a real published record would lose traceability —
and its `status_note` spells out that the station is out of service. **Any downstream
consumer must exclude this station rather than render it as a zero-activity location in the
Loop.** Its 2025-05 prior-year value (7,992.7) is genuine and predates the closure, so a
naive year-over-year calculation on this row will show −100 %.

The script flags any published zero it cannot cite a public source for; there are none in
this build.

### Verification performed 2026-08-04

| Check | Result |
| --- | --- |
| 2026-05 rows downloaded vs source's own `count(*)` | 4,464 vs **4,464 — exact match** |
| 2026-05 distinct dates vs calendar days | 31 vs **31 — month complete** |
| 2026-05 weekday rows | 2,880 across 20 weekday dates (144 × 20) |
| 2025-05 rows downloaded vs source's own `count(*)` | 4,464 vs **4,464 — exact match** |
| 2025-05 distinct dates vs calendar days | 31 vs **31 — month complete** |
| Stops rows downloaded vs source's own `count(*)` | 302 vs **302 — exact match** |
| **Independent recomputation:** all 144 averages re-derived by Socrata's own `avg(rides)` engine and diffed against local arithmetic | **max absolute delta 0.000000000** |
| Rows written | 144 |
| Duplicate `station_id` | 0 |
| Blank `lines` | 0 |
| Blank `prior_year_avg_weekday_entries` | 0 |
| Coordinates outside a Chicago-area bbox (41.60–42.10, −87.95–−87.50) | 0 |
| `lat` range | 41.722377 – 42.073153 |
| `lng` range | −87.904223 – −87.605857 |
| `avg_weekday_entries` min / p25 / median / p75 / max (excl. the closed station) | 297.2 / 894.8 / 2,013.0 / 3,656.8 / 13,231.5 |

**Named spot-checks.** Each value was re-read from the live service after the file was
written, and each coordinate was reverse-geocoded against **OpenStreetMap** — a source
entirely independent of CTA — to confirm it lands at the right real-world place:

| Station | id | Lines | `avg_weekday_entries` (2026-05) | Prior year (2025-05) | Coordinates | Independent OSM reverse-geocode |
| --- | --- | --- | --- | --- | --- | --- |
| 79th | 40240 | Red | **3,838.8** | 4,068.5 | 41.750419, −87.625112 | "**79th Street CTA Station**, W 79th St, **Chatham**, Chicago, Cook County, IL **60620**" |
| 95th/Dan Ryan | 40450 | Red | **6,306.9** | 5,789.8 | 41.722377, −87.624342 | "14 W 95th St, **Roseland**, Chicago, Cook County, IL **60620**" |
| Garfield-South Elevated | 40510 | Green | **894.8** | 866.1 | 41.795172, −87.618327 | "S Calumet Ave, **Washington Park**, Chicago, Cook County, IL **60615**" |
| Garfield-Dan Ryan | 41170 | Red | **2,395.1** | 2,347.4 | 41.795420, −87.631157 | "**Garfield**, Dan Ryan Expressway, **Fuller Park**, Chicago, Cook County, IL **60621**" |

All four sit in the hundreds-to-thousands range as expected, and all four land in the
correct Chicago community area — OSM independently names two of them as the CTA station.
Note that "Garfield" is **two different stations** roughly a mile apart on either side of
Garfield Blvd; the Green Line one (894.8) and the Red Line one (2,395.1) must not be merged.

For scale context: 28 Red-Line-only stations run min 1,116.7 / median 2,956.2 / max 10,840.2,
and the 31 Green-Line-serving stations run median 861.6 — so 79th at 3,838.8 and
95th/Dan Ryan at 6,306.9 sit high on the Red Line, and Garfield (Green) at 894.8 sits at the
Green Line median. Nothing was tuned to produce these.

**System total** (sum of the 144 station averages): **385,031** average weekday entries in
2026-05 vs **369,002** in 2025-05, **+4.3 %**. This is reported as an observation, not a
headline metric — it is a sum of per-station means, not CTA's own published system ridership
figure, and should not be quoted as such.

### Known limitations

- **Entries only** — see above. Not foot traffic, not a visitor count, not line ridership.
- **Average of weekdays in one month.** May 2026 is a single month; it carries that month's
  seasonality, weather, service changes and construction. It is not an annual figure.
- **Stations, not neighborhoods.** A station average describes the station, not the blocks
  around it. Two stations a mile apart (both "Garfield") demonstrate why proximity joins
  downstream must use `station_id`, not name.
- **The stops file is ~8.5 months older than the ridership month** (stops `rowsUpdatedAt`
  2025-11-19 vs data month 2026-05). Any station opened after Nov 2025 could in principle
  lack coordinates — in this build none did, since all 144 joined.
- **No bus data of any kind is in this feed.** The only stop-level CTA bus ridership dataset
  on the portal is from 2012 and is stale; it was deliberately not used. Bus coverage is
  handled elsewhere via GTFS route presence only.
- **No XML is parsed in this pipeline** (Socrata is queried with `.json`). If XML ingestion is
  ever added it must reject documents containing `DOCTYPE` or `ENTITY` declarations before
  parsing.

---

## Feed 3 — Catchment centroids: block-group population + jobs, Cook County

One row per Cook County census block group, carrying the block group's official
internal point, its ACS total population, and its LEHD total jobs. Every number is
read verbatim from a federal file or is a documented sum of verbatim federal numbers.
Nothing is modeled, rated, or interpolated.

| Field | Value |
| --- | --- |
| **Artifact** | `data/curated/site-activity/catchment_block_groups.csv` |
| **Provenance manifest** | `data/curated/site-activity/catchment_block_groups.manifest.json` (per-source SHA-256, byte counts, source-reported totals, full omission GEOID lists) |
| **Ingestion script** | `scripts/site-activity/build_catchment_block_groups.py` (python3, stdlib only) |
| **Verification script** | `scripts/site-activity/verify_catchment_block_groups.py` (9 checks, all passing) |
| **Geography** | Cook County, Illinois only — every `bg_geoid` starts `17031` |
| **Rows** | **4,002** |
| **File size** | 302 KB |
| **Retrieved** | **2026-08-04** |

### Columns

| Column | Meaning |
| --- | --- |
| `bg_geoid` | 12-digit block group GEOID (`17` state + `031` county + 6-digit tract + 1-digit block group). Unique; primary key. |
| `lat`, `lng` | WGS84 **internal point** (`INTPTLAT` / `INTPTLON`) as published by TIGERweb, normalized to 7 decimals. This is the Census Bureau's own guaranteed-inside-the-polygon point, **not** a computed bounding-box centre and **not** a population-weighted centre. |
| `population` | ACS 5-year table **B01003_E001**, total population, passed through unchanged. |
| `acs_vintage` | `ACS 2020-2024 5-year` on every row. |
| `jobs` | LEHD LODES8 WAC **C000** (total jobs), summed from the workplace census blocks inside the block group. |
| `lodes_vintage` | `LODES8 2023` on every row. |

### Sources

**(a) Population — ACS 5-year Detailed Table B01003 (Total Population)**

| | |
| --- | --- |
| **Dataset id** | ACS 5-year Detailed Table `B01003`, table-based Summary File, 2024 release |
| **Publisher** | U.S. Census Bureau |
| **Vintage** | **ACS 2020–2024 5-year** (the latest 5-year release; 2019–2023 is also live and was compared) |
| **Retrieved** | 2026-08-04 |
| **SHA-256** | `38d1a992bb058d18…` (full hash in the manifest) · 18,313,708 bytes |
| **Verify URL** | `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat` |

> **Gotcha — the key-less Census API path is closed.** The task anticipated
> `api.census.gov` without a key. As of this build it does not work: any request
> lacking `&key=` returns **HTTP 302** to a `Missing Key` HTML interstitial, for every
> year tried (2023, 2024, 2025) and for both county- and block-group-level calls.
> `CENSUS_API_KEY` is referenced by `lib/census-acs.ts` but is not set in this
> worktree. Rather than fabricate, downgrade, or silently skip, this feed reads the
> **same estimates** from the Census Bureau's official table-based Summary File — the
> authoritative key-less bulk release of the identical table. The Summary File's own
> Cook County row is then used as the reconciliation target (see verification).
>
> **Vintage note, stated rather than assumed:** the task expected 2023 5-year. The
> 2024 5-year file is published and is newer, so it is what this artifact uses.
> For the record, the two disagree on the county total by 3,722 people
> (2019–2023: **5,185,812**; 2020–2024: **5,182,090**, −0.07 %). Switch with
> `--acs-year 2023` if a downstream consumer needs the older vintage.

**(b) Jobs — LEHD LODES8 Workplace Area Characteristics**

| | |
| --- | --- |
| **Dataset id** | `il_wac_S000_JT00_2023.csv.gz` — LODES8, Illinois, segment **S000** (all workers), job type **JT00** (all jobs), **C000** = total jobs |
| **Publisher** | U.S. Census Bureau — Longitudinal Employer-Household Dynamics (LEHD) |
| **Vintage** | **LODES8 2023** (latest year on the LEHD server; 2016–2023 available. The task anticipated ~2022 — 2023 is published and is used). File's own `createdate`: **2025-12-02** |
| **Retrieved** | 2026-08-04 |
| **SHA-256** | `02cd57766b9c1bd4…` (full hash in the manifest) · 2,135,450 bytes |
| **Verify URL** | `https://lehd.ces.census.gov/data/lodes/LODES8/il/wac/il_wac_S000_JT00_2023.csv.gz` |
| **Directory listing** | `https://lehd.ces.census.gov/data/lodes/LODES8/il/wac/` |

Block → block-group roll-up: LODES publishes one row per 15-digit workplace census
block; `jobs` is the sum of `C000` over every block whose geocode begins with the
12-digit `bg_geoid`. Straight summation, no weighting or apportionment.

**(c) Centroids — TIGERweb block-group internal points**

| | |
| --- | --- |
| **Dataset id** | TIGERweb `tigerWMS_ACS2024` MapServer **layer 10, "Census Block Groups"**, fields `INTPTLAT` / `INTPTLON` |
| **Publisher** | U.S. Census Bureau — Geography Division |
| **Vintage** | **TIGER/Line ACS 2024** (pinned to the ACS year so centroids and population describe the same polygons) |
| **Retrieved** | 2026-08-04 |
| **Verify URL** (returns `{"count":4002}`) | `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10/query?where=STATE%3D%2717%27+AND+COUNTY%3D%27031%27&returnCountOnly=true&f=json` |
| **Layer definition** | `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10?f=json` |

> **Gotcha — the Census Gazetteer has no block-group file.** The task named the
> Gazetteer first. It does not publish block groups: the finest geography in
> `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/` is the
> **census tract** (`2025_Gaz_tracts_national.zip`). Every `*_Gaz_bg_*` URL 404s for
> 2023, 2024 and 2025. TIGERweb — the alternative the task explicitly allows — is used
> instead, and it yields the same official `INTPTLAT`/`INTPTLON` internal points that a
> Gazetteer block-group file would have carried.

### Geography vintage alignment

All three sources sit on **2020 Census** block / block-group geography: ACS 2020–2024
tabulates to 2020 block groups, LODES8 is published on 2020 blocks, and
`tigerWMS_ACS2024` is the TIGER vintage matching the ACS release. The three
independently produced block-group sets agree exactly at 4,002, which is itself the
strongest available evidence that no vintage drift occurred.

### Verification performed 2026-08-04 — 9/9 checks passed

Re-run with `python3 scripts/site-activity/verify_catchment_block_groups.py`.

| # | Check | Result |
| --- | --- | --- |
| 1 | **Row count vs. the sources' own counts** | artifact **4,002** = TIGERweb `returnCountOnly` **4,002** = ACS Summary File block-group rows for 17031 **4,002**. Three independent counts, one number. |
| 2 | **Σ population vs. ACS Cook County total** (tolerance 1 %) | artifact **5,182,090** vs. ACS Summary File row `0500000US17031` **5,182,090** — delta **0**, **0.0000 %**. Inside the expected 5.1–5.3 M band. |
| 3 | **Σ jobs vs. LODES Cook County total** | artifact **2,683,238** vs. LODES IL WAC Cook total **2,683,238** — delta **0**. **LODES Illinois statewide total: 5,943,827** (Cook = **45.1 %** of Illinois jobs). Cook block rows read: 32,285. |
| 5 | **Integrity** | 0 duplicate GEOIDs; all 4,002 GEOIDs 12-digit under `17031`; all coordinates inside the Cook County bounding box; 0 negative counts; vintage stamped on every row. |
| 5b | **Lake Michigan block group** | `170319900000` retained and understood (see below). |

**Named spot-checks (check 4).** Each address is resolved to its 2020 census block by
the **Census Geocoder** — an authority independent of all three ingested files — then
truncated to the block group and looked up in the artifact. The GEOIDs are never
hand-typed, so the check cannot be quietly fitted to the data. Centroid distance to the
geocoded address is asserted too.

| Location | Block group | Population | Jobs | Shape | Centroid vs. geocoded |
| --- | --- | --- | --- | --- | --- |
| **Willis Tower**, 233 S Wacker Dr (Loop) | `170318391002` | 3,399 | **60,837** | jobs **17.9×** population | within tolerance |
| **Chicago City Hall**, 121 N LaSalle St (Loop) | `170318391001` | 4,956 | **280,967** | jobs **56.7×** population | within tolerance |
| **Mount Greenwood Park**, 3721 W 111th St (bungalow belt) | `170317404003` | **2,313** | 314 | population **7.4×** jobs | within tolerance |
| **Leo High School**, 7901 S Sangamon St (Auburn Gresham) | `170317108001` | **723** | 46 | population **15.7×** jobs | within tolerance |

The Loop pair and the bungalow-belt pair invert exactly as the task predicted, which is
the substantive signal that the population and jobs columns are correctly joined and
not transposed.

### Omissions and zeros — read this before using the `jobs` column

- **Block groups with no ACS population estimate: 0.** No Cook County block group
  carried a jam value (`-555555555`, `-666666666`, …) or was absent. Had any, the
  `population` cell would have been written **empty**, never `0`.
- **Block groups absent from the LODES WAC file: 50, written as `0`.** This is the one
  place a zero is written rather than a blank, and the reasoning is explicit: the WAC
  file is a **complete enumeration** of workplace blocks holding at least one job, so a
  block group none of whose blocks appear in it is a **source-asserted zero**, not a
  gap. Those 50 block groups hold **40,119 people (0.77 % of the county)** and are
  overwhelmingly residential (median population 730). Their full GEOID list is in the
  manifest under `block_groups_absent_from_lodes_wac_geoids` — a consumer that would
  rather treat them as unknown can null them from that list.
- **LODES block groups with no TIGERweb centroid: 0.** No jobs were dropped on the join.
- **The Lake Michigan block group is real and is retained.** `170319900000` (tract
  9900.00, block group 0) has `AREALAND = 0` and `AREAWATER = 1,717,072,182 m²`; its
  internal point (41.9739, −87.4003) sits out in the lake because **Cook County's legal
  boundary extends into Lake Michigan** to the Illinois/Indiana/Michigan tripoint. Its
  `population = 0` is a genuine published ACS estimate (`0`, MOE 13), and its
  `jobs = 0` reflects zero LODES blocks in tract 990000. It is kept so the row count
  reconciles exactly to both sources; filter `bg_geoid = '170319900000'` if a
  downstream map should not draw a point in the lake.

### Known limitations

- ACS values are **5-year estimates with margins of error**, not counts. The MOE column
  exists in the Summary File and was deliberately **not** carried into the artifact
  (schema is fixed at 7 columns); re-read it from the source file if a consumer needs
  to reason about precision.
- **LODES excludes** most self-employment, and federal/military and some agricultural
  employment are handled differently from private wage-and-salary jobs. `jobs` is
  "LEHD-covered jobs at this workplace", not "all economic activity".
- **LODES applies noise infusion** for confidentiality. Individual block-group values
  are approximate by design even though the county total reconciles exactly; the data
  is intended for aggregate use, and single-block-group readings should be treated with
  care.
- `jobs` is **workplace-based** and `population` is **residence-based**. They answer
  different questions and must not be added into a single "people present" figure.
  Neither is a visitor count, a footfall count, or a capture rate, and nothing in this
  artifact supports deriving one.
- **Cook County only.** Catchments that cross into DuPage, Lake, Will or Kane are
  truncated at the county line — those block groups are absent, not zero.
- **No XML is parsed in this pipeline** (sources are pipe-delimited text, gzipped CSV,
  and JSON). If XML ingestion is ever added here, it must reject documents containing
  `DOCTYPE` or `ENTITY` declarations before parsing.

### Reproducing

```bash
python3 scripts/site-activity/build_catchment_block_groups.py    # downloads (cached) + builds
python3 scripts/site-activity/verify_catchment_block_groups.py   # 9 checks against source-reported counts
```

Raw downloads land in the scratchpad, not the repo. `--offline` rebuilds from cached
raw; `--acs-year` / `--lodes-year` re-pin the vintages.

---

## Feed 4 — Active business licenses, categorized, citywide

One row per **active business license** with city-published coordinates, assigned to a
storefront category. Every row traces to a single `license_id` that can be re-fetched
from the verify-URL. No counts of people, visits, or activity of any kind are derived.

| Field | Value |
| --- | --- |
| **Artifact** | `data/curated/site-activity/active_licenses_compact.csv` |
| **Dataset id** | `uupf-x98q` — "Business Licenses - Current Active" |
| **Publisher** | City of Chicago, Dept. of Business Affairs & Consumer Protection (BACP) |
| **Access** | Public Socrata SODA endpoint, **no API key** |
| **Vintage** | **2026-08** (`rowsUpdatedAt` = 2026-08-02T09:58:58Z). Dataset first published 2011-12-15. |
| **Retrieved** | **2026-08-04** |
| **Ingestion scripts** | `scripts/site-activity/fetch_active_licenses.py` → `build_active_licenses.py` (python3, stdlib only) |
| **Verification script** | `scripts/site-activity/verify_active_licenses.py` (5 checks, all passing) |
| **Category rules** | `scripts/site-activity/license_categories.json` (**v1.1.0**) |
| **Rows** | **49,647** |
| **File size** | 2.83 MB (under the 10 MB budget, so the `name` column is **retained**) |
| **Sidecar manifest** | `data/curated/site-activity/active_licenses_compact.manifest.json` |
| **Artifact sha256** | `9d82ad83f76f6ec93589e414d9dbf28e86d9163c34f58de97311d18d95873933` |
| **Format** | JSON. **No XML is parsed in this feed**, so no DOCTYPE/ENTITY surface exists. |

> **Gotcha — the parent dataset id in the task does not exist.** The task named
> `r5sn-chpf` as the parent full dataset. That id returns **HTTP 404**. The actual
> parent is **`r5kz-chrr`** ("Business Licenses"). No impact on this artifact: the
> current-active dataset `uupf-x98q` was used as instructed and resolves normally.

### Verify URLs (public, no key, paste into a browser)

- **Dataset landing page**
  `https://data.cityofchicago.org/d/uupf-x98q`
- **The source's own row count** — returns `{"n":"54023"}`
  `https://data.cityofchicago.org/resource/uupf-x98q.json?$select=count(*)%20as%20n`
- **The source's own count of rows lacking coordinates** — returns `{"n":"4376"}`
  `https://data.cityofchicago.org/resource/uupf-x98q.json?$select=count(*)%20as%20n&$where=latitude%20IS%20NULL%20OR%20longitude%20IS%20NULL`
- **Any single row**, substituting its `license_id` for `3015736`
  `https://data.cityofchicago.org/resource/uupf-x98q.json?license_id=3015736`
- **Parent (full history) dataset**
  `https://data.cityofchicago.org/d/r5kz-chrr`

### Columns

| Column | Meaning |
| --- | --- |
| `license_id` | Source `license_id`. Unique in this artifact (**0 duplicates**). |
| `name` | `doing_business_as_name`, falling back to `legal_name`. |
| `category` | Assigned bucket — see rules below. |
| `lat`, `lng` | WGS84, **copied from the city's published coordinates**, 5 decimals (~1.1 m). |

### Row accounting (reconciles exactly)

| | Rows |
| --- | --- |
| Source `COUNT(*)` | **54,023** |
| Dropped — no latitude/longitude published | **4,376** |
| Dropped — outside Chicago bbox | 0 |
| Dropped — missing `license_id` | 0 |
| **Rows written** | **49,647** |

49,647 + 4,376 = **54,023 — exact match.** The 4,376 dropped rows are an **explicit
omission, not a zero**: BACP published no coordinates for them. They were not placed at
a centroid, a ZIP centre, or any imputed point.

### Category counts

| Category | Rows | Share |
| --- | ---: | ---: |
| other | 19,324 | 38.9 % |
| retail_general | 7,165 | 14.4 % |
| restaurant_cafe | 6,016 | 12.1 % |
| liquor_tavern | 5,851 | 11.8 % |
| grocery | 5,261 | 10.6 % |
| personal_services | 3,972 | 8.0 % |
| financial_services | 1,025 | 2.1 % |
| gym_fitness | 759 | 1.5 % |
| medical_health | 274 | 0.6 % |

### Categorization — why it is not a pure `license_description` mapping

The task specified bucketing on `license_description` string rules. **That is not
achievable on this data without asserting facts the records do not support**, for two
measured reasons:

1. **42.6 % of rows carry a sector-blind license type.** `Limited Business License`
   (16,360) and `Regulated Business License` (7,647) are *administrative* categories
   carrying zero sector signal. Sector lives only in `business_activity`.
2. **`Retail Food Establishment` (11,331) covers grocery *and* restaurants alike.**
   Measured split via `business_activity`: 3,896 `Retail Sales of Perishable Foods`
   vs 2,434 `Preparation of Food and Dining on Premises With Seating` vs 1,610 `Sale of
   Food Prepared Onsite With Dining Area`.

Bucketing on `license_description` alone would have left **six of the nine buckets
empty** and labelled every grocery, corner store and bakery in Chicago a restaurant.

So the mapping reads **two raw fields of the same public record** in three tiers.
Nothing is inferred from outside the record:

- **Tier 1** — exact `license_description` match, for license types that genuinely are
  sector-specific (the 8 liquor licenses; Pawnbroker). 5,963 rows.
- **Tier 2** — ordered split of `Retail Food Establishment`: seating/on-premises →
  `restaurant_cafe`; perishable retail → `grocery`; prepared-food-without-seating →
  `restaurant_cafe`; general-merchandise + non-perishable only → `retail_general`;
  otherwise `other`. 11,331 rows.
- **Tier 3** — exact `business_activity` token allowlists for everything else, with a
  documented precedence resolving multi-valued (`|`-separated) activities. 13,992 rows.
- **Unmatched → `other`, never guessed.** 22,737 rows.

**Exact matching, never substring.** Substring matching produced real false positives:

| Real source value | Naive substring hit | Wrong bucket it produced |
| --- | --- | --- |
| `Provide 4 or More Parking Spaces For a Fee…` | "spa" | personal_services |
| `Live Theatrical / Live Cultural Performances…` | "therap" | medical_health |
| `Employee of a Wrecking/Demolition/Fireworks Contractor (Cert. of Fitness)` | "fitness" | gym_fitness |

### Read this before using these numbers

**1. `grocery` means FRESH / perishable food retail.** v1.0.0 of the mapping put
`Retail Sales of General Merchandise and Non-Perishable Food` into `grocery`. That token
covers dollar stores, variety stores and corner stores carrying **no perishable goods**.
Including it inflated grocery by **1,355 geocoded rows (6,616 → 5,261, a 20.5 %
overstatement)** and would have overstated fresh-food access on exactly the South and
West Side blocks this platform serves. Corrected in **v1.1.0**; those rows are now
`retail_general`. A record carrying **both** perishable and non-perishable tokens is
`grocery` — perishable presence decides.

**2. These are LICENSES, not businesses or storefronts.** One site commonly holds
several licenses and appears several times, in several categories.

| | Count |
| --- | ---: |
| License rows in artifact | 49,647 |
| Distinct `account_number` + `site_number` pairs | **39,765** |
| Distinct coordinate points | **29,802** |

Worked example: **CITGO QUICK STOP, 2357 E 79th St** appears **three times** — as
`grocery`, `retail_general` and `other`. **Do not present row counts as business counts
or as "N businesses on this block."** Deduplicate on `account_number` + `site_number`.

**3. `medical_health` (274) is NOT a measure of health care access.** The City of
Chicago does not license clinicians — Illinois IDFPR does. This dataset contains **no**
physician, dentist, clinic, optometry or chiropractic tokens at all. What remains is
home health care, hospitals, long-term care and diagnostic imaging. This is a
**structural omission with a reason, not a zero**, and it must never be rendered as
"few health services here".

**4. `financial_services` drops 43.3 % of its rows for missing coordinates** (783 of
1,808) — by far the highest of any category, because debt collection and tax preparation
licensees are frequently registered at out-of-city or out-of-state head offices that
BACP did not geocode. The 1,025 mapped rows are **not** a complete count of financial
storefronts.

**5. `other` (38.9 %) is load-bearing and deliberate.** It holds automotive and fuel
(2,652 — this taxonomy has no automotive bucket), peddlers and street performers (no
fixed site), mobile food (the address is the commissary, **not** where the truck
operates), shared kitchens (excluded from `grocery` per spec), wholesale food,
special-event permits, and **3,152 rows whose `business_activity` is null** so no sector
can be read at all. Full reasoned list in `explicit_exclusions` in the rules JSON.

**6. Brand name does not determine category; the filed activity does.** The SUBWAY at
7901 S Yates Blvd is `grocery` because the city's own record files it under `Retail
Sales of Perishable Foods`. Overriding the record by brand name would be fabrication, so
it is left exactly as filed.

### Verification performed 2026-08-04 — 5/5 checks passed

Re-run with
`python3 scripts/site-activity/verify_active_licenses.py --artifact data/curated/site-activity/active_licenses_compact.csv`.
The verifier re-queries the **live** source and never reads the local raw pull, so a
stale or corrupted raw file cannot pass.

| # | Check | Result |
| --- | --- | --- |
| 1 | Artifact rows + documented drops vs live `COUNT(*)` | 49,647 + 4,376 = **54,023 = 54,023** |
| 2 | No-coordinate drop count vs the source's own `COUNT(*) WHERE lat/lng IS NULL` | 4,376 vs **4,376 — exact match** |
| 3 | **Independent server-side category check** — Socrata-side count of geocoded rows for the 8 tier-1 liquor license types | 5,851 vs artifact `liquor_tavern` **5,851 — exact match** |
| 4 | Duplicate `license_id` | 0 |
| 5 | Coordinates outside Chicago bbox (41.60–42.10, −87.95–−87.50) | 0 |

**Named spot-checks — three businesses re-fetched live by `license_id`**, each
exercising a *different* rule path, so a silent rule regression fails here:

| Business | Address | `license_id` | Filed `business_activity` | Category | Rule path |
| --- | --- | --- | --- | --- | --- |
| **HALE FAMILY MCDONALD'S** | 2425 E 79th St | 3034345 | Preparation of Food and Dining on Premises With Seating | `restaurant_cafe` | tier 2 step A |
| **AYA SUPERMARKET** | 4035 W Madison St | 3015736 | General Merchandise and Non-Perishable Food **\|** Perishable Foods | `grocery` | tier 2 step B — carries **both** tokens; perishable decides |
| **STARBUCKS COFFEE #27892** | 806 W 63rd St | 3012160 | Sale of Food Prepared Onsite With Dining Area | `restaurant_cafe` | tier 2 step A |

Name, address, coordinates and category matched the live source on all three.

**0.25-mile radius spot-checks.** Neither 2404 E 79th St nor 4048 W Madison St holds an
active license itself, so each anchor is the **city-assigned coordinate of the nearest
licensed address on the same block** (offsets ~15 m and ~25 m, far below the 402 m
radius). No address was sent to an external geocoder.

| Anchor | Within 0.25 mi | Category mix | Named businesses seen in the data |
| --- | ---: | --- | --- |
| **2404 E 79th St** (South Chicago) — anchored on 2409 E 79th St | **28** | other 9, retail_general 8, personal_services 5, grocery 4, restaurant_cafe 2 | HALE FAMILY MCDONALD'S, FAMILY DOLLAR STORE #6542, CITGO QUICK STOP, LEE'S CLEANERS, VALENTINE AFRICA HAIR BRAIDING |
| **4048 W Madison St** (West Garfield Park) — anchored on 4047 W Madison St | **118** | retail_general 47, other 25, grocery 21, restaurant_cafe 9, personal_services 8, liquor_tavern 6, financial_services 2 | F.R.S. 4047 FOOD MARKET, AYA SUPERMARKET, RAINBOW SHOP #326, DESIGN #1 NAILS, DREAM TOWN, FOOT LOCKER #25148 |
| **806 W 63rd St** (Englewood Square) — exact licensed address | **31** | restaurant_cafe 13, other 9, grocery 4, personal_services 2, medical_health 1, financial_services 1, retail_general 1 | STARBUCKS #27892, CHIPOTLE #2768, SIKIA RESTAURANT, Washburne Culinary Institute, Help At Home |

The 4× density difference between the Madison corridor (118) and the 79th St anchor (28)
is reported as observed. It reflects **licence density**, not foot traffic, and must not
be read as one.

### Known limitations

- **Active licenses only.** `uupf-x98q` is a snapshot of licenses currently active. It
  is not a history, carries no closures, and cannot support "businesses opened/closed"
  trend claims. Use the parent `r5kz-chrr` for history.
- **A license is not an open business.** It means a license is on file and active; it
  does not prove the door is open on any given day.
- **Categories describe the licensed activity, not the premises.** A home-based licensee
  is plotted at a residential address.
- **`other` at 38.9 % is a real limit on this taxonomy's resolution**, not noise to be
  hidden. Present it, do not suppress it.
- **No XML is parsed in this pipeline** (Socrata is queried with `.json`). If XML
  ingestion is ever added it must reject documents containing `DOCTYPE` or `ENTITY`
  declarations before parsing.

### Reproducing

```bash
cd scripts/site-activity
python3 fetch_active_licenses.py --out "$SCRATCH/site-activity/raw_active_licenses.json"
python3 build_active_licenses.py \
    --raw "$SCRATCH/site-activity/raw_active_licenses.json" \
    --rules license_categories.json \
    --out ../../data/curated/site-activity/active_licenses_compact.csv
python3 verify_active_licenses.py \
    --artifact ../../data/curated/site-activity/active_licenses_compact.csv
```

`fetch_active_licenses.py` exits non-zero if the download does not equal the source's own
`COUNT(*)`. `build_active_licenses.py` aborts if written + dropped does not reconcile to
the input, and exits 2 telling you to re-run with `--drop-name` if the artifact ever
exceeds 10 MB. Raw downloads land in the scratchpad, not the repo.
