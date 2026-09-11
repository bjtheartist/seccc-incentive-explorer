# Verification — September 11, 2026

## Passed

- `npm run build`: completed the production build. Existing Mapbox named-export warning and local workspace-root warning remain.
- Targeted ESLint on the new grants modules/routes/components/scripts and the workspace entry link: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npx vitest run lib/grants app/api/admin/grants app/api/cron/grant-scan/route.test.ts`: **48 tests passed**.
- `npx tsx scripts/grants/browser-smoke.ts`: passed in Chrome against the local server and isolated Neon branch. Covers the signed-out gate, protected export, staff UI, real program/round creation, timezone input, second-session persistence, cross-origin rejection, the four-step questionnaire, required intake fields, saved answers despite a subsequent refresh failure, changing the applicant role changing the shortlist, archival, pilot profile, sources, team view, mobile overflow and browser errors. Synthetic records are archived after the test.
- `npm run db:migrate:grants`: additive migration applied repeatedly to the isolated Neon branch. The embedded Postgres tests also apply it twice to verify repeatability.
- `npm run grants:seed`: inserted 11 program research leads and 15 sources without marking an application round open or overwriting staff edits.
- Real source scanning: 13 readable sources, 13 saved snapshots, 10 discovered funding links. Community Trust returned HTTP 403; Workforce Solutions exceeded the 1.5 MB scan limit. Both remain visibly flagged for manual review.
- Merged funding database: 30,263 records re-read after import; browser pagination/search, source-detail view, idempotent SBIF review linking and landlord-only source leads passed. PostgreSQL tests cover field completeness versus timing and imported-source changes invalidating linked reviews.
- Private pilot data: Ken, Martez and Gus/WGN Flag; two City rounds recorded as `in_review`, with current source evidence and unresolved manual/rules checks.

Browser screenshots include `output/grants/questionnaire-desktop.png`, `output/grants/questionnaire-mobile.png`, `output/grants/shortlist-desktop.png`, and the overview/opportunities captures (local, uncommitted artifacts).

## Hosted status

No hosted deployment was created. Automatic approval review rejected the command that would upload branch-specific test database/session credentials to Vercel. Production environment settings and production database contents were not modified. The new cron route is configured in code but scheduled scanning is inactive until an authorized production deployment and `GRANTS_SCAN_ENABLED=true`.

The local preview is `http://localhost:3107/admin/grants`. The verified Billy Ndizeye Chamber account is the configured owner in the local environment; other existing Explorer accounts can be granted editor/viewer access after owner review in the Team view. No email or client message is sent by the grants workspace.

## Review scope

New code lives under `lib/grants`, `components/grants`, `app/admin/grants`, `app/api/admin/grants`, `app/api/cron/grant-scan`, and `scripts/grants`. Existing changes are limited to a staff-only workspace entry link, package scripts/dependencies, and one cron definition. The lockfile adds the parser and embedded Postgres test dependency plus their transitive requirements; no existing package versions changed.

The source monitor deliberately fails closed for private network destinations, non-HTTPS sources, oversized responses and interrupted/time-limited requests. Staff authentication is separate from public report/shortlist access. There are no automatic client messages, funding applications, public opportunity publication, or eligibility certifications.

Merge details and the reproducible data-quality notebook: `merge-verification.md` and `merge-data-quality.ipynb`.
