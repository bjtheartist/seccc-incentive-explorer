# Ranked vacancy citation release

Owner request: incorporate the 25 recently imported building-vacancy citations into Site Matchmaker's ranked results, retaining the five-year source window.

## Coverage and resulting behavior

The ranked product currently covers nine pilot ZIPs. Official Chicago ZIP polygons place nine of the 25 imported records inside that coverage: 60617 (one), 60619 (one), 60623 (one), 60636 (one), and 60649 (five). The remaining 16 stay in the citywide vacancy database/API and the reviewed source bundle, but do not become ranked candidates in unsupported ZIPs.

Eight new candidates are added. The citation for 5725 S LAFLIN ST attaches to an existing candidate with a uniquely matching normalized address within 15 metres. All 31,296 existing candidates retain their canonical identities, coordinates, PINs, measurements, and ownership fields. Only that existing candidate gains citation evidence. The result has 31,304 candidates.

Building violations have their own `building_violation` evidence type and raw count. They are not classified as 311 reports. Cards and CSV exports preserve the City citation date, OPEN status, exact source-row link, and scope comments. A partial-building citation remains explicitly partial; no current occupancy, available space, ownership, or PIN is inferred.

The ranking formula, default top-20 display, gates, and ZIP coverage are unchanged. A citation makes a record available to the existing screening and ranking process; it does not guarantee a place in every search's top 20. Size filters still exclude candidates without the requested published measurement.

## Artifact method

`data/exports/shortlist-universe/building-violations.json` contains all 25 reviewed signals, their official ZIP assignments, public source provenance, and individual zoning lookup sources. New candidate zoning was resolved through the existing zoning API; existing candidates retain their prior zoning. Overlay lookup failures retain the existing unknown-state behavior.

`scripts/incorporate-vacancy-citations.ts` applies this reviewed bundle to the committed snapshot. It validates the baseline checksums and build IDs, adds evidence using the existing 15-metre/address convention for PIN-less records, recalculates counts, and validates every ZIP before writing any artifacts. Identical citations are idempotent; changed citations require source reconciliation rather than silent replacement.

The universe schema advances to version 3. All nine files and the manifest receive a new derived build ID. The original vacancy-index snapshot identity and source dates are preserved, and the citation bundle receives its own checksum and review date. This is an additive release, not a refresh of unrelated vacancy sources.

The parcel-identity sidecars are rebound only after checking that every referenced candidate retains its address, PIN, and coordinates. Existing County facts and their check dates are unchanged. New candidates have no precomputed parcel identity and use the existing on-demand lookup when requested.

The full ranked exporter also handles violation records explicitly, with source dates, provenance, OPEN status, and the five-year window. The separate legacy vacancy-index exporter excludes them because that older report does not yet model citation provenance. No database schema changes or production writes are part of this release.

## Reproduce and verify

```sh
node --import tsx scripts/incorporate-vacancy-citations.ts
npx vitest run lib/__tests__/shortlist-violation-evidence.test.ts lib/__tests__/shortlist-universe.test.ts lib/__tests__/shortlist-engine.test.ts lib/__tests__/shortlist-csv.test.ts components/vacancy/__tests__/SiteShortlistResults.test.tsx
npx tsc --noEmit
```

Source ingestion remains an operator-reviewed process. Before a later release, reconcile imported records against current City status and the retention cutoff; this script does not automatically remove records that resolve or age out.

Verification for this release: 301 focused tests passed, covering aggregation, evidence provenance, ranking, CSV, cards, source exclusions, fail-closed loading, and parcel identity. All nine files passed the actual production loaders, with existing parcel identities still available. A complete before/after comparison confirmed that all original rows remained and exactly one gained citation evidence.

Production smoke case: existing building, retail/service, CTA rail, ZIP 60623. The added 1948 S ST LOUIS AVE candidate ranks tenth in the reviewed data and carries its October 22, 2021 citation. Deployment and browser verification are recorded below when complete.
