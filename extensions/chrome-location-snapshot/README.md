# Chicago Incentive Explorer Chrome Extension

This is the first local build of the Chrome extension for Chicago Incentive Explorer.

## What It Does

- Adds a right-click action for selected text: `Run Chicago Incentive Snapshot`.
- Opens `https://chicagoincentiveexplorer.com/lookup?addr=...`.
- Provides a small popup where a user can type an address directly.
- Stores the last five typed addresses locally in Chrome storage.

The extension does not geocode addresses itself. It sends the address to the Explorer site, and the site routes the user into the normal location-snapshot report flow.

## Local Install

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `extensions/chrome-location-snapshot`.
5. Highlight an address on a webpage, right-click, and choose `Run Chicago Incentive Snapshot`.

## Permissions

- `contextMenus`: adds the selected-address action.
- `storage`: saves recent typed addresses locally for convenience.

There are no host permissions in v1. The extension does not read page content unless the user explicitly selects text and chooses the context-menu action.

## Release Notes

Before publishing to the Chrome Web Store, add production icons, screenshots, a short privacy policy link, and final store listing copy.
