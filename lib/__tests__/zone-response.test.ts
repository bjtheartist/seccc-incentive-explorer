import { describe, expect, it } from "vitest";
import { normalizeZoneCheckResponse } from "../zone-response";

describe("normalizeZoneCheckResponse", () => {
  it("normalizes the current API array shape", () => {
    const result = normalizeZoneCheckResponse([
      { key: "tif", name: "Stony Island TIF" },
      { key: "ccsa", name: "South Chicago Corridor" },
    ]);

    expect(result).not.toBeNull();
    expect(result!.zones.tif).toBe(true);
    expect(result!.zones.ccsa).toBe(true);
    expect(result!.zones.ssa).toBe(false);
    expect(result!.zoneNames).toEqual({
      tif: "Stony Island TIF",
      ccsa: "South Chicago Corridor",
    });
    expect(result!.incentiveCount).toBe(2);
  });

  it("normalizes the legacy object shape", () => {
    const result = normalizeZoneCheckResponse({
      zones: { tif: true, ssa: false, enterprise: 1 },
      zoneNames: { tif: "TIF District", enterprise: "Enterprise Zone" },
    });

    expect(result).not.toBeNull();
    expect(result!.zones.tif).toBe(true);
    expect(result!.zones.ssa).toBe(false);
    expect(result!.zones.enterprise).toBe(true);
    expect(result!.zoneNames.enterprise).toBe("Enterprise Zone");
    expect(result!.incentiveCount).toBe(2);
  });

  it("returns null for unexpected shapes", () => {
    expect(normalizeZoneCheckResponse(null)).toBeNull();
    expect(normalizeZoneCheckResponse({ error: "Database not configured" })).toBeNull();
  });
});
