# Mobile Product Roadmap

This tracker breaks the mobile/platform work into small PRs so each slice can ship, be tested, and be reviewed without turning into one oversized redesign.

## Status Key

- `Planned`: scoped but not started
- `In progress`: active local branch or agent work
- `Ready for review`: implemented and verified locally
- `Shipped`: merged and deployed

## PR 1: Mobile Map Discovery

Status: `Ready for review`

Goal: Make the map easier to use from a phone after a QR-code scan or address search.

Acceptance criteria:

- Mobile map uses a bottom-sheet pattern instead of competing desktop side panels.
- Layer controls are collapsed into four presets: `Incentives`, `Vacancy`, `Zoning`, `Community Assets`.
- A searched location opens the Location Snapshot flow on mobile.
- `Generate Location Snapshot` is the dominant mobile action after search.
- Desktop map behavior remains familiar and usable.

Primary files:

- `components/map/MapView.tsx`
- `components/map/MapLegendPanel.tsx`
- `components/map/MapSnapshotPanel.tsx`
- `components/map/MapSearch.tsx`
- `components/map/map-helpers.ts`
- `components/map/MapMobileSheet.tsx`
- `components/map/map-layer-presets.ts`
- `docs/mobile-map-qa.md`

Verification:

- `npm run lint`
- `npm run test`
- `npm run build`
- Browser smoke test at mobile viewport for `/map`

Current notes:

- Local branch: `feature/mobile-map-discovery`
- Mobile viewport smoke test confirmed the new bottom-sheet controls render and the desktop legend toggle is hidden on mobile.
- Desktop `/map` smoke test confirmed the web legend now groups incentive zones by jurisdiction/source bucket.
- Full map tile verification still needs a valid `NEXT_PUBLIC_MAPBOX_TOKEN` in the local/prod environment.

## PR 2: Mobile Reports

Status: `Planned`

Goal: Make generated reports readable and actionable on mobile.

Acceptance criteria:

- Report sections render as scannable mobile cards.
- Sticky mobile action bar includes `Save`, `Email`, `Download`, and `Refine`.
- QR-code entry flow feels direct and does not force unnecessary wizard steps.
- Existing desktop report layout remains intact.

Primary files:

- `app/report/page.tsx`
- `components/report/ReportActionBar.tsx`
- `lib/url-state.ts`

## PR 3: Vacancy Cards

Status: `Planned`

Goal: Turn vacancy spreadsheets into a mobile-first property explorer before CSV export.

Acceptance criteria:

- Vacancy report shows filterable property cards before CSV export.
- Filters include text search, property type, owner type, and zone count.
- CSV export remains available.
- Each property card can open a location snapshot or incentive analysis.

Primary files:

- `app/report/page.tsx`
- `components/report/VacancyPropertyExplorer.tsx`
- `components/map/MapPolygonPanel.tsx`
- `lib/vacancy-report.ts`

## PR 4: Saved Searches

Status: `Planned`

Goal: Let signed-in users watch useful places over time.

Acceptance criteria:

- Users can save a watched neighborhood.
- Users can save a watched address.
- Users can save a watched vacancy/property search.
- Watchlists are user-owned and never expose another user's records.

Primary files:

- `scripts/migrate-watchlists.ts`
- `app/api/watchlists/route.ts`
- `app/api/watchlists/[id]/route.ts`
- `lib/workspace.ts`
- `app/workspace/page.tsx`

## PR 5: Performance + Mobile QA

Status: `Planned`

Goal: Make the mobile experience fast and verify the main flows.

Acceptance criteria:

- Vacancy queries stay bounds-based on the map.
- Heavy layers load only when needed.
- Report lookups are cached where safe.
- Vacancy API has indexes for common filters.
- Mobile QA covers iPhone Safari, Android Chrome, and QR-code entry.

Primary files:

- `app/api/vacant/route.ts`
- `scripts/migrate-vacant.ts`
- `lib/fetch-cache.ts`
- `components/map/MapView.tsx`
- `tests` or documented Playwright smoke scripts
