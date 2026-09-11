# Add an internal grants curation and matchmaking workspace

Draft review text only; no PR has been opened.

## What this changes

Staff can search a paginated 30,263-record funding inventory, start a source-backed review, and maintain grant programs and separate application rounds, keep dated source evidence, capture a business through a four-step questionnaire and review up to five explained funding matches at `/admin/grants`. Saved questionnaire answers also select a bounded set of imported source leads. Foundation and standing-program records stay distinct from current opportunities. Public funder pages feed a deduplicated review queue; closed or stale rounds cannot silently remain current, and changes to underlying records return affected matches for review. Existing Explorer account sign-in is reused with a separate owner/editor/viewer permission check.

## Why

The Chamber's grant research currently spans documents and individual conversations. Billy requested an internal, shared database that the team can keep current, with recurring versus time-bound opportunities, proactive discovery, and curated business matching.

## Linear issue

No existing implementation issue was found. Related data-platform context: [BJT-80](https://linear.app/bjtheartist/issue/BJT-80/data-model-expansion-property-and-corridor-intelligence-platform). Acceptance criteria are documented in `docs/grants/workspace.md` and checked there; this change does not complete BJT-80.

## Validation

See `docs/grants/verification.md`. Production build, TypeScript, targeted lint, 48 tests and the real browser workflow pass. Browser smoke exercises the user-visible claims through the page and API. Postgres tests exercise persistence, constraints, history, competing edits and source processing. Auth route tests exercise anonymous, ordinary user, viewer and editor access boundaries. Fetch tests exercise DNS pinning, private-address rejection, oversize/aborted bodies and deadline handling.

## Migration, configuration and risks

The additive grants/source-inventory schemas, idempotent starter import and bulk source load are separate commands. Source completeness is not staff verification; imported-source changes withdraw linked-round verification. The import preserves existing staff records and does not truncate the inventory. The migration has been tested on an isolated Neon branch, not production. Required owner/cron configuration and a release sequence are documented. Hosted preview credential upload was rejected by automatic approval review and remains blocked pending user approval. Current source coverage is limited to readable public HTML/text; two tested sources need manual review. The pilot loads the catalog together; server pagination and retention policies should precede large ingestion volumes.

## How to test

Run the grants migration/seed against an isolated database with the existing auth tables, configure `GRANTS_OWNER_USER_ID`, and start the app. Confirm the gate with a signed-out browser, then sign in as the selected owner. Add a program and round, refresh in a second session, compare evidence, complete the questionnaire and verify all five required core fields. Change landlord to operator and confirm that an operator-only/landlord-only round changes the shortlist. Inspect the edit history. Run a source scan and review new links. Grant an existing test account viewer access and confirm mutation routes deny writes. Avoid production credentials in local smoke tests.

## Intentionally not included

Public opportunity publication, automatic outreach or applications, medical/client document storage, award-probability scores, broad web crawling, and a production release.

## Agent involvement and follow-up

Codex implemented and verified this change; no subagents were used. No follow-up issues or outbound communications were created. Follow-up scope: hosted preview approval and review, reconciliation with currently deployed unmerged work, production activation, and pagination/retention as the catalog grows.

## Checklist

- [x] User-visible behavior exercised through real page/route entry points.
- [x] No tests assert on source text as a substitute for runtime behavior.
- [x] New modules have production callers, except the explicit migration/seed/test tooling.
- [x] Migrations, environment variables, data changes and verification are documented.
