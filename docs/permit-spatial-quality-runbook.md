# Permit spatial quality runbook

This runbook controls two separate operations:

1. backfill coordinates for `building_permits` rows whose `geom` is null;
2. replace only the legacy `spatial_proximity` rows in
   `vacant_property_permit_matches`.

Neither command writes by default. Both require an explicit `--write` flag.

## Data grain and acceptance rules

- Permit grain: one row per `building_permits.permit_id`.
- Match grain: one row per vacant-property/permit pair.
- Native City address reuse is accepted only for an exact normalized address
  whose published source points all fall within one 25 m cluster.
- Native City PIN reuse is secondary and uses the same 25 m cluster gate.
- The external fallback is the official [U.S. Census batch
  geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html).
  Only
  `Match` + `Exact` results inside Chicago bounds are applied. Non-exact,
  out-of-bounds, missing-response, and no-match rows remain visible in the
  result ledger and are never silently converted into coordinates.
- Census coordinates are MAF/TIGER address-range interpolations, not rooftop or
  parcel-boundary measurements.
- The public Nominatim service is not used for this bulk operation; its
  [official usage policy](https://operations.osmfoundation.org/policies/nominatim/)
  discourages larger and periodic bulk geocoding.

## Required production order

Do not reorder these steps.

1. Create a fresh Neon safety branch from the current production branch.
2. Run the additive condition migration so the staging and audit tables exist:

   ```bash
   DATABASE_URL="..." npm run db:migrate:condition
   ```

3. Deploy the matching code revision. Its permit upsert preserves an audited
   backfilled point while the City still publishes no coordinates, clears that
   point if the permit address changes, and replaces it when a native City
   coordinate appears.
4. Run the read-only geocode plan:

   ```bash
   DATABASE_URL="..." npm run data:backfill:permit-geocodes
   ```

5. Measure the Census result without writing:

   ```bash
   DATABASE_URL="..." npm run data:backfill:permit-geocodes -- --fetch-census
   ```

6. If the baseline and provider totals reconcile, apply the backfill:

   ```bash
   DATABASE_URL="..." npm run data:backfill:permit-geocodes -- --write
   ```

7. Recalculate the match cleanup from the new geometry snapshot:

   ```bash
   DATABASE_URL="..." npm run data:repair:permit-matches
   ```

8. If the proposed total is credible, atomically publish the replacement weak
   tier:

   ```bash
   DATABASE_URL="..." npm run data:repair:permit-matches -- --write
   ```

9. Require the strict audit to pass:

   ```bash
   DATABASE_URL="..." npm run data:audit:permit-spatial -- --strict
   ```

## Reconciliation gates

The geocode operation must prove:

- result-ledger rows equal the frozen missing-geometry baseline;
- accepted rows equal applied rows;
- provider-error rows are zero;
- no permit changed address, gained geometry, or disappeared during the run;
- every applied row carries `geocode_source`, `geocode_match_type`,
  `geocoded_at`, and `geocode_run_id`.

The match repair must prove:

- staged rows equal proposed rows;
- staged rows equal distinct staged permit ids;
- no staged permit has a PIN/address match;
- inserted rows equal proposed rows;
- the post-publish audit reports zero multi-parcel proximity permits and zero
  stronger-match shadowing.

Any failed gate stops the operation. The live proximity replacement is one SQL
statement with a rollback guard; it cannot publish a partial tier.

## Rehearsal evidence — 2026-08-25

Disposable Neon branch: `br-quiet-king-aee1gsev`

- Baseline: 480,134 permits; 8,452 missing geometry (1.76%).
- Unique missing addresses: 2,264.
- Accepted by native City exact-address cluster: 7,081.
- Accepted by native City exact-PIN cluster: 51.
- Census input: 797 unique addresses covering the remaining 1,320 permits.
- Census accepted: 997; review required: 134; unmatched: 189;
  provider errors: 0.
- Applied atomically: 8,129; remaining unknown: 323 (0.07%).
- Legacy proximity rows: 53,976.
- Safe replacement rows: 34,414, each attached to exactly one parcel.
- Post-publish multi-parcel proximity permits: 0.
- Post-publish stronger-match shadowing: 0.
- Strict audit: PASS.

These are rehearsal numbers, not permanent expectations. A production run must
recalculate and reconcile its own frozen snapshot.

## Recovery

- Preserve the fresh pre-operation Neon safety branch until production smoke
  checks and the next daily permit sync both pass.
- A geocode run is reversible by `geocode_run_id`; clearing only rows still
  carrying that run id restores those permits to unknown geometry without
  touching later native City coordinates. Rebuild the proximity tier afterward.
- Recover the pre-repair match table from the safety branch or Neon's retained
  point-in-time history. Do not reconstruct legacy proximity rows by guesswork.
