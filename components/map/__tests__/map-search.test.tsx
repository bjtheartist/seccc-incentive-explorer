import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapSearch from "../MapSearch";

describe("MapSearch interaction layer", () => {
  it("renders above the sticky header and location panels on every viewport", () => {
    const html = renderToStaticMarkup(<MapSearch onResult={() => {}} />);

    expect(html).toContain('data-testid="map-search"');
    expect(html).toContain("z-[60]");
    expect(html).toContain("isolate");
    expect(html).toContain("pointer-events-auto");
  });

  it("keeps suggestion rows in an explicit clickable layer", () => {
    const source = readFileSync(
      join(process.cwd(), "components/map/MapSearch.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="map-search-results"');
    expect(source).toContain("relative z-[70]");
    expect(source).toContain("pointer-events-auto touch-manipulation");
    expect(source).toContain("onPointerDown={(e) => e.stopPropagation()}");
  });
});
