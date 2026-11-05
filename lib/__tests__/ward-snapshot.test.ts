import { describe, expect, it } from "vitest";
import { needIndex, rankWards, tierMatches, type WardSnapshotWard } from "@/lib/ward-snapshot";

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

describe("needIndex", () => {
  const w = (n: number, vacantLots: number, avPerResident: number, youthPovertyRate: number): WardSnapshotWard => ({
    ...ward(n, vacantLots),
    values: { vacantLots, avPerResident, youthPovertyRate, tifSpending: 0 },
  });

  it("ranks the ward with most vacancy, lowest tax base, and highest youth poverty first", () => {
    const r = needIndex([w(1, 100, 5_000, 45), w(2, 10, 90_000, 3), w(3, 50, 20_000, 20)]);
    expect(r.get(1)).toMatchObject({ rank: 1, score: 1 });
    expect(r.get(2)).toMatchObject({ rank: 3, score: 0 });
    expect(r.get(3)?.rank).toBe(2);
  });

  it("ignores TIF spending", () => {
    const a = needIndex([w(1, 100, 5_000, 45), w(2, 10, 90_000, 3)]);
    const b = needIndex([
      { ...w(1, 100, 5_000, 45), values: { vacantLots: 100, avPerResident: 5_000, youthPovertyRate: 45, tifSpending: 9e9 } },
      w(2, 10, 90_000, 3),
    ]);
    expect(b.get(1)).toEqual(a.get(1));
  });
});

describe("tierMatches", () => {
  it("groups top and bottom tiers", () => {
    expect(tierMatches("High", "top")).toBe(true);
    expect(tierMatches("Moderate", "top")).toBe(false);
    expect(tierMatches("Very Low", "bottom")).toBe(true);
    expect(tierMatches(undefined, "any")).toBe(true);
    expect(tierMatches(undefined, "top")).toBe(false);
  });
});
