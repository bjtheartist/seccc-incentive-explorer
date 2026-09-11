# Internal Grants Matchmaker

This adds `/admin/grants` to Chicago Incentive Explorer. Staff maintain program records, application rounds, source monitoring, applicant/project profiles and reviewed matches in the shared Postgres database. The existing public program directory and historical investment data are unchanged.

## Acceptance criteria and boundaries

- [x] Server-authorized staff access using existing Explorer accounts; owner, editor and viewer permissions.
- [x] Separate evergreen programs from dated rounds. Timing categories: one-time, recurring/rolling, recurring with windows, unknown.
- [x] Distinguish cash grants, reimbursements, tax benefits, loans and in-kind support.
- [x] Search/filter opportunities; maintain owners, tags, evidence, verification dates and next-review dates.
- [x] Merge the imported 30,263-record inventory; browse with server pagination and match saved questionnaire answers to a bounded set of source leads.
- [x] Idempotent source-to-review handoff; preserve staff edits and invalidate linked reviews when imported source payloads change.
- [x] Four-step questionnaire, following Site Matchmaker: save a shared business profile and produce a narrow, explained shortlist.
- [x] Require business name, business type, industry, primary goal and intake date in the questionnaire; capture an optional target funding date.
- [x] Persist business and project facts, unknowns, match rationale, questions and next action.
- [x] Monitor configured public source pages, retain text snapshots, deduplicate discoveries and queue changes for review.
- [x] Recheck matches when program, applicant or round data changes. Stale or closed rounds never appear as current verified opportunities.
- [x] Audit edits, detect simultaneous-edit conflicts, export the catalog and recent activity, manage teammate access.
- [x] Daily cron route and configuration; manual scan for due sources. Activation is an explicit environment setting.
- [ ] Hosted preview / production activation: blocked by automatic approval review of uploading the isolated database and authentication credentials to Vercel. No credentials were uploaded and no hosted deployment was created.

Based on Billy's September 11 request and the local September 10 `grants-matchmaker-concept.md`. Linear project: Chicago Incentive Explorer. Related architecture context: [BJT-80](https://linear.app/bjtheartist/issue/BJT-80/data-model-expansion-property-and-corridor-intelligence-platform). No existing Linear grant-workspace implementation issue was found; this is a new scope, not completion of BJT-80.

## Operating the workspace

1. Use **Funding database** to search the imported inventory by source, record type and timing. It displays 25 records per page. **Start staff review** preserves the source and creates an unverified round, using the existing program when its identity is known. Maintain programs and assign a responsible team member. Archive obsolete records rather than rewriting prior-year rounds.
2. Add current application rounds with source evidence, dates, amount, eligibility/cost criteria and a next review date. Blank criteria remain unknown. “Any” must be supported by the source.
3. Add sources. A program source checks for changed text; a directory source also extracts funding/application links. Staff review all findings. Creating a program from a lead does not mark any round verified.
4. Use **Find funding matches** or **Start questionnaire**. Capture the five required core fields, then role/entity/stage, location and confirmed zones, expenses, funding preferences, reimbursement readiness, budget and target date. Use Unknown for facts requiring confirmation. Existing incomplete profiles can be completed with Update answers; preserve the original intake date. Use the facts-source field for confirmation and missing information; do not store bank statements, SSNs or client medical information here.
5. Review up to five results, one per program, ranked by verified availability, recorded alignment and deadline. Verified current windows appear first; unverified leads have a separate research section, and upcoming rounds have a separate watchlist. Closed rounds, hard role/entity/stage/cost mismatches and unwanted funding types are omitted. Reimbursements are omitted when upfront funds are unavailable. Missing zone or free-text industry/type alignment remains a question rather than a definitive rejection. Programs without a round or enough cost criteria remain research work. Budget, payment timing and other narrative requirements are manual checks. See `grant-data-requirements.md` for the intake standard. Document additional requirements and record a next action. Approval is internal; no email, application submission or automatic client sharing occurs.
6. Review Sources for failed checks, Overview for stale evidence and unassigned records, and Team & history for accountability. Source edits make that source due for another check.

## Database and deployment

