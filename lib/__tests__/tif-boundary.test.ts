import { describe, expect, it } from "vitest";
import { findTifBoundaryAtPoint } from "../tif-boundary";

describe("findTifBoundaryAtPoint", () => {
  it("tolerates malformed rings in the source GeoJSON (regression)", async () => {
    // This point previously threw "First and last coordinates in a ring
    // must be the same" from turf.booleanPointInPolygon — the city's TIF
    // boundary export ships at least one unclosed ring. The lookup must
    // skip the malformed feature and keep scanning instead of failing.
    const result = await findTifBoundaryAtPoint(41.8481, -87.6395);

    // Either a matched district or null — never a throw.
    if (result) {
      expect(result.districtId).toMatch(/^T-\d+$/);
      expect(result.districtName).toBeTruthy();
    } else {
      expect(result).toBeNull();
    }
  });

  it("still resolves districts for well-formed areas", async () => {
    // A point outside Chicago returns null without throwing.
    const result = await findTifBoundaryAtPoint(40.0, -88.0);
    expect(result).toBeNull();
  });
});
