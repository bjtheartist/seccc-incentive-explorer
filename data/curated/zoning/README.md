# Chicago zoning source ledger

This directory holds deterministic, reviewable snapshots from three official City sources:

- `zoning-legislation.json`: Chicago City Clerk eLMS zoning reclassification and Zoning Code matters from December 1, 2010 forward.
- `zoning-map-snapshot.json`: current City ArcGIS zoning records keyed by the source `GLOBALID`, with separate fingerprints for published attributes and geometry.
- `zoning-map-latest-delta.json`: the most recent detected difference between two reviewed map snapshots.
- `zoning-zba-snapshot.json`: City Zoning Board of Appeals case records keyed by `GLOBALID`, with the raw published judgment and separate attribute and geometry fingerprints.
- `zoning-zba-latest-delta.json`: the most recent detected difference between two reviewed ZBA snapshots.

Run `npm run data:sync:zoning` to refresh all three. An unchanged upstream source produces byte-identical output because the artifacts use source publication timestamps rather than a local wall-clock timestamp.

## Source boundary

eLMS records City Council legislation. It does not publish current zoning geometry and must not be used to infer a parcel boundary from a title or attachment. The ArcGIS layer publishes the current mapped zoning district. A matter is joined to a mapped polygon only when the City itself publishes an exact Clerk document number or eLMS matter URL on that polygon.

Special-use, variation, and administrative-appeal records come from the separate official Chicago Zoning Board of Appeals ArcGIS layer. The City layer does not publish a refresh timestamp, so the snapshot stores `sourceUpdatedThrough: null` and never substitutes retrieval time for source freshness. Published judgment text is preserved as-is.

## Which layer answers a point lookup, and what it says about freshness

`/api/zoning` queries ArcGIS **layer 1 (`Zoning Boundaries`)**. Layer 0 is the `Map Layers` **group layer** and cannot be queried: it answers with ArcGIS error 400 `Invalid or missing input parameters` inside an HTTP 200 body. The service is published in Illinois State Plane East feet (`wkid` 3435), so a lat/lon point query must pass `inSR=4326` — without it the service returns an empty feature array rather than an error, which would read as "no zoning here" for a parcel that is in fact zoned.

The Data Portal mirror (`dj47-wfun`) is the fallback, queried with `intersects(the_geom, 'POINT(lon lat)')`.

The two mirrors report freshness at **different scopes and do not agree**, so the API reports both verbatim and never reduces them to one "last updated":

| Mirror | Field | Scope | What it does not cover |
| --- | --- | --- | --- |
| ArcGIS layer 1 | `UPDATE_TIMESTAMP` | the returned polygon | the dataset — the service publishes no `editingInfo`, so it has no dataset-wide vintage |
| Data Portal `dj47-wfun` | `rowsUpdatedAt` | the whole table | any individual polygon |

The Data Portal additionally publishes a curated statement, carried through verbatim as `statedTimePeriod` (currently `Current as of June 2026`).

Planned Developments have **three disagreeing predicates** in the published data, so any PD determination must use their **union**. Live counts: `pd_num > 0` = 1,456; `zone_class LIKE 'PD%'` = 1,457; `zone_type = 5` = 1,459; **union = 1,461**. `PD 1376` is classed PD while carrying `zone_type` 1. The API therefore publishes `zoneClass`, `zoneTypeCode`, and `pdNumber` as separate raw fields and derives no PD flag of its own.

`ZONE_TYPE` is published as a bare numeric code with no value-domain label, so `zoneType` is `null` rather than a locally invented category name. `C1-1.5` and `DX-10` are valid published classifications and must never be treated as malformed.

The City datasets are official. Explorer point matches, labels, and summaries are informational and are not City zoning determinations. A past ZBA judgment does not establish current authorization, permitted use, or compliance; users must consult the cited City record and verify conditions, amendments, expiration or revocation, and current effect with the Chicago ZBA or Department of Planning and Development. No returned record does not prove that no ZBA action exists.
