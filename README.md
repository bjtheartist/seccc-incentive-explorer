# SECCC Incentive Explorer

Interactive Chicago business incentive discovery tool for Southeast Chicago. The app helps a business owner, developer, or community partner enter an address, inspect overlapping incentive zones, understand likely program eligibility, and generate a practical report.

Live site: [chicagoincentiveexplorer.com](https://chicagoincentiveexplorer.com)

## What It Does

- Checks an address against Chicago incentive zones such as TIF, Opportunity Zones, Enterprise Zones, SSA, CCSA corridors, NMTC, QCT, historic districts, industrial corridors, and related layers.
- Generates location-based incentive reports with confidence labels, program explanations, benefit estimates, action steps, parcel context, census context, zoning, and stacking analysis.
- Provides an interactive Mapbox map for exploring zones, vacant properties, parcel/zoning context, community assets, and neighborhood snapshots.
- Includes a pre-qualification survey that scores business profile answers against incentive program rules.
- Offers a program directory filtered by government level and industry.
- Supports lead capture and optional email delivery for PDF reports.

## Current Data Snapshot

- 24 incentive programs
- 360 business records
- 69 business categories
- Primary ZIP coverage: 60617, 60619, 60649
- Static GeoJSON/JSON fallback data under `public/data/`

## Main User Flows

- `/` - Landing page with address/business lookup and quick links.
- `/report` - Report wizard and instant report generation from `lat`, `lon`, and `addr` URL params.
- `/map` - Interactive incentive map with zone layers, vacant properties, parcels, zoning, presets, and map snapshots.
- `/programs` - Incentive program directory with level and industry filters.
- `/qualify` - Four-step pre-qualification survey.
- `/locate` - Location finder for sector/zoning fit and area recommendations.
- `/check` - Address eligibility check flow.
- `/faq` - Public FAQ.

## Architecture

- Framework: Next.js 16 App Router, React 19, TypeScript strict mode.
- Styling/UI: Tailwind CSS 4, shadcn/Radix primitives, Framer Motion, lucide-react.
- Mapping/geospatial: Mapbox GL, Mapbox Draw, Turf.js, optional PostGIS via Neon.
- Data access: DB-first where configured, static-file fallback when `DATABASE_URL` is absent.
- Caching: optional Upstash Redis plus in-memory GeoJSON caching and HTTP cache headers.
- Reports: jsPDF generation with optional Resend email delivery.
- Validation/tests: Zod schemas, Vitest unit tests, Playwright E2E tests.

## Data And Runtime Model

The app is designed to keep working without production services:

- If `DATABASE_URL` is configured, API routes can query Neon/PostGIS for businesses, programs, zones, census data, parcels, stats, assets, stacking rules, and vacant properties.
- If the DB is unavailable or not configured, user-facing flows fall back to static JSON/GeoJSON in `public/data/`.
- `/api/zones/check` returns zone membership from PostGIS when available; client-side Turf.js handles static fallback checks.
- Map zone layers load through `/api/zones/geojson/[key]` first and fall back to `public/data/zones/*.geojson`.

## Key Commands

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

Offline data refresh scripts:

```bash
npm run data:acs2024 # fetch 2024 ACS 5-year Cook County tract data and static fallback
```

Database maintenance scripts currently cover vacant-property data:

```bash
npm run db:migrate   # vacant_properties migration
npm run db:seed      # vacant property sync
npm run db:reset     # migration + sync
```

These DB scripts require `DATABASE_URL`.

## Environment Variables

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=...
DATABASE_URL=...
SOCRATA_APP_TOKEN=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
RESEND_API_KEY=...
```

Only `NEXT_PUBLIC_MAPBOX_TOKEN` is required for the interactive map to render. The rest are optional service integrations; the app should degrade gracefully when they are absent.

## Important Files

- `app/page.tsx` - landing page and primary lookup entry.
- `app/report/page.tsx` - report wizard and instant report flow.
- `components/map/MapView.tsx` - main interactive map implementation.
- `lib/zone-check.ts` - DB-first and Turf fallback zone checking.
- `lib/zone-response.ts` - normalized zone API response handling.
- `lib/confidence-engine.ts` - program eligibility confidence scoring.
- `lib/report-engine.ts` - report data generation and narrative assembly.
- `lib/pdf-report.ts` - PDF report rendering.
- `lib/industries-data.ts` - industry-to-program mapping.
- `public/data/` - static fallback data.

## Testing Notes

- `npm run test` runs Vitest unit tests only.
- Playwright E2E specs live in `tests/e2e/` and can be run with:

```bash
npx playwright test
```

For browser verification of `/map`, make sure `NEXT_PUBLIC_MAPBOX_TOKEN` is set before starting the dev server.
