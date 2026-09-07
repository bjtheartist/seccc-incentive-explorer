# Follow-up: two-second map target

Source: Billy's request to get map loading under two seconds, following PR #284. Based on merged commit `6a1b44d`. No linked Linear issue was supplied. The measurements below were captured locally before deployment.

## Result

The two-second target is **not yet met consistently**. Five fresh Chromium contexts against the final local production build took **4.575, 2.440, 3.631, 2.552, and 2.505 seconds** to show usable map search and controls with a real canvas and no fallback. Median: **2.552 seconds**. All five loaded successfully with no JavaScript errors or initial incentive-geometry requests.

These runs use SwiftShader software graphics, a 1440 × 1000 viewport, real Mapbox requests, blocked service workers, and no artificial network/CPU throttling. Contexts start without browser caches, but share one browser process; this is not five independent cold GPU-driver starts. Server assets/image cache can be warm. These are laboratory results, not production field measurements or a guarantee for visitors.

The previous release's live measurements included a 1.957-second sample, with a 3.631-second median. Its earlier local measurements had a 2.085-second median. Different runs vary heavily in graphics cost; **this follow-up does not establish a controls-ready latency improvement over that earlier local release measurement**. Its verified gains are earlier requests, less startup transfer, and one graphics context.

## Changes

- Next server-renders the map shell and includes its chunk preload references in the initial HTML. Mapbox initialization stays in a client effect.
- The page preconnects to Mapbox and preloads the base-style URL using the installed SDK version. The browser reuses that response for Mapbox; a real-browser test requires exactly one style request. In the final measurements the style request starts 6–57 milliseconds after navigation, before graphics initialization.
- The WebGL preflight checks API availability without creating a throwaway graphics context. Mapbox creates the one real context; context-creation failure still shows the existing unsupported-browser fallback, and `?mapgl=0` remains supported.
- Closed desktop menus defer route prefetching until opened. On `/map`, the desktop report CTA prefetches on pointer entry or keyboard focus; the home link no longer prefetches during map startup. Other routes retain their existing report/home prefetch behavior. The mobile menu still prefetches when opened.
- Next Image serves a responsive version of the existing decorative hero with the same crop and dark overlay.
- The benchmark supports a configurable sample count, captures resource start times, closes browser resources on failure, and rejects a fallback screen or JavaScript error as a successful map load.

| Startup transfer | Previous live release | Final local candidate |
| --- | ---: | ---: |
| Encoded JavaScript received by readiness | 1,155,905 bytes (median) | 753,578 bytes (all five runs) |
| Desktop hero image | 3,837,971 bytes | 221,616 bytes |

That is about **35% less startup JavaScript** and a **94% smaller hero transfer**. Live and local servers can use different compression; the browser test independently confirms that report and hidden analysis routes are not requested during map startup.

## Remaining bottleneck

A CPU profile of the intermediate local build attributed 1.774 seconds to Mapbox graphics initialization and roughly 1.475 seconds to graphics-state updates, within a 4.777-second load. This identifies graphics startup/rendering as the remaining constraint in this software-rendered environment. Removing a preflight context does not remove the cost of initializing the real context.

The first optimization candidate had 10.124, 20.056, and 2.527-second samples; a separate instrumented run timed out. These exploratory results are retained in ignored `output/performance/` alongside the final five-run sample. They are not silently discarded from the record. No readiness event was moved earlier: controls still wait for Mapbox's existing `load` event and control installation, while optional layers load independently as in PR #284.

## Verification

- Production build, TypeScript, targeted ESLint, and `git diff --check` pass.
- 32 unit tests pass across `map-render-fallback.test.tsx` and `header-nav.test.tsx`.
- All 13 browser checks pass, covering server-rendered map markup, a single graphics context, one reused style request, failed context creation, deferred navigation with keyboard operation, pending optional boundaries, lazy selected geometry, deselection/reselection, failed-layer retry, manual tours, mobile overlays, and a preserved Incentive Guide draft.
- The new behavior is exercised through the real page in `tests/e2e/map-startup-performance.spec.ts`; the existing tour/mobile/guide browser files are also run.

No data, program rules, authentication, map styling, tour pacing, or overlay selection behavior was changed. No dependencies, environment variables, or migrations were added. The full repository test suite and live authenticated admin views were not rerun for this follow-up.

Reproduce after a production build:

```sh
npm run start -- --port 3101
node scripts/benchmark-map-loading.mjs http://localhost:3101 under-two 5
PLAYWRIGHT_BASE_URL=http://localhost:3101 npx playwright test tests/e2e/map-startup-performance.spec.ts tests/e2e/map-spotlight.spec.ts tests/e2e/map-mobile-overlays.spec.ts tests/e2e/concierge-lazy.spec.ts --project=chromium --workers=1 --retries=0
```
