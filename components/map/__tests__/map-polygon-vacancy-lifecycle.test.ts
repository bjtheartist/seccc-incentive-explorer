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
  it("binds fetch publication to the request generation", () => {
    const createHandler = sourceBetween(
      'map.on("draw.create"',
      'map.on("draw.modechange"',
    );

    expect(createHandler).toContain("polygonVacancyRequests.start()");
    expect(createHandler).toContain("signal: vacancyRequest.signal");
    expect(createHandler.match(/vacancyRequest\.isCurrent\(\)/g)).toHaveLength(2);
    expect(createHandler).toContain(".finally(() => vacancyRequest.release())");
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

  it("cancels the active request during component cleanup", () => {
    const drawDeleteIndex = source.indexOf('map.on("draw.delete"');
    const cleanup = sourceBetween(
      "return () => {",
      "map.remove();",
      drawDeleteIndex,
    );

    expect(cleanup).toContain("polygonVacancyRequests.cancel()");
  });
});
