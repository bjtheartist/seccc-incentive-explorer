# Chicago Incentive Explorer — Incentive Check 1.0.0

A Manifest V3 companion for [chicagoincentiveexplorer.com](https://chicagoincentiveexplorer.com). Type a Chicago address in the toolbar popup, or open a Cook County Assessor PIN page, and the extension reports which incentive zones cover that address, the top three matching programs, and a link to the full report. No accounts, no analytics, no remote code.

## Surfaces

- **Popup** (`popup.html`): address field, matched zones, top three programs, "Open full report", and up to eight recent lookups read from the local cache.
- **Content script** (`https://www.cookcountyassessoril.gov/pin/* and cookcountyassessor.com/pin/*`): reads Address / City / Pin from the "PIN & Address" block, runs the same lookup, and inserts a small panel after that block inside a shadow root. It runs at `document_idle`, is wrapped in `try`/`catch`, and leaves the host page untouched if anything fails or the property is not in Chicago.

## Install unpacked

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this `extension/` directory.
3. Pin **Incentive Check** to the toolbar. Chrome 116 or later is required.

## Test

```sh
npm --prefix extension ci
npm --prefix extension test
```

The Node tests cover the lookup pipeline against a fake fetch (zone normalization, program trimming, the Chicago bounds guard, per-call timeouts, and the two error messages), the service worker (cache hits, 24-hour expiry, 20-entry LRU eviction, serialized concurrent lookups, the sender guard), the assessor parser against a saved copy of a real PIN page, the popup DOM under LinkeDOM (rendering, escaped text, error copy, recent-list clicks), and a manifest check that every referenced file exists. They do not replace a smoke test in an installed Chrome.

## Update

Bump `version` in `manifest.json`, the heading and effective line in `privacy.html`, and the heading here. Regenerate the icons from the site's `app/icon.svg` if it changes:

```sh
node -e 'const s=require("../node_modules/sharp"),f=require("fs");const svg=f.readFileSync("../app/icon.svg");(async()=>{for(const n of [16,32,48,128]) await s(svg,{density:600}).resize(n,n).png().toFile(`icons/icon${n}.png`)})()'
```

Then reload the extension at `chrome://extensions` and refresh any open assessor tabs so they pick up the new content script.

## Adding a second site

Per-site parsers live in `site-parsers.js` as pure functions of a `document` that return `{address, city, pin}` or `null`. Add one entry to `PARSERS` with its `hostSuffix`, add the match pattern to `content_scripts` in the manifest, and add a fixture-backed test. `content.js` needs no changes. `cookcountypropertyinfo.com` is the next planned parser.

## Storage and privacy

Completed lookups are cached in `chrome.storage.local` under `cie_lookup_cache_v1`: at most 20 addresses, each expiring 24 hours after it was saved, least-recently-used evicted first. The popup's recent list is derived from that cache, not stored separately. The only data that leaves the browser is the address text — typed, or read from an assessor page you opened — which goes to chicagoincentiveexplorer.com to run the geocode, zone check, and program match. Nothing is written to the assessor page or its site storage. The full policy is `privacy.html` (the extension's options page) and is also published at https://chicagoincentiveexplorer.com/extension/privacy.
