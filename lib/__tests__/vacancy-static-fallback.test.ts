import { describe, expect, it } from "vitest";
import {
  STATIC_FALLBACK_LIMIT,
  STATIC_FALLBACK_TYPE_QUOTAS,
  staticFallbackReservedCount,
} from "@/lib/vacancy-static-fallback";

describe("vacancy static fallback representation", () => {
  it("reserves deterministic capacity for every published evidence class", () => {
    expect(STATIC_FALLBACK_TYPE_QUOTAS).toEqual({
      vacant_land: 600,
      reported_vacant_lot: 600,
      vacant_building: 600,
      vacant_storefront: 100,
    });
    expect(Object.values(STATIC_FALLBACK_TYPE_QUOTAS).every((quota) => quota > 0)).toBe(
      true,
    );
    expect(staticFallbackReservedCount()).toBeLessThan(STATIC_FALLBACK_LIMIT);
  });
});
