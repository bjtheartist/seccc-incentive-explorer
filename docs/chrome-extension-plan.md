# Chrome Extension Build Plan

## Goal

Create a lightweight Chrome extension that turns any address a user sees in their workflow into a Chicago Incentive Explorer location snapshot.

## V1 Scope

- Selected text context-menu action.
- Popup address input.
- Open the main Explorer site at `/lookup?addr=...`.
- Let the main site geocode and generate the report.
- Keep permissions narrow.

## Architecture

1. Chrome extension captures a user-entered or user-selected address.
2. Extension opens `https://chicagoincentiveexplorer.com/lookup?addr=...`.
3. `/lookup` calls the existing geocoder.
4. If geocoding succeeds, `/lookup` redirects to `/report?instant=true&lat=...&lon=...&addr=...`.
5. If geocoding fails, `/lookup` redirects to `/report?addr=...&lookup=not-found` so the address is preserved.

## Non-Goals

- No background scraping.
- No API keys in the extension.
- No page-reading permissions.
- No private user-entered notes.
- No separate extension database.

## Future Iterations

- Chrome Web Store listing and screenshots.
- Gmail/Google Docs/Sheets contextual handoff after permission review.
- Saved report handoff for authenticated workspace users.
- Extension event tracking after privacy copy is finalized.
