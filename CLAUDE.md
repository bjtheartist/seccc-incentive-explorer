# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SECCC Incentive Explorer — an interactive tool for Chicago businesses to discover economic incentive programs. Combines geographic zone analysis, a pre-qualification survey, business/address search, location recommendations, report generation, and an interactive map with search.

**Live site:** chicagoincentiveexplorer.com

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest unit tests
npm run db:migrate   # Run vacant_properties + workspace/auth migrations
npm run db:migrate:workspace # Run Google auth + saved reports/workspace migration
npm run db:seed      # Sync vacant property data
npm run db:reset     # Run migrations + vacant sync
```

The current package scripts cover vacant-property maintenance plus the business workspace/auth tables. A full seed script for every app table is not present in this tree.

### Testing

- **Unit tests:** Vitest — `npm run test` (tests in `lib/__tests__/`)
- **E2E tests:** Playwright — `npx playwright test` (tests in `tests/e2e/`)
- **Single test:** `npx vitest run lib/__tests__/confidence-engine.test.ts` or `npx playwright test tests/e2e/vacant-properties.spec.ts`
- Playwright config: `playwright.config.ts` (baseURL: localhost:3000, 60s timeout, 1 retry)

## Architecture

**Framework:** Next.js 16 (App Router, React Server Components) with TypeScript strict mode.

**Path alias:** `@/*` maps to project root.

**Database:** Neon (serverless Postgres with PostGIS). Connection via `@neondatabase/serverless` driver. Falls back to static files when `DATABASE_URL` is not set.

**Caching:** Optional Upstash Redis layer (`lib/redis.ts`) for server-side response caching. In-memory GeoJSON caching in `zone-check.ts`. HTTP cache headers (7-day max-age) for GeoJSON files via `next.config.ts`. Coordinate rounding for cache key bucketing.

### Key Data Flow

1. **Data pipeline (offline):**
   - `scripts/convert-kml.mjs` — city KML zone files → clipped/simplified GeoJSON in `public/data/zones/` (SSA #50 only)
   - `scripts/convert-businesses.mjs` — Google My Business CSV → `public/data/businesses.json` with pre-computed zone memberships
   - `scripts/seed-census.ts` — fetches 2024 ACS 5-year Cook County tract data, writes `public/data/census-tracts-2024.geojson`, and optionally upserts `census_tracts`
   - `scripts/migrate-vacant.ts` — idempotently creates the `vacant_properties` table and indexes
   - `scripts/migrate-workspace.ts` — creates Auth.js, saved report, and business project workspace tables
   - `scripts/sync-vacant-properties.ts` — syncs Chicago vacant land/building data and writes static fallback data
   - `scripts/seed-epa-walkability.ts` — updates existing census rows with walkability data after census data has been seeded
   - `scripts/sync-brownfields.mjs` — fetches EPA FRS ACRES brownfield sites for Chicago → `public/data/zones/brownfield-sites.geojson` (`npm run data:brownfields`)
   - `scripts/sync-nof.mjs` — fetches official NOF eligible/priority corridor polygons from the city's ArcGIS eligibility map → `public/data/zones/nof-corridors.geojson`, and replaces `nof` rows in the zones table unless `--no-db` (`npm run data:nof`)

2. **Runtime lookup (DB-first with static fallback):**
   - `lib/db.ts` — Neon serverless client (`sql` tagged template), lazy-initialized
   - `lib/data.ts` — Data access layer abstraction (DB-first, static fallback)
   - `lib/zone-check.ts` — PostGIS zone check via `/api/zones/check`, falls back to Turf.js `booleanPointInPolygon`

3. **Geocoding:** `/api/geocode` uses OpenStreetMap Nominatim. `/api/zoning` queries Chicago zoning with triple fallback (ArcGIS → Socrata SODA → GeoJSON endpoint) and exponential backoff retry.

4. **Survey engine:** `lib/survey-engine.ts` scores 4-step questionnaire answers against a rules matrix, producing program matches with confidence levels (high/medium/low). `lib/confidence-engine.ts` (492 LOC) handles the detailed eligibility scoring.

5. **Report generation:** `lib/report-engine.ts` (1862 LOC) orchestrates report data, `lib/pdf-report.ts` (872 LOC) renders jsPDF output with maps and stacking analysis.

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/businesses?search=&lat=&lon=&radius=` | GET | Business list/search/proximity query |
| `/api/zones/check?lat=&lon=` | GET | Zone membership via PostGIS |
| `/api/zones/geojson/[key]` | GET | Zone GeoJSON by layer key |
| `/api/census?lat=&lon=` | GET | Census tract data (ACS) |
| `/api/assets?type=edo,bso` | GET | Community assets (EDOs, BSOs) |
| `/api/stats` | GET | Aggregate stats |
| `/api/geocode?address=` | GET | Nominatim geocoding proxy |
| `/api/zoning?lat=&lon=` | GET | Chicago zoning classification |
| `/api/vacant?bounds=&type=&ownerType=&limit=` | GET | Vacant properties by viewport bounds, filterable by owner type |
| `/api/projects` | GET/POST | Signed-in user's business projects and goal checklists |
| `/api/projects/[id]` | GET/PATCH | Signed-in user's project detail and checklist updates |
| `/api/saved-reports` | GET/POST | Signed-in user's saved report snapshots |
| `/api/saved-reports/[id]` | GET | Signed-in user's saved report snapshot |
| `/api/email-report` | POST | Email PDF report as attachment (requires `RESEND_API_KEY`) |

### Pages

- `/` — Landing with address/business search, hero, video demo, coverage stats
- `/programs` — Filterable directory of 24 incentive programs (by government level and industry)
- `/qualify` — 4-step pre-qualification survey → program matches
- `/locate` — Sector-based location finder with zoning compatibility and area recommendations
- `/map` — Interactive map with zone layers, search bar, census stats
- `/check` — Address eligibility check flow
- `/report` — Report generation page
- `/workspace` — Signed-in workspace for saved projects and reports
- `/login` — Google sign-in page for workspace features
- `/faq` — Collapsible FAQ (14 items)

### Core Libraries

- **Database:** `@neondatabase/serverless` for Neon Postgres + PostGIS
- **Geospatial:** `@turf/turf` for client-side point-in-polygon fallback, polygon intersection, simplification
- **UI:** Shadcn (Radix primitives) with "new-york" style, Framer Motion for animations, Tailwind CSS 4
- **Map:** Mapbox GL with 14 configured zone layers (GeoJSON or vector tiles), search bar overlay
- **Search:** Fuse.js for fuzzy business name matching
- **PDF:** jsPDF for report generation (`lib/pdf-report.ts`)
- **Email:** Resend SDK for transactional report emails with PDF attachments
- **Auth:** NextAuth/Auth.js with Google OAuth and Neon-backed sessions
- **Validation:** Zod 4 for runtime schema validation (`lib/schemas.ts`)
- **Caching:** Upstash Redis (optional, graceful degradation)

### Database Schema (Neon + PostGIS)

- `businesses` — 360+ businesses with `geography(POINT)`, full-text search vector, zone_data JSONB
- `programs` — 24 incentive programs
- `zones` — zone features with `geography(GEOMETRY)` + GiST index (one row per feature)
- `census_tracts` — Census ACS data with tract geometry (median income, home value, population, walk score)
- `community_assets` — EDOs, BSOs, universities, libraries with point geometry
- `stats` — single-row JSONB for aggregate stats
- `vacant_properties` — 18K+ city-owned vacant land with `geography(POINT)`, zone cross-references in JSONB, incentive_count, owner_name, owner_type (city_public/out_of_state/corporate_llc/local_private)
- `users`, `accounts`, `sessions`, `verification_token` — Auth.js tables for Google login
- `business_projects` — user-owned goal workspaces with checklist JSON
- `saved_reports` — user-owned report snapshots with wizard state and generated report JSON

### Data Files (public/data/)

- `businesses.json` — businesses with coordinates, categories, and zone membership flags
- `programs.json` — 24 incentive program definitions with benefits, application steps, required docs
- `census-tracts-2024.geojson` — 2024 ACS 5-year Cook County tract fallback joined to Census TIGERweb geometries
- `stats.json` — Aggregate coverage statistics
- `vacant-properties.json` — 18K+ city-owned vacant land parcels
- `stacking-rules.json` — Incentive program stacking/combinability rules
- `zones/*.geojson` — GeoJSON zone layer files for TIF, Opportunity Zones, Enterprise Zones, state incentive zones, SSA, CCSA corridors, high unemployment, NMTC, QCT, historic districts, industrial corridors, NOF projects, EPA ACRES brownfield sites, and related layers

### Fallback Strategy

All database-dependent features gracefully fall back to static files. Neon client and Redis are lazy-initialized — only created when env vars are present and first query is made. This prevents build-time errors with missing configuration.

- `lib/zone-check.ts`: PostGIS → Turf.js
- `lib/data.ts`: API routes → static JSON fetches
- `components/map/IncentiveGlance.tsx`: `/api/stats` → `/data/stats.json`
- `components/lookup/AddressSearch.tsx`: `/api/businesses` → `/data/businesses.json`

### Map Rendering

Zone layers support two rendering paths:
1. **GeoJSON source** (default) — loads clipped zone files from `public/data/zones/`
2. **Vector tile source** — when `ZONE_TILESET_IDS` in `lib/constants.ts` are populated with Mapbox tileset IDs, uses Mapbox vector tiles for city-wide rendering

## Design System

- **Theme:** "Warm Bureau" — off-white (#FAF9F6) background, navy (#0C1B33) foreground, blue (#2563EB) accent
- **Fonts:** Playfair Display (editorial/display via `.font-editorial`), JetBrains Mono (monospace via `.font-mono-bureau`), Inter (body/sans)
- **Custom CSS classes:** `.bureau-grid`, `.bureau-noise` (texture overlays), `.accent-bar`, `.accent-bar-light`, `.bureau-pulse`
- **Zone colors** defined in `lib/constants.ts` (14 configured layers, each with unique hex color)

## Industry Data

`lib/industries-data.ts` defines 20 sectors (EV/Clean Energy, Manufacturing, Retail, Tech, Healthcare, etc.) each with emoji icons, descriptions, top program mappings, and keywords. Used by the survey, programs filter, and locate pages.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox GL access token |
| `DATABASE_URL` | No | Neon Postgres connection string. If empty, app uses static files only. |
| `AUTH_SECRET` | For login | NextAuth/Auth.js secret for signed sessions. |
| `NEXTAUTH_URL` | For login | Canonical app URL for OAuth callbacks. |
| `GOOGLE_CLIENT_ID` | For Google login | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | For Google login | Google OAuth client secret. |
| `SOCRATA_APP_TOKEN` | No | Socrata API app token for 10x rate limits. Free at data.cityofchicago.org. |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL for server-side response caching. |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token. If absent, caching is skipped gracefully. |
| `RESEND_API_KEY` | No | Resend API key for sending report emails (starts with `re_`). If absent, email feature returns 503. |
