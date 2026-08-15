import { describe, expect, it } from "vitest";
import {
  canonicalizeVacancyZoneMatches,
  isVacancyZoneMatchInput,
} from "@/lib/vacancy-zone-matches";

describe("vacancy zone-match normalization", () => {
  it("prefers a published name from a duplicate over a blank/key fallback", () => {
    const input = [
      { zoneKey: "illinoisOZ", zoneName: "" },
      { zoneKey: "illinoisOZ", zoneName: "Illinois Opportunity Zone" },
    ];

    expect(isVacancyZoneMatchInput(input)).toBe(true);
    expect(canonicalizeVacancyZoneMatches(input)).toEqual([
      { zoneKey: "illinoisOZ", zoneName: "Illinois Opportunity Zone" },
    ]);
  });

  it("falls back only when every name is blank and rejects non-string names", () => {
    expect(
      canonicalizeVacancyZoneMatches([
        { zoneKey: "illinoisOZ", zoneName: null },
        { zoneKey: "illinoisOZ", zoneName: "" },
      ]),
    ).toEqual([{ zoneKey: "illinoisOZ", zoneName: "illinoisOZ" }]);
    expect(
      isVacancyZoneMatchInput([{ zoneKey: "illinoisOZ", zoneName: 42 }]),
    ).toBe(false);
  });
});
