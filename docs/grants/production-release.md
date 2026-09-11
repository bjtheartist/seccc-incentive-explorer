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
- Targeted grants tests (54), typecheck, lint, and build pass. Full repository CI run 34616905466 passed all jobs on application commit `b98ad4e`, including Chromium e2e and WebKit/Firefox smoke. The final follow-up updates release documentation only.

## Scanner and remaining verification

The daily production schedule is 12:00 UTC, within Vercel Hobby’s one-hour execution window. A run processes at most six due sources, so a newly loaded watchlist may take multiple daily runs. Discoveries and changed source text enter staff review; they do not become verified grant recommendations automatically.

The production scanner was triggered through Vercel’s existing cron Run action. The request returned HTTP 200 at 15:35:55 UTC; production read-back confirmed five source snapshots and 15 findings. Chicago Community Trust returned HTTP 403 and remains flagged for manual review. The shared cron secret was not read or changed, and unrelated jobs were not triggered.

The remaining live check is an authenticated owner browser session. Chrome did not have the Chamber account signed in; the Explorer email sign-in page is prepared for the owner to complete. Existing owner/editor/viewer behavior was verified in the isolated local database/browser flow.

No outreach, grant applications, or automatic client sharing were sent.
