# Chicago zoning source ledger

This directory holds deterministic, reviewable snapshots from two official City sources:

- `zoning-legislation.json`: Chicago City Clerk eLMS zoning reclassification and Zoning Code matters from December 1, 2010 forward.
- `zoning-map-snapshot.json`: current City ArcGIS zoning records keyed by the source `GLOBALID`, with separate fingerprints for published attributes and geometry.
- `zoning-map-latest-delta.json`: the most recent detected difference between two reviewed map snapshots.

Run `npm run data:sync:zoning` to refresh all three. An unchanged upstream source produces byte-identical output because the artifacts use source publication timestamps rather than a local wall-clock timestamp.

## Source boundary

eLMS records City Council legislation. It does not publish current zoning geometry and must not be used to infer a parcel boundary from a title or attachment. The ArcGIS layer publishes the current mapped zoning district. A matter is joined to a mapped polygon only when the City itself publishes an exact Clerk document number or eLMS matter URL on that polygon.

Special-use decisions are handled by the Chicago Zoning Board of Appeals and are not included in this ledger. Neither source determines whether a user's plain-language activity is permitted.
