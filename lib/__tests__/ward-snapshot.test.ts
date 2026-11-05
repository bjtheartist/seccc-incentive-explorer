import { describe, expect, it } from "vitest";
import { rankWards, type WardSnapshotWard } from "@/lib/ward-snapshot";

function ward(n: number, vacantLots: number | null): WardSnapshotWard {
  return {
    ward: n,
    areas: [],
    population: 50_000,
    values: { vacantLots, avPerResident: null, youthPovertyRate: null, tifSpending: null },
    detail: { vacantPrivate: 0, vacantCityOwned: 0, assessedValue: 0, youthInPoverty: 0, youthPopulation: 0 },
  };
}

describe("rankWards", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => ward(i + 1, (i + 1) * 10));

  it("ranks highest first and splits 50 wards into five tiers of 10", () => {
    const r = rankWards(fifty, "vacantLots");
    expect(r.get(50)).toEqual({ rank: 1, of: 50, tier: "Very High" });
    expect(r.get(41)?.tier).toBe("Very High");
    expect(r.get(40)?.tier).toBe("High");
    expect(r.get(21)?.tier).toBe("Moderate");
    expect(r.get(11)?.tier).toBe("Low");
    expect(r.get(10)?.tier).toBe("Very Low");
    expect(r.get(1)).toEqual({ rank: 50, of: 50, tier: "Very Low" });
  });

  it("gives tied wards the same rank", () => {
    const r = rankWards([ward(1, 5), ward(2, 9), ward(3, 9), ward(4, 1)], "vacantLots");
    expect(r.get(2)?.rank).toBe(1);
    expect(r.get(3)?.rank).toBe(1);
    expect(r.get(1)?.rank).toBe(3);
  });

  it("leaves wards without a value unranked instead of ranking them last", () => {
    const r = rankWards([ward(1, 5), ward(2, null)], "vacantLots");
    expect(r.has(2)).toBe(false);
    expect(r.get(1)).toEqual({ rank: 1, of: 1, tier: "Very High" });
  });
});
