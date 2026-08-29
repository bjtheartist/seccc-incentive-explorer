import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "components/map/MapView.tsx"), "utf8");

function sourceBetween(start: string, end: string, fromIndex = 0): string {
  const startIndex = source.indexOf(start, fromIndex);
  expect(startIndex, `source contains ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `source contains ${end} after ${start}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("MapView drawn-area vacancy lifecycle wiring", () => {
  it("bounds the optional zoning layer request without blocking map readiness forever", () => {
    const zoningLoad = sourceBetween(
      "const zoningRequestController = new AbortController()",
      "/* ── Parcel boundary layer"
    );

    expect(source).toContain("const OPTIONAL_ZONING_LAYER_TIMEOUT_MS = 30_000");
    expect(zoningLoad).toContain("zoningRequestController.abort()");
    expect(zoningLoad).toContain("OPTIONAL_ZONING_LAYER_TIMEOUT_MS");
    expect(zoningLoad).toContain("signal: zoningRequestController.signal");
    expect(zoningLoad).toContain("window.clearTimeout(zoningRequestTimeout)");
  });

  it("binds fetch publication to the request generation", () => {
    const analysis = sourceBetween(
      "const analyzePolygon = useCallback",
      "const countyReliefRecipientsAbortRef",
    );
    const createHandler = sourceBetween(
      'map.on("draw.create"',
      'map.on("draw.modechange"',
    );

    expect(analysis).toContain("polygonVacancyRequests.start()");
    expect(analysis).toContain("fetchDrawnAreaVacancy(geom");
    expect(analysis).toContain("signal: vacancyRequest.signal");
    expect(analysis.match(/vacancyRequest\.isCurrent\(\)/g)).toHaveLength(2);
    expect(analysis).toContain("setPolygonVacancyLoadFailed(true)");
    expect(analysis).toContain("setPolygonLoading(false)");
    expect(analysis).toContain(".finally(() => vacancyRequest.release())");

    expect(createHandler).toContain("draw.deleteAll()");
    expect(createHandler).toContain("setAnalyzedPolygon(map, geom)");
    expect(createHandler).toContain("analyzePolygon(geom)");
  });

  it("cancels and invalidates the request on draw deletion", () => {
    const deleteHandler = sourceBetween(
      'map.on("draw.delete"',
      "setLoaded(true)",
    );

    expect(deleteHandler).toContain("polygonVacancyRequests.cancel()");
    expect(deleteHandler).toContain("setPolygonResults(null)");
    expect(deleteHandler).toContain("setPolygonLoading(false)");
    expect(deleteHandler).toContain("setPolygonPanelOpen(false)");
  });

  it("atomically cancels Escape from edit and keeps the closed analysis reopenable", () => {
    const modeHandler = sourceBetween(
      'map.on("draw.modechange"',
      'map.on("draw.delete"',
    );
    expect(modeHandler).toContain("shouldCancelDrawnAreaEditOnModeChange");
    expect(modeHandler).toContain("setAnalyzedPolygon(map, polygonGeometryRef.current)");
    expect(modeHandler).toContain("setPolygonEditing(false)");
    expect(modeHandler).toContain("setPolygonEditDirty(false)");
    expect(source).toContain("blocksDrawnAreaSnapshot(drawModeRef.current, polygonEditingRef.current)");
    expect(source).toContain("shouldCancelDrawnAreaEditOnKey(polygonEditingRef.current, event.key)");
    expect(source).toContain('window.addEventListener("keydown", cancelDrawnAreaEditOnEscape, true)');
    expect(source).toContain("detachDrawEscapeHandler?.()");
    expect(source).toContain('onClick={() => setPolygonPanelOpen(true)}');
    expect(source).toContain("Area Analysis");
    expect(source).toContain("top-32 md:top-14 left-3 md:left-auto right-auto md:right-3 z-50 min-h-11");
    expect(source).toContain("!polygonPanelOpen && !polygonResults && !countyReliefRecipientsPanel");
  });

  it("cancels the active request during component cleanup", () => {
    const drawDeleteIndex = source.indexOf('map.on("draw.delete"');
    const cleanup = sourceBetween(
      "return () => {",
      "map.remove();",
      drawDeleteIndex,
    );

    expect(cleanup).toContain("polygonVacancyRequests.cancel()");
  });

  it("starts a fresh polygon draw after Clear & Redraw", () => {
    const clearHandler = sourceBetween(
      "onClear={() => {",
      "        />",
      source.indexOf("{/* Polygon analysis panel */"),
    );

    expect(clearHandler).toContain('draw.changeMode("draw_polygon")');
    expect(clearHandler).toContain("drawModeRef.current = true");
    expect(clearHandler).toContain("setDrawMode(true)");
    expect(clearHandler).toContain("resetAreaAnalysisWorkstation()");
  });

  it("keeps the global map search from covering the open workstation header", () => {
    const searchOverlay = sourceBetween(
      "{/* Search bar */}",
      "{/* Legend toggle button",
    );

    expect(searchOverlay).toContain("loaded && !polygonPanelOpen");
    expect(searchOverlay).toContain("<MapSearch");
  });
});
