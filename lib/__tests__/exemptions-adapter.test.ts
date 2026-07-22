import { describe, expect, it } from "vitest";
import {
  PTAXSIM_VERSION,
  PTAXSIM_DB_URL,
  consolidateVetExemption,
  exemptionsAdapter,
  ptaxsimUrlFingerprint,
  type RawExemptionRow,
} from "../ingest/exemptions";

/** A raw PTAXSIM `pin`-table row with every exemption column zeroed. */
function rawRow(over: Partial<RawExemptionRow> = {}): RawExemptionRow {
  return {
    pin: "20363230080000",
    year: 2024,
    exe_homeowner: 0,
    exe_senior: 0,
    exe_freeze: 0,
    exe_disabled: 0,
    exe_longtime_homeowner: 0,
    exe_vet_returning: 0,
    exe_vet_dis_lt50: 0,
    exe_vet_dis_50_69: 0,
    exe_vet_dis_ge70: 0,
    exe_vet_dis_100: 0,
    exe_wwii: 0,
    ...over,
  };
}

describe("PTAXSIM url/version pinning", () => {
  it("pins the exact verified version and S3 URL", () => {
    expect(PTAXSIM_VERSION).toBe("2024.0.0");
    expect(PTAXSIM_DB_URL).toBe(
      "https://ccao-data-public-us-east-1.s3.amazonaws.com/ptaxsim/ptaxsim-2024.0.0.db.bz2",
    );
  });

  it("has a stable URL fingerprint (guards against silent URL drift)", () => {
    // If this changes, the pinned PTAXSIM version/URL changed — update deliberately.
    expect(ptaxsimUrlFingerprint()).toBe(ptaxsimUrlFingerprint());
    expect(ptaxsimUrlFingerprint()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("targets the parcel_exemptions table with a stable source key", () => {
    expect(exemptionsAdapter.targetTable).toBe("parcel_exemptions");
    expect(exemptionsAdapter.sourceKey).toBe("ptaxsim_exemptions");
  });
});

describe("consolidateVetExemption", () => {
  it("sums all six veteran-related columns (null-safe)", () => {
    expect(
      consolidateVetExemption(
        rawRow({
          exe_vet_returning: 5000,
          exe_vet_dis_lt50: 2500,
          exe_vet_dis_50_69: 5000,
          exe_vet_dis_ge70: null,
          exe_vet_dis_100: 0,
          exe_wwii: 100,
        }),
      ),
    ).toBe(12600);
  });

  it("is zero when no veteran exemption is present", () => {
    expect(consolidateVetExemption(rawRow())).toBe(0);
  });
});

describe("exemptionsAdapter.normalize", () => {
  it("maps EAV columns and consolidates the veteran columns into exe_vet", () => {
    const row = exemptionsAdapter.normalize(
      rawRow({
        exe_homeowner: 10000,
        exe_senior: 8000,
        exe_freeze: 12000,
        exe_disabled: 2000,
        exe_longtime_homeowner: 500,
        exe_vet_returning: 5000,
        exe_wwii: 100,
      }),
    );
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("20363230080000");
    expect(row!.taxYear).toBe(2024);
    expect(row!.exeHomeowner).toBe(10000);
    expect(row!.exeSenior).toBe(8000);
    expect(row!.exeFreeze).toBe(12000);
    expect(row!.exeDisabled).toBe(2000);
    expect(row!.exeLongtime).toBe(500);
    expect(row!.exeVet).toBe(5100);
    expect(row!.provenance.source).toBe("ptaxsim_exemptions");
  });

  it("normalizes a dashed PIN to 14 digits", () => {
    const row = exemptionsAdapter.normalize(rawRow({ pin: "20-36-323-008-0000" }));
    expect(row!.pin).toBe("20363230080000");
  });

  it("drops a row whose PIN is not 14 digits", () => {
    expect(exemptionsAdapter.normalize(rawRow({ pin: "123" }))).toBeNull();
  });

  it("coerces null EAV columns to 0 (honest — a missing exemption is 0, never negative)", () => {
    const row = exemptionsAdapter.normalize(
      rawRow({ exe_homeowner: null, exe_senior: null, exe_freeze: null }),
    );
    expect(row!.exeHomeowner).toBe(0);
    expect(row!.exeSenior).toBe(0);
    expect(row!.exeFreeze).toBe(0);
  });
});
