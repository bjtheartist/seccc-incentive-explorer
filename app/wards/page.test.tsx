import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WardSnapshotPage, { metadata } from "./page";
import snapshot from "@/public/data/ward-snapshot.json";

describe("Ward Snapshot page", () => {
  const html = renderToStaticMarkup(<WardSnapshotPage />);

  it("renders a row for every one of the 50 wards", () => {
    expect(snapshot.wards).toHaveLength(50);
    const rowHeaders = html.match(/<th scope="row"[^>]*>\d+<\/th>/g) ?? [];
    expect(rowHeaders).toHaveLength(50);
  });

  it("shows the four measures and no violent crime column", () => {
    for (const label of ["Vacant Lots", "Property Tax Base", "Youth Poverty", "TIF Spending"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toMatch(/crime/i);
  });

  it("shows a tier, the raw value, and the rank for each cell", () => {
    expect(html).toContain("Very High");
    expect(html).toContain("Very Low");
    expect(html).toMatch(/#1 of 50/);
  });

  it("explains the method and links every source", () => {
    expect(html).toContain("How each measure is built");
    expect(html).toContain("datacatalog.cookcountyil.gov");
    expect(html).toContain("data.census.gov");
    expect(html).toContain("qm7s-3ctt");
    expect(html).toContain("not program eligibility determinations");
  });

  it("stays hidden from search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
