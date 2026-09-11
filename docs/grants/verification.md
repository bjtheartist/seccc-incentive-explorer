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

Production is live at https://chicagoincentiveexplorer.com/admin/grants. The existing production database/auth/cron configuration was reused; no isolated test credentials were uploaded. The additive schema, 30,263 source records, 11 programs, three rounds, three working profiles, 15 sources, and owner membership were read back in production. Anonymous page/API access checks pass. See `production-release.md` for deployment IDs, account access, and the successful production scanner batch. Only the live authenticated owner-session check remains.

The local preview remains `http://localhost:3107/admin/grants`, connected to its isolated test database. Earlier preview-secret approval rejection did not result in an upload and does not describe the later authorized production release.

## Review scope

New code lives under `lib/grants`, `components/grants`, `app/admin/grants`, `app/api/admin/grants`, `app/api/cron/grant-scan`, and `scripts/grants`. Existing changes are limited to a staff-only workspace entry link, package scripts/dependencies, and one cron definition. The lockfile adds the parser and embedded Postgres test dependency plus their transitive requirements; no existing package versions changed.

The source monitor deliberately fails closed for private network destinations, non-HTTPS sources, oversized responses and interrupted/time-limited requests. Staff authentication is separate from public report/shortlist access. There are no automatic client messages, funding applications, public opportunity publication, or eligibility certifications.

Merge details and the reproducible data-quality notebook: `merge-verification.md` and `merge-data-quality.ipynb`.

## NAICS and role update — September 11, 2026

- 54 targeted tests pass, including complete NAICS sector derivation, invalid/old-edition code rejection, canonical server labels, legacy preservation, prefix/range matching, and operator/tenant overlap.
- TypeScript, targeted ESLint, and the production build pass (existing Mapbox warning remains).
- Local browser flow verifies searchable NAICS selection, derived industry, shared persisted fields, the separate structure/space controls, and questionnaire-driven matching.
- The pre-release production deployment `dpl_9skjKuC932AVkbozRshqVUqxiWnK` was from main commit `448a6fe070287fc7d753b0a14549775a1692c4c7`, an ancestor of this branch. Existing production database/auth/cron configuration can be reused; no test credentials are being uploaded.

Release install repair: CI on Node 22/npm 10 found 15 missing optional Puppeteer proxy-dependency lock entries also absent from the starting main lockfile. Regenerated the lock using npm 10.9.4; no existing dependency versions or package declarations changed. `npm@10.9.4 ci --dry-run --ignore-scripts --no-audit --no-fund` passes.

## Repository CI

After the lock repair, CI run 34615483445 passed end-to-end tests, browser smoke, lint, and manifest verification. Unit tests reported 6,402 passing and two skipped; one route-registration test identified the four new grants routes. Registered those routes and their reviewed-copy contract in the existing public-claim registry. The complete registry test file then passed locally (54 tests), and targeted registry lint passed. The corrected commit `b98ad4e` passed the complete CI rerun 34616905466: lint, manifest verification, unit tests, typecheck, production build, Chromium end-to-end tests, and WebKit/Firefox browser smoke. Final release-note changes are documentation only; `git diff --check` passes.
