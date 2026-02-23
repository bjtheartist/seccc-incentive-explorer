# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SECCC Incentive Explorer — an interactive tool for Chicago businesses to discover economic incentive programs. Combines geographic zone analysis (11 incentive layers), a pre-qualification survey, business/address search, location recommendations, and an interactive map with search.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
```

## Architecture

**Framework:** Next.js 16 (App Router, React Server Components) with TypeScript strict mode.

**Path alias:** `@/*` maps to project root.

**Database:** Neon (serverless Postgres with PostGIS). Connection via `@neondatabase/serverless` driver. Falls back to static files when `DATABASE_URL` is not set.

### Key Data Flow

1. **Data pipeline (offline):**
   - `scripts/convert-kml.mjs` — city KML zone files → clipped/simplified GeoJSON in `public/data/zones/` (SSA #50 only)
   - `scripts/convert-kml-citywide.mjs` — city KML → unclipped GeoJSON in `public/data/zones-citywide/` (full Chicago)
   - `scripts/convert-businesses.mjs` — Google My Business CSV → `public/data/businesses.json` with pre-computed zone memberships
   - `scripts/seed-db.ts` — seeds Neon database from static files (businesses, programs, zones, stats, community assets)

2. **Runtime lookup (DB-first with static fallback):**
   - `lib/db.ts` — Neon serverless client (`sql` tagged template)
   - `lib/data.ts` — Data access layer abstraction (DB-first, static fallback)
   - `lib/zone-check.ts` — PostGIS zone check via `/api/zones/check`, falls back to Turf.js `booleanPointInPolygon`

3. **Geocoding:** `/api/geocode` uses OpenStreetMap Nominatim. `/api/zoning` queries Chicago zoning with triple fallback (ArcGIS → Socrata SODA → GeoJSON endpoint) and exponential backoff retry.

4. **Survey engine:** `lib/survey-engine.ts` scores 4-step questionnaire answers against a rules matrix, producing program matches with confidence levels (high/medium/low).

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

### Pages

- `/` — Landing with address/business search, hero, video demo, coverage stats
- `/programs` — Filterable directory of 20+ incentive programs (by government level and industry)
- `/qualify` — 4-step pre-qualification survey → program matches
- `/locate` — Sector-based location finder with zoning compatibility and area recommendations
- `/map` — Interactive map with zone layers, search bar, census stats
- `/faq` — Collapsible FAQ (14 items)

### Core Libraries

- **Database:** `@neondatabase/serverless` for Neon Postgres + PostGIS
- **Geospatial:** `@turf/turf` for client-side point-in-polygon fallback, polygon intersection, simplification
- **UI:** Shadcn (Radix primitives) with "new-york" style, Framer Motion for animations
- **Map:** Mapbox GL with 11 zone layers (GeoJSON or vector tiles), search bar overlay
- **Search:** Fuse.js for fuzzy business name matching
- **PDF:** jsPDF for report generation (`lib/pdf-report.ts`)

### Database Schema (Neon + PostGIS)

- `businesses` — 360+ businesses with `geography(POINT)`, full-text search vector, zone_data JSONB
- `programs` — 20+ incentive programs
- `zones` — zone features with `geography(GEOMETRY)` + GiST index (one row per feature)
- `census_tracts` — Census ACS data with tract geometry (median income, home value, population, walk score)
- `community_assets` — EDOs, BSOs, universities, libraries with point geometry
- `stats` — single-row JSONB for aggregate stats

### Data Files (public/data/)

- `businesses.json` — businesses with coordinates, categories, and zone membership flags
- `programs.json` — 20+ incentive program definitions with benefits, application steps, required docs
- `stats.json` — Aggregate coverage statistics
- `zones/*.geojson` — 11 GeoJSON files clipped to SSA #50 (TIF, Federal OZ, Illinois OZ, Enterprise, EDGE, REV, MICRO, Data Center, SSA, Triple Benefit, High Unemployment) + SBIF projects

### Map Rendering

Zone layers support two rendering paths:
1. **GeoJSON source** (default) — loads clipped zone files from `public/data/zones/`
2. **Vector tile source** — when `ZONE_TILESET_IDS` in `lib/constants.ts` are populated with Mapbox tileset IDs, uses Mapbox vector tiles for city-wide rendering

### Fallback Strategy

All database-dependent features gracefully fall back to static files:
- `lib/zone-check.ts`: PostGIS → Turf.js
- `lib/data.ts`: API routes → static JSON fetches
- `components/map/IncentiveGlance.tsx`: `/api/stats` → `/data/stats.json`
- `components/lookup/AddressSearch.tsx`: `/api/businesses` → `/data/businesses.json`

## Design System

- **Theme:** "Warm Bureau" — off-white (#FAF9F6) background, navy (#0C1B33) foreground, blue (#2563EB) accent
- **Fonts:** Playfair Display (editorial/display via `.font-editorial`), JetBrains Mono (monospace via `.font-mono-bureau`), Inter (body/sans)
- **Custom CSS classes:** `.bureau-grid`, `.bureau-noise` (texture overlays), `.accent-bar`, `.accent-bar-light`, `.bureau-pulse`
- **Zone colors** defined in `lib/constants.ts`

## Industry Data

`lib/industries-data.ts` defines 20 sectors (EV/Clean Energy, Manufacturing, Retail, Tech, Healthcare, etc.) each with emoji icons, descriptions, top program mappings, and keywords. Used by the survey, programs filter, and locate pages.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox GL access token |
| `DATABASE_URL` | No | Neon Postgres connection string. If empty, app uses static files only. |
