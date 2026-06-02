import { describe, expect, it } from "vitest";
import {
  computeVacancy,
  computeTurnover,
  computeOwnershipConcentration,
  computeOwnershipOrigin,
  computePermitActivity,
  computeIncentiveCoverage,
  computeHealthScore,
  DEFAULT_WEIGHTS,
  type ParcelRow,
  type BusinessLicenseRow,
  type PermitRow,
} from "@/lib/corridor-health";

const WINDOW_START = new Date("2025-01-01T00:00:00.000Z");
const WINDOW_END = new Date("2025-12-31T23:59:59.000Z");

function parcel(overrides: Partial<ParcelRow>): ParcelRow {
  return { pin: Math.random().toString(36).slice(2), ...overrides };
}

/* ── Vacancy ──────────────────────────────────────────────────────────── */
describe("computeVacancy", () => {
  it("returns 0 rate for an empty corridor", () => {
    const m = computeVacancy([]);
    expect(m.vacancyRate).toBe(0);
    expect(m.totalParcels).toBe(0);
  });

  it("computes the vacant share", () => {
    const m = computeVacancy([
      parcel({ is_vacant: true }),
      parcel({ is_vacant: false }),
      parcel({ is_vacant: true }),
      parcel({ is_vacant: null }),
    ]);
    expect(m.vacantCount).toBe(2);
    expect(m.totalParcels).toBe(4);
    expect(m.vacancyRate).toBe(0.5);
  });

  it("handles an all-vacant corridor", () => {
    const m = computeVacancy([parcel({ is_vacant: true }), parcel({ is_vacant: true })]);
    expect(m.vacancyRate).toBe(1);
  });
});

/* ── Turnover ─────────────────────────────────────────────────────────── */
describe("computeTurnover", () => {
  it("returns zeros for no licenses", () => {
    const m = computeTurnover([], WINDOW_START, WINDOW_END);
    expect(m.openings).toBe(0);
    expect(m.closures).toBe(0);
    expect(m.net).toBe(0);
    expect(m.turnoverRate).toBe(0);
  });

  it("counts openings inside the window and ignores ones outside", () => {
    const licenses: BusinessLicenseRow[] = [
      { license_status: "AAI", license_start_date: "2025-03-01" }, // opening
      { license_status: "AAI", license_start_date: "2020-01-01" }, // too old
    ];
    const m = computeTurnover(licenses, WINDOW_START, WINDOW_END);
    expect(m.openings).toBe(1);
    expect(m.closures).toBe(0);
    expect(m.net).toBe(1);
  });

  it("counts closures by closed status and expiration in window", () => {
    const licenses: BusinessLicenseRow[] = [
      { license_status: "AAC", expiration_date: "2025-06-01" }, // closure in window
      { license_status: "REV", expiration_date: null }, // closed, no date → counts
      { license_status: "AAC", expiration_date: "2019-01-01" }, // closed, out of window
    ];
    const m = computeTurnover(licenses, WINDOW_START, WINDOW_END);
    expect(m.closures).toBe(2);
    expect(m.openings).toBe(0);
    expect(m.net).toBe(-2);
  });

  it("clamps turnoverRate to <= 1", () => {
    const licenses: BusinessLicenseRow[] = [
      { license_status: "AAC", license_start_date: "2025-02-01", expiration_date: "2025-09-01" },
    ];
    const m = computeTurnover(licenses, WINDOW_START, WINDOW_END);
    // 1 opening + 1 closure over 1 license = 2/1, clamped to 1.
    expect(m.turnoverRate).toBe(1);
  });
});

/* ── Ownership concentration ──────────────────────────────────────────── */
describe("computeOwnershipConcentration", () => {
  it("handles empty corridor", () => {
    const m = computeOwnershipConcentration([]);
    expect(m.hhi).toBe(0);
    expect(m.topOwnerShare).toBe(0);
    expect(m.distinctOwners).toBe(0);
  });

  it("single owner of everything yields HHI = 1", () => {
    const m = computeOwnershipConcentration([
      parcel({ owner_name: "ACME LLC" }),
      parcel({ owner_name: "acme llc" }), // case-insensitive merge
      parcel({ owner_name: "ACME LLC" }),
    ]);
    expect(m.distinctOwners).toBe(1);
    expect(m.hhi).toBeCloseTo(1, 10);
    expect(m.topOwnerShare).toBe(1);
  });

  it("fully diffuse ownership yields HHI = 1/n", () => {
    const m = computeOwnershipConcentration([
      parcel({ owner_name: "A" }),
      parcel({ owner_name: "B" }),
      parcel({ owner_name: "C" }),
      parcel({ owner_name: "D" }),
    ]);
    expect(m.distinctOwners).toBe(4);
    expect(m.hhi).toBeCloseTo(0.25, 10);
    expect(m.topOwnerShare).toBe(0.25);
  });

  it("excludes missing owner names instead of treating unknown as concentration", () => {
    const m = computeOwnershipConcentration([parcel({}), parcel({ owner_name: "" })]);
    expect(m.distinctOwners).toBe(0);
    expect(m.totalParcels).toBe(0);
    expect(m.hhi).toBe(0);
  });
});

