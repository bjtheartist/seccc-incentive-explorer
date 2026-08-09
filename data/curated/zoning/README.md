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

The City datasets are official. Explorer point matches, labels, and summaries are informational and are not City zoning determinations. A past ZBA judgment does not establish current authorization, permitted use, or compliance; users must consult the cited City record and verify conditions, amendments, expiration or revocation, and current effect with the Chicago ZBA or Department of Planning and Development. No returned record does not prove that no ZBA action exists.
