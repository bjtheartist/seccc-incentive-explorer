# Production synthetic check

Black-box check that production is actually serving. Script:
`scripts/prod-synthetic-check.ts`; workflow: `.github/workflows/prod-synthetic-check.yml`.

**What it checks** (each must return HTTP 200 within 15s): `/`, `/report`, `/map`,
`/api/programs` (body must be a non-empty array), `/api/geocode?address=…` (body must
carry a finite `lat`/`lon`), and `/admin/zoning-changes` (200 only — it may render a
gate). Then ONE real report generation: `POST /api/report/generate` with a minimal
site-incentives wizard state for 8801 S Commercial Ave, 60617, exactly as
`generateReportRemote` in `app/report/page.tsx` sends it. It allows 60s (cold start) and
asserts a report object with at least one section or program match — never specific
programs. Read-only: no email is sent, no lead is written.

**Cadence:** every 90 minutes, plus `workflow_dispatch`. On failure it opens (or comments
on) one `prod-degraded` issue assigned to `bjtheartist` with the results table and closes
it on recovery. GitHub issues are the only notification channel.

**Locally:** `npm run ops:synthetic-check` (add `-- --base-url https://…` for another
target). **Alert path:** run the workflow manually with `force_fail: true`, or locally
`npm run ops:synthetic-check -- --force-fail` — it adds an always-failing check and exits 1.
