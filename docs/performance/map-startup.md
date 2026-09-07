# Map startup performance

Release candidate: branch `perf/map-startup`, based on `4775bb9` from `origin/main`. The source specification is Billy's request to substantially reduce incentive-map and key-feature loading time; no matching open Linear performance issue was found.

## What changes

- Search, navigation, drawing, and the walkthrough become usable after Mapbox's base style and control installation. Community boundaries and citywide zoning populate independently instead of blocking every interaction.
- All 20 incentive overlays initially remain off, as before. Their layer positions are reserved immediately, but geometry is fetched only after a visitor selects a layer or preset. Selections made while requests are pending are respected; repeat selections reuse cached data. The legend reports pending and failed layer loads and explains how to retry.
- Zoning remains visible by default. Reserving its original layer position preserves the stacking order relative to incentive zones, parcels, permits, and selection highlights. The existing unavailable state and 30-second source timeout remain.
- Arcs/Density code, area-analysis UI, property-dossier UI, and recipient-detail UI are imported on demand. The investment runtime remains behind the same admin and selected-view checks.
- The map spotlight is now a four-step explanation controlled by Next, Back, Done, and Escape. It does not type a demo address, change layers, reset the camera, or clear the visitor's selected point. Clicking the dimmed overlay does not advance it. Desktop and mobile controls have visible anchors, including the mobile menu for Generate Report. Existing completed/skipped preferences remain respected.
- The sitewide Incentive Guide initially downloads its launcher and feature-flag check. The AI SDK and conversation UI load when opened, and the mounted conversation persists across closing, reopening, and page navigation.

This follows [Next.js's documented lazy-loading approach](https://nextjs.org/docs/app/guides/lazy-loading); the Mapbox version, data sources, and program-matching rules are unchanged.

## Measurement

Three fresh Chromium browser contexts per build, 1440 × 1000 viewport, production builds, real external map/data requests, no artificial network or CPU throttling. WebGL runs through Chromium SwiftShader. The local server uses the existing public Mapbox token and static-data fallback, with no production database credentials. These are local measurements, not a production rollout or a field Core Web Vitals result.

The timed endpoint is **visible map search / usable controls**, not completion of every optional data source. The remote live baseline was also observed, separately: 15.415, 19.223, and 33.451 seconds (median 19.223 seconds).

| Local production measurement | Before | After |
| --- | ---: | ---: |
| Map controls, median | 18.795 s | 2.376 s |
| Individual samples | 23.454 / 18.795 / 15.218 s | 3.591 / 1.958 / 2.376 s |
| Initial incentive geometry requests | 20 | 0 |
| Encoded JavaScript received by controls-ready | 1,424,530 bytes | 1,165,965 bytes |

The measured performance-candidate median improves by 87.4%; initial JavaScript decreases by 18.2%. An earlier optimized-build run had a 1.815-second median; the table uses the later performance build rather than the faster sample. Data for a newly selected overlay still depends on its source's response time. This change removes that dependency from unrelated map controls and hidden layers.

Raw baseline and comparison results are kept locally in `output/performance/` (ignored by Git). Reproduce against production builds with:

```sh
npm ci
npm run build
npm run start -- --port 3101
# In another terminal:
node scripts/benchmark-map-loading.mjs http://localhost:3101 local-after
```

The benchmark blocks application pageview events, uses fresh contexts with the guide dismissed, redacts Mapbox tokens from its JSON output, and fails if search never becomes ready. Compare the same code/build configuration before and after; do not use development compilation time as a performance benchmark.

## Verification

Production build, TypeScript, and full ESLint pass (nine existing warnings, no errors). The full unit suite passes 6,338 tests overall with two skipped; two sandbox IPC failures passed on focused reruns outside that restriction. The investment input manifest verifies. Sixteen relevant browser scenarios pass across the following files:

- `map-startup-performance.spec.ts`: usable search with optional sources held pending; only selected geometry fetched; deselection while loading; cached reselection; failed-layer retry.
- `map-spotlight.spec.ts`: explicit navigation with no automatic typing or preset changes; overlay clicks stay on the current step; replay/close preserves the visitor's search, marker, and selected layer; four visible desktop/mobile anchors with correct progress and popover placement; no collision with the sitewide welcome.
- `map-mobile-overlays.spec.ts`: existing map tapping and mobile overlay interactions.
- `concierge-lazy.spec.ts` and `concierge-lazy.test.tsx`: deferred conversation loading and an unsent draft preserved across Programs → Report navigation, closing, and reopening.

The browser tests pin optional responses when testing source slowness or failures, and disable service workers so page-level request interception cannot be bypassed. No test sends a guide message, writes production business data, or changes permissions. Private investment views were not exercised against a live admin account. Report generation, matching, authentication, source geometry, and backend caches were not changed. No migrations or new environment variables are required.
