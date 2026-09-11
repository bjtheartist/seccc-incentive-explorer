# Grants production release — September 11, 2026

Live route: https://chicagoincentiveexplorer.com/admin/grants

Initial promoted deployment: `dpl_73oMmDW7sjJU7jfbBx19nz1NVH8c`, application code through `d8e6b41`. PR: https://github.com/bjtheartist/seccc-incentive-explorer/pull/298. Subsequent main deployments should retain this feature after the PR merges.

## Data and account

The existing production Neon branch `br-rapid-credit-aekjpelt` was migrated additively. Read-back confirmed 30,263 funding source records, 11 maintained programs, three application rounds, three working applicant profiles, and 15 monitored sources. Source records include foundation filings and standing program listings; this is not a count of active or eligible grants.

Billy Ndizeye confirmed `billy@southeastchgochamber.org` as the owner account. Owner access is stored in `grants_members` against the existing immutable user ID. Teammates can be added as editors or viewers through the workspace. Chrome was signed into a different account, which correctly received the staff gate; the owner must sign in with the confirmed Chamber account.

Existing production database, authentication, and cron credentials were reused. The only added production setting is `GRANTS_SCAN_ENABLED=true`. No local or isolated-test credentials were uploaded.

## Verification

- Production home page returns 200.
- Anonymous grants page renders the sign-in gate with noindex and without pilot data.
- Anonymous catalog and export requests return 403.
- Unauthenticated cron requests return 401.
- Local isolated-database browser smoke covers owner actions, shared persistence, questionnaire, NAICS selection and derived industry, operator plus leased premises, role-sensitive matching, inventory pagination, source promotion, and mobile layout.
- Targeted grants tests (54), typecheck, lint, and build pass. See `verification.md` for repository CI and the route-registration repair.

## Scanner and remaining verification

The daily production schedule is 12:00 UTC. A run processes at most six due sources, so a newly loaded watchlist may take multiple daily runs. Discoveries and changed source text enter staff review; they do not become verified grant recommendations automatically.

An authenticated owner browser session and one successful production scanner batch still need live verification. The configured cron secret is sensitive and cannot be read back; a manual request without its value returned 401 as expected. Use the existing Vercel cron Run action or the owner workspace scan control, rather than changing shared credentials. Do not trigger unrelated email jobs.

No outreach, grant applications, or automatic client sharing were sent.