The isolated checkout is on `codex/grants-workspace`, based on `origin/main` at `d964651`. The test database is Neon project `winter-hill-01244713`, branch `br-old-salad-aekuxp9b` (`grants-workspace-20260911`). Production schema/data are untouched. Do not use the test branch as a long-term production database.

The additive, transactional migration is `lib/grants/schema.sql`, invoked with `npm run db:migrate:grants`. It requires the existing `users` table. Run `npm run grants:seed` to insert starter research leads without overwriting staff edits. Starter records do not assert open application rounds. Pilot applicant profiles are private test-database records and are not committed as fixtures.

Required configuration:

| Variable                          | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Existing Explorer database connection; use an isolated branch for preview/testing      |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Existing account-session signing, as in Explorer's auth configuration                  |
| `GRANTS_OWNER_USER_ID`            | Immutable existing account ID used to bootstrap owner access; never an email allowlist |
| `CRON_SECRET`                     | Authorizes the scanner endpoint; missing secrets always deny requests                  |
| `GRANTS_SCAN_ENABLED=true`        | Enables the scheduled scanner after launch; otherwise cron is inert                    |

`GET /api/cron/grant-scan` is configured for 12:00 UTC daily, alongside existing jobs. [Vercel cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs) runs on production deployments; preview environments support manual checks. The UI explicitly displays whether scheduled scanning is active. Confirm the deployed plan's current cron limits before activation.

Launch sequence: approve the blocked preview credential configuration; create and inspect the staff-gated preview; reconcile the release branch with any other currently deployed, unmerged Explorer work; apply the additive migration to the intended production database; configure the verified owner account and cron settings; deploy; verify anonymous/viewer/editor/owner paths and one source batch. Do not merge or replace other in-flight releases incidentally.

## Verification and limits

`npm run build` passed, with the pre-existing Mapbox named-export warning in `app/map/page.tsx` and local checkout-root warning. Targeted ESLint, TypeScript, Vitest and browser smoke commands are listed in `verification.md`.

Source scans are public HTML/text checks, not web-wide search or browser automation. Each run claims at most six due sources; each source has a 20-second total fetch budget, at most two redirects, a 1.5 MB response limit, a 100,000-character stored text limit and at most 80 candidate links. HTTP blocks, PDFs, JavaScript-only pages and oversize responses require manual review. No access protections are bypassed. Sources check weekly by default, configurable from one to 90 days. A failed source retries on the next day. Larger watchlists need a higher cron cadence or a durable queue.

The 30,263 imported source records are queried on the server with indexed search and pages of 25. Questionnaire queries select up to five additional source leads; the UI fills only the remaining slots after maintained matches, keeping the combined list to five. The smaller staff-maintained program/round/profile/match catalog is still loaded together for the pilot. The review queue shows the latest 250 pending findings; activity shows the latest 100 database entries (40 rendered). Add server pagination before substantially increasing the catalog. No probability-of-award scoring, funder eligibility certification, document storage, CRM synchronization or automatic outbound communication is included.

Prior data versions and source snapshots are preserved without an automatic retention deletion. Define the team's retention policy before large-scale ingestion. Exports contain the catalog and recent internal records and are restricted to staff. They are not a full database backup or a complete snapshot/audit-history export.

## Merged source inventory

See `merge-verification.md` for source counts, merge lineage, import commands and data-quality findings. The imported source snapshot remains distinct from staff-verified application rounds. Foundation filing text and standing program listings do not establish current intake. The configured source scanner still monitors its explicit watchlist; bulk-source acquisition scripts are operator-run snapshots, not a newly activated 30,000-source daily job.

## Business classification and premises

Business structure is a separate legal-structure selection. Business type uses the Census 2022 six-digit NAICS catalog (1,012 types), with the broader industry sector code/title derived automatically on both client and server. `data/naics-2022.json` records the official download URL, retrieval date, and source checksum. Unconfirmed codes remain null and produce review gaps; legacy business-type and industry descriptions are retained as reference, never silently classified.

The applicant role asks whether the applicant is the business operator or landlord. Space arrangement separately records owns, leases, seeking a location, or not applicable. Older tenant profiles normalize to operator plus leases. Staff round rules can record validated NAICS prefixes/sector ranges, structures, and space arrangements; older free-text criteria remain visible for review. Source-inventory text supplies research leads, not code-based eligibility findings.