/* ── Local vs outside ownership ───────────────────────────────────────── */
describe("computeOwnershipOrigin", () => {
  it("handles empty corridor", () => {
    const m = computeOwnershipOrigin([]);
    expect(m.localShare).toBe(0);
    expect(m.outsideShare).toBe(0);
  });

  it("classifies local vs outside capital", () => {
    const m = computeOwnershipOrigin([
      parcel({ owner_type: "local_private" }),
      parcel({ owner_type: "out_of_state" }),
      parcel({ owner_type: "corporate_llc" }),
      parcel({ owner_type: "city_public" }), // neither
      parcel({ owner_type: "unknown" }), // neither
    ]);
    expect(m.localCount).toBe(1);
    expect(m.outsideCount).toBe(2);
    expect(m.localShare).toBeCloseTo(1 / 3, 10);
    expect(m.outsideShare).toBeCloseTo(2 / 3, 10);
  });
});

/* ── Permit activity ──────────────────────────────────────────────────── */
describe("computePermitActivity", () => {
  it("returns zeros for no permits", () => {
    const m = computePermitActivity([], WINDOW_START, WINDOW_END);
    expect(m.permitCount).toBe(0);
    expect(m.totalReportedCost).toBe(0);
    expect(m.demolitionCount).toBe(0);
  });

  it("sums cost and flags demolitions within the window", () => {
    const permits: PermitRow[] = [
      { issue_date: "2025-04-01", reported_cost: 100000, is_demolition: false },
      { issue_date: "2025-08-01", reported_cost: "50000", is_demolition: true },
      { issue_date: "2010-01-01", reported_cost: 999999, is_demolition: false }, // out of window
    ];
    const m = computePermitActivity(permits, WINDOW_START, WINDOW_END);
    expect(m.permitCount).toBe(2);
    expect(m.totalReportedCost).toBe(150000);
    expect(m.demolitionCount).toBe(1);
  });
});

/* ── Incentive coverage (documented stub) ─────────────────────────────── */
describe("computeIncentiveCoverage", () => {
  it("reports unknown coverage when coveredCount is null", () => {
    const m = computeIncentiveCoverage(100, null);
    expect(m.coverageShare).toBeNull();
    expect(m.coveredCount).toBeNull();
    expect(m.totalParcels).toBe(100);
  });

  it("computes a share when counts are available", () => {
    const m = computeIncentiveCoverage(200, 50);
    expect(m.coverageShare).toBeCloseTo(0.25, 10);
  });

  it("reports null when there are no parcels", () => {
    const m = computeIncentiveCoverage(0, 0);
    expect(m.coverageShare).toBeNull();
  });
});

/* ── Composite health score ───────────────────────────────────────────── */
describe("computeHealthScore", () => {
  const healthyZip = {
    vacancy: { vacancyRate: 0.05, vacantCount: 5, totalParcels: 100 },
    turnover: { openings: 10, closures: 2, net: 8, turnoverRate: 0.12 },
    ownershipConcentration: { hhi: 0.05, topOwnerShare: 0.1, distinctOwners: 40, totalParcels: 100 },
    ownershipOrigin: { localShare: 0.7, outsideShare: 0.2, localCount: 70, outsideCount: 20, totalParcels: 100 },
    permits: { permitCount: 50, totalReportedCost: 5_000_000, demolitionCount: 1 },
    incentiveCoverage: { coverageShare: 0.6, coveredCount: 60, totalParcels: 100 },
  };

  const distressedZip = {
    vacancy: { vacancyRate: 0.6, vacantCount: 60, totalParcels: 100 },
    turnover: { openings: 1, closures: 12, net: -11, turnoverRate: 1 },
    ownershipConcentration: { hhi: 0.9, topOwnerShare: 0.95, distinctOwners: 3, totalParcels: 100 },
    ownershipOrigin: { localShare: 0.05, outsideShare: 0.8, localCount: 5, outsideCount: 80, totalParcels: 100 },
    permits: { permitCount: 4, totalReportedCost: 20000, demolitionCount: 3 },
    incentiveCoverage: { coverageShare: 0.1, coveredCount: 10, totalParcels: 100 },
  };

  it("returns a score in 0..100", () => {
    const score = computeHealthScore(healthyZip);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("ranks a healthy corridor above a distressed one", () => {
    expect(computeHealthScore(healthyZip)).toBeGreaterThan(computeHealthScore(distressedZip));
  });

  it("re-normalizes weights when incentive coverage is unknown", () => {
    const withUnknown = {
      ...healthyZip,
      incentiveCoverage: { coverageShare: null, coveredCount: null, totalParcels: 100 },
    };
    const score = computeHealthScore(withUnknown);
    // Still a valid 0..100 score even though one component dropped out.
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("scores an empty corridor without throwing", () => {
    const empty = {
      vacancy: { vacancyRate: 0, vacantCount: 0, totalParcels: 0 },
      turnover: { openings: 0, closures: 0, net: 0, turnoverRate: 0 },
      ownershipConcentration: { hhi: 0, topOwnerShare: 0, distinctOwners: 0, totalParcels: 0 },
      ownershipOrigin: { localShare: 0, outsideShare: 0, localCount: 0, outsideCount: 0, totalParcels: 0 },
      permits: { permitCount: 0, totalReportedCost: 0, demolitionCount: 0 },
      incentiveCoverage: { coverageShare: null, coveredCount: null, totalParcels: 0 },
    };
    const score = computeHealthScore(empty);
    expect(Number.isFinite(score)).toBe(true);
  });

  it("default weights sum to 1", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
