# PR 1 Mobile Map QA Checklist

Use this checklist for `/map` on a deployed preview or local build with a valid Mapbox token.

## Devices

- iPhone Safari: current iOS, portrait first, then rotate once to landscape.
- Android Chrome: current Android, portrait first, then rotate once to landscape.
- QR/mobile entry: open the same `/map` URL from a QR scan or direct mobile share link; confirm it lands on the map without requiring desktop-only navigation.

## Core Flow

- Search an address, such as `710 E 79th St, Chicago, IL`; confirm the map centers on the result and the mobile Location Snapshot opens.
- In Location Snapshot, confirm `Generate Location Snapshot` is the primary action and opens the report flow with the searched address/location.
- Reopen `/map`, open `Show Legend`, and apply each mobile preset: `Incentives`, `Vacancy`, `Zoning`, and `Community Assets`.
- For each preset, close and reopen the legend; confirm the selected map state remains understandable and no unrelated panel stays stuck open.
- Open the advanced legend details, including zoning code help, then close it; confirm the bottom sheet remains scrollable and dismissible.
- From Location Snapshot, tap `Draw Area Analysis`; confirm drawing mode starts and the draw area controls remain reachable on mobile.
- Cancel drawing, then start drawing again from the map-level `Draw Area` button; confirm the alternate entry point still works.

## Visual Checks

- Search, legend, snapshot, and draw controls do not overlap each other in portrait or landscape.
- Buttons and checkboxes are touch-friendly; no tap target requires pinch zoom.
- Bottom sheets do not block Mapbox attribution or make it impossible to pan/zoom the visible map.
- Long address text, preset labels, zoning labels, and snapshot stat rows fit without clipping or horizontal scrolling.
- Close controls are visible and easy to hit for both the legend and Location Snapshot sheets.

## Data Checks

- `Vacancy` preset loads vacancy points/clusters for the current map bounds only; panning or zooming refreshes the points without loading citywide data.
- `Zoning` preset shows zoning context without leaving all unrelated incentive, vacancy, parcel, or POI layers enabled.
- `Community Assets` preset can be tested with POI/network fetch failure; the map should stay usable and should not crash.
- Search plus Location Snapshot still shows census, parcel, zoning, and top-program data when available, with graceful blanks/loading states when a source fails.

## Pass Criteria

- Both iPhone Safari and Android Chrome complete the core flow without reloads, dead controls, or unusable overlap.
- QR/mobile entry reaches the same usable map flow as direct navigation.
- Any failure is recorded with device, browser, viewport orientation, URL, address searched, preset selected, and screenshot or screen recording.
