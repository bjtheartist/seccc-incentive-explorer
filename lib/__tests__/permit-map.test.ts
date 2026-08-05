import { describe, expect, it } from "vitest";
import {
  PERMIT_MAP_TYPES,
  defaultPermitTypeVisibility,
  permitMapTypeForSource,
} from "@/lib/permit-map";

describe("permit map taxonomy", () => {
  it("defines every source-backed map type with stable unique values", () => {
    expect(PERMIT_MAP_TYPES).toHaveLength(11);
    expect(PERMIT_MAP_TYPES.map((type) => type.key)).toEqual([
      "express_permit_program",
      "easy_permit_process",
      "renovation_alteration",
      "signs",
      "new_construction",
      "elevator_equipment",
      "wrecking_demolition",
      "scaffolding",
      "reinstate_revoked_permit",
      "porch_construction",
      "permit_extension",
    ]);
    expect(new Set(PERMIT_MAP_TYPES.map((type) => type.sourceValue)).size).toBe(11);
    expect(new Set(PERMIT_MAP_TYPES.map((type) => type.color)).size).toBe(11);
    for (const type of PERMIT_MAP_TYPES) {
      expect(type.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(permitMapTypeForSource(type.sourceValue)).toBe(type);
    }
  });

  it("normalizes source casing, spacing, and dash variants", () => {
    expect(
      permitMapTypeForSource("  permit - express permit program  ")?.key,
    ).toBe("express_permit_program");
    expect(
      permitMapTypeForSource("permit \u2014 renovation/alteration")?.key,
    ).toBe("renovation_alteration");
  });

  it("keeps historical source types explicit and rejects unknown values", () => {
    expect(permitMapTypeForSource(null)).toBeNull();
    expect(permitMapTypeForSource(" ")).toBeNull();
    expect(permitMapTypeForSource("PERMIT - PORCH CONSTRUCTION")?.key).toBe(
      "porch_construction",
    );
    expect(permitMapTypeForSource("PERMIT - FOR EXTENSION OF PMT")?.key).toBe(
      "permit_extension",
    );
    expect(permitMapTypeForSource("PERMIT - UNKNOWN CATEGORY")).toBeNull();
  });

  it("returns a fresh all-visible record for each caller", () => {
    const first = defaultPermitTypeVisibility();
    const second = defaultPermitTypeVisibility();

    expect(Object.keys(first)).toEqual(PERMIT_MAP_TYPES.map((type) => type.key));
    expect(Object.values(first)).toEqual(Array(11).fill(true));

    first.express_permit_program = false;
    expect(second.express_permit_program).toBe(true);
  });
});
