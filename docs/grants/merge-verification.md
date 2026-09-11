# Grants workspace and source inventory merge — September 11, 2026

The internal workspace and `feat/grants-matchmaking-db` are merged on `codex/grants-workspace`. The source commit is `b01c9cf`; the source worktree's uncommitted federal-relevance correction was also preserved in this checkout. The original worktree was not edited. Related Linear architecture context is BJT-80; this integration does not complete that broader epic.

The combined local app is `http://localhost:3107/admin/grants`. Data lives on the isolated Neon branch `br-old-salad-aekuxp9b` (`grants-workspace-20260911`). The original import test branch remains available. Production and public catalog dates were not changed.

## Imported inventory

| Source                         |    Records |
| ------------------------------ | ---------: |
| Curated source records         |         80 |
| Grants.gov                     |      1,244 |
| IRS foundation filings         |     24,530 |
| SAM assistance listings        |      2,675 |
| Illinois program catalog       |      1,608 |
| Illinois funding opportunities |        126 |
| **Total**                      | **30,263** |

The loader re-read the target table: **30,263 rows**, 1,208 source-labeled open rows, 18,323 source-complete records. These are inventory counts, not confirmed eligible grants. The input contains zero duplicate IDs. Input SHA-256: `b0c11b5fd003f5956a9cc1002361b4ea26e60f751fbacb3206e9fb5e81d4a9c7`.

Reproducible profiling: `merge-data-quality.ipynb`, run from the repository root with the gitignored input at `output/grants-db/grants-active.jsonl`.

## Acceptance criteria checked

- Server-authorized staff listing, detail, profile-based research leads and review creation; viewer reads remain read-only.
- Search and filters run on the server; 25 records per page, separate full-detail request, no 30,000-row browser download.
- Saved questionnaire answers select relevant funding forms, applicant categories, landlord roles, operating stage and project terms. Results are research leads with review questions; maintained matches plus displayed source leads are capped at five.
- Source rows and full evidence remain available. Starting staff review creates an unverified round and preserves existing program edits. Explicit known identities link SBIF and other existing pilot programs across official URL aliases.
- Source payload changes invalidate linked-round verification and downstream saved matches through existing triggers. Identical reimports do not invalidate reviews.
- No inferred deadline timezone or month-name application window is promoted to a verified date.

## Quality findings and treatment

| Finding                                               | Evidence / impact                                                                                                                          | Treatment                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| High: source completeness differs from current intake | 17,637 source-complete records are foundations; all 24,530 foundations lack an exact deadline                                              | Foundation and standing-program records are application-window unconfirmed, even when import completeness says ready                    |
| High: date-only deadlines                             | 1,523 dated records have no deadline time                                                                                                  | Display the source date with a time-review label; newly created rounds have no invented deadline instant                                |
| Medium: geography and cost categories are broad       | Some geographic relevance derives from historical recipients or text mentions; building improvements do not prove every repair is eligible | Label potential Chicago relevance and research leads; confirm exact geography, costs and applicant eligibility before recommendation    |
| Medium: heterogeneous URLs and funding forms          | Some imported application strings contain multiple URLs; cooperative agreements and award drawings are distinct instruments                | Validate links before rendering; unsupported funding forms require manual classification rather than being silently converted to grants |

## Commands and maintenance

1. `npx tsx scripts/grants/migrate.ts` — additive transaction creates the source inventory, staff tables and source-change links. Verified on the isolated branch; repeated DDL is exercised in embedded Postgres tests.
2. `node scripts/grants/load-catalog.mjs output/grants-db/grants-active.jsonl` — upserts the source snapshot using the local configured test database. It never truncates the table or overwrites staff program/round notes.
3. `npx vitest run lib/grants app/api/admin/grants app/api/cron/grant-scan/route.test.ts` — 48 tests passed, including real Postgres constraints, pagination, source classification, idempotence, invalidation and authorization.
4. `npx tsx scripts/grants/browser-smoke.ts` — Chrome workflow passed, including all five questionnaire fields, shared persistence, changing answers changing results, 30,263-record catalog search/pagination, SBIF review linking, landlord filtering and mobile overflow checks.

TypeScript and targeted ESLint passed. The production build passes with the existing Mapbox named-export and workspace-root warnings. Screenshots are in `output/grants/funding-database-desktop.png` and `output/grants/funding-database-mobile.png`.

Bulk acquisition remains operator-run and uses the source snapshot's acquisition date; do not present a script rerun as fresh source verification. The original raw acquisitions are not committed. Use `GRANTS_RAW_DIR` when unifying externally retained acquisition files. Reimports preserve historical rows; source retirement and retention policies remain future operating work. The smaller staff-maintained catalog will need its own pagination if it grows substantially.

No hosted environment secrets were uploaded, no production release or recurring bulk job was activated, and no messages were sent. Hosted credential configuration remains blocked by the earlier automatic approval review pending the user's explicit authorization.
