# SECCC Incentive Explorer

Interactive Chicago business incentive discovery tool for Southeast Chicago. The app helps a business owner, developer, or community partner enter an address, inspect overlapping incentive zones, understand likely program eligibility, and generate a practical report.

Live site: [chicagoincentiveexplorer.com](https://chicagoincentiveexplorer.com)

## What It Does

- Checks an address against Chicago incentive zones such as TIF, Opportunity Zones, Enterprise Zones, SSA, CCSA corridors, NMTC, QCT, historic districts, industrial corridors, and related layers.
- Generates location-based incentive reports with confidence labels, published program benefit ranges, action steps, parcel context, census context, zoning, and stacking analysis. Reports do not total possible incentive dollars or predict award amounts.
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

Database maintenance scripts currently cover vacant-property and workspace data:

```bash
npm run db:migrate   # vacant_properties + workspace/auth migrations
npm run db:seed      # vacant property sync
npm run db:migrate:workspace # Google auth + saved reports/workspace tables
npm run db:reset     # migration + sync
```

These DB scripts require `DATABASE_URL`.

## Environment Variables

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=...
DATABASE_URL=...
AUTH_SECRET=...
NEXTAUTH_URL=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SOCRATA_APP_TOKEN=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
RESEND_API_KEY=...
PASSWORD_RESET_EMAILS_ENABLED=true
AUTH_EMAIL_FROM="Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>"
REPORT_EMAILS_ENABLED=true
REPORT_EMAIL_FROM="Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>"
INCENTIVE_HELP_INBOX=...
```

Only `NEXT_PUBLIC_MAPBOX_TOKEN` is required for the interactive map to render. `DATABASE_URL`, `AUTH_SECRET`, and `NEXTAUTH_URL` are required for account login, saved reports, and workspace features. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` enable Google login; the option is hidden when either value is absent. Email/password signup also requires the workspace migration so the `users.password_hash` column exists. Password recovery is fail-closed and requires `DATABASE_URL`, `RESEND_API_KEY`, and `PASSWORD_RESET_EMAILS_ENABLED=true`. Report delivery is fail-closed and requires `DATABASE_URL`, `RESEND_API_KEY`, and `REPORT_EMAILS_ENABLED=true`; `INCENTIVE_HELP_INBOX` receives staff notifications only when a report recipient explicitly requests Chamber support. The rest are optional service integrations; the app should degrade gracefully when they are absent.

## Important Files

- `app/page.tsx` - landing page and primary lookup entry.
- `app/report/page.tsx` - report wizard and instant report flow.
- `app/workspace/page.tsx` - saved project/report workspace for signed-in users.
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
