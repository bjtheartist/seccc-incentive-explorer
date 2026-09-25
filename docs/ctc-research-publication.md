# CTC Small Business Research publication

Related scope: BJT-154. Published as a separate internal snapshot at `/research/ctc-small-business`, using the existing Analytics admin password/session. Public menus and the existing app remain unchanged.

## Release packaging

The reviewed HTML is staged at `data/private/ctc-research/corridor-map.html`, outside public/, and explicitly traced into this route only. It is intentionally Git-ignored to keep internal preparation materials out of the public repository. Keep the existing `.vercelignore`: it uploads this artifact to the authenticated Vercel project.

Source: workspace `output/ellen-corridor-brief-2026-09-24/presentation-map/corridor-map.html`. The sibling `explorer-publication.json` records the source hash and deployment ID. A future production release must include this route plus that staged HTML; deploying unchanged main would omit the feature. Do not merge/push the internal artifact into the public repository.

The route fails closed with 503 if the artifact or admin configuration is absent. It sends private/no-store and noindex headers. The existing login accepts this exact same-origin return path; existing redirect restrictions remain in place. No environment values, accounts, database rows, paid queries, or Google permissions change.

## Verification

15 focused tests pass for this route, admin authentication, and login redirects; targeted ESLint and production TypeScript/build pass. Browser checks cover all eight corridor totals (401 total), address search, and City-license popup details. The production signed-out route withholds the data. Full signed-in production viewing requires the existing dashboard password.

The research HTML remains the reviewed September 25, 2026 snapshot; it is not a new source refresh, approved corridor polygon analysis, or operating-storefront inventory.
