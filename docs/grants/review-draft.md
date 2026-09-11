## What this changes

Adds a staff-gated grants workspace at `/admin/grants` using existing Explorer accounts. Staff can search a paginated funding inventory, verify application rounds, complete a four-step business questionnaire, and review up to five explained matches. Business structure is separate from NAICS business activity and derived industry sector; operators can own or lease their premises.

## Why and Linear issue

Billy requested shared, maintainable grant research and a curated matchmaker within Explorer. No dedicated implementation issue was found; related architecture context is [BJT-80](https://linear.app/bjtheartist/issue/BJT-80/data-model-expansion-property-and-corridor-intelligence-platform). This does not complete BJT-80.

## Acceptance criteria checked

- [x] Owner/editor/viewer access, same-origin mutations, shared persistence, version checks, and audit history.
- [x] Business name, legal structure, validated six-digit NAICS type, derived sector code/industry, goal, and date; unconfirmed classifications remain explicit.
- [x] Role and premises are separate; legacy tenant and free-text records remain readable.
- [x] Time-bound, recurring, and hybrid programs with separate rounds, evidence, and review dates.
- [x] Indexed inventory search and pagination; source leads stay distinct from verified opportunities.
- [x] Bounded, explained questionnaire shortlist; source changes invalidate reviewed matches.
- [x] Public-source watchlist scanner and manual review queue, without automated outreach.

## Validation and how to test

54 targeted Vitest tests, TypeScript, targeted ESLint, and production build pass. The existing Mapbox named-export warning remains. `scripts/grants/browser-smoke.ts` runs against an isolated local database and exercises the staff gate, CRUD, shared sessions, CSRF, NAICS picker/derived sector, persisted answers, operator-plus-lease path, changed shortlist, 30,263-record pagination, source promotion, mobile overflow, and browser errors. `lib/grants/*.test.ts` and API route tests cover database constraints, source changes, matching, permissions, and fetch boundaries.

Sign in with a staff account, open `/admin/grants`, complete the questionnaire, select a NAICS code, and verify that industry fills automatically. Change the role or space arrangement and compare relevant leads. Search the funding database and start a review; imported records must remain unverified until staff adds evidence.

Preview/release route: https://chicagoincentiveexplorer.com/admin/grants (production activation is tracked in the release documentation).

## Migration, configuration, and risk

Additive, idempotent schema migration; source inventory imports preserve existing data and staff edits. Initial 30,263-row load and explicitly selected working records are transferred separately from source code. Existing production database/auth/cron credentials are reused. Owner access is attached to an existing immutable account ID; `GRANTS_SCAN_ENABLED` enables the bounded scheduled scanner. No test credentials are uploaded. Source snapshots and past versions persist; large watchlists will need additional scheduling capacity and retention policy. Foundation filings and standing listings do not establish an open grant round.

## Intentionally not done

Public publication of internal opportunities, outbound communication, applications, medical/client document storage, award-probability scores, or automated scanning of every bulk-source record. The scanner watches the configured source list.

## Agent involvement and follow-up

Codex implemented and verified this change; no subagents were used. No follow-up issues were created. Follow-up scope is bulk-source refresh scheduling and retention/pagination as maintained records grow.

## Checklist

- [x] User-visible claims exercised through real page/API/browser entry points named above.
- [x] No source-text assertions substituted for runtime tests.
- [x] Production callers exist; migration/import/transfer and test scripts are explicit operator tools.
- [x] Migrations, environment variables, data changes, and verification documented.

Release install repair: CI on Node 22/npm 10 found 15 missing optional Puppeteer proxy-dependency lock entries also absent from the starting main lockfile. Regenerated the lock using npm 10.9.4; no existing dependency versions or package declarations changed. `npm@10.9.4 ci --dry-run --ignore-scripts --no-audit --no-fund` passes.
