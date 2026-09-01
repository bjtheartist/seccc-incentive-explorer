import { beforeEach, describe, expect, it, vi } from "vitest";

const { socrataFetchResultMock } = vi.hoisted(() => ({ socrataFetchResultMock: vi.fn() }));
vi.mock("../socrata", () => ({ socrataFetchResult: socrataFetchResultMock }));

import {
  TIF_FINANCE_NO_ROW_CAUTION,
  TIF_FINANCE_UNAVAILABLE_CAUTION,
  fetchLatestTifFinanceContext,
} from "../tif-finance";

/**
 * R1 finding 4 — the false-claims class, TIF finance surface.
 *
 * `fetchLatestTifFinanceContext` used to feed a failed Socrata fetch and an
 * empty (but successful) Socrata response into the SAME branch, and that
 * branch published: "This address is inside a TIF boundary, but no annual
 * finance row was matched for this district." When the portal was down, that
 * sentence was a claim about the City's records made from no evidence at all.
 *
 * Every test below therefore asserts BOTH halves of the contract: the honest
 * unavailability copy is PRESENT, and the absence claim is ABSENT.
 */

const BOUNDARY = {
  districtId: "T-087",
  rawDistrictId: "T- 87",
  districtName: "Fullerton/Milwaukee",
  expirationDate: "12/31/2027",
  boundaryWards: "1,26,30,31,35",
};

beforeEach(() => {
  socrataFetchResultMock.mockReset();
});

describe("TIF finance: an outage is never rendered as an absence", () => {
  const failures = [
    { reason: "http_error", detail: "HTTP 503" },
    { reason: "timeout", detail: "The operation timed out." },
    { reason: "network_error", detail: "fetch failed" },
    { reason: "invalid_json", detail: "Unexpected token <" },
  ] as const;

  for (const failure of failures) {
    it(`a ${failure.reason} says the data is temporarily unavailable, never "no annual finance row was matched"`, async () => {
      socrataFetchResultMock.mockResolvedValue({ ok: false, ...failure });

      const context = await fetchLatestTifFinanceContext(BOUNDARY);

      expect(context).not.toBeNull();
      expect(context!.dataAvailability).toBe("unavailable");
      expect(context!.caution).toBe(TIF_FINANCE_UNAVAILABLE_CAUTION);
      expect(context!.caution).toContain("temporarily unavailable");
      // The exact dishonest sentence this finding exists to remove.
      expect(context!.caution).not.toContain("no annual finance row was matched");
      // Nothing eligibility-shaped leaked into the outage copy.
      expect(context!.caution).not.toMatch(/eligib|qualif|approved|available funding/i);
      // And no figure is invented to fill the gap.
      expect(context!.fundBalance).toBeUndefined();
      expect(context!.propertyTaxIncrementCurrent).toBeUndefined();
    });
  }

  it("a SUCCESSFUL but empty response keeps the genuine absence claim — the honest case is not over-corrected", async () => {
    socrataFetchResultMock.mockResolvedValue({ ok: true, data: [] });

    const context = await fetchLatestTifFinanceContext(BOUNDARY);

    expect(context!.dataAvailability).toBe("no_row");
    expect(context!.caution).toBe(TIF_FINANCE_NO_ROW_CAUTION);
    expect(context!.caution).toContain("no annual finance row was matched");
    expect(context!.caution).not.toContain("temporarily unavailable");
  });

  it("a matched row reports dataAvailability 'matched' and keeps its existing caution", async () => {
    socrataFetchResultMock.mockResolvedValue({
      ok: true,
      data: [
        {
          tif_number: "T-087",
          tif_district: "Fullerton/Milwaukee",
          report_year: "2024",
          fund_balance: "63162041",
        },
      ],
    });

    const context = await fetchLatestTifFinanceContext(BOUNDARY);

    expect(context!.dataAvailability).toBe("matched");
    expect(context!.fundBalance).toBe(63162041);
    expect(context!.caution).toContain("Not proof of funding availability");
    expect(context!.caution).not.toContain("temporarily unavailable");
    expect(context!.caution).not.toContain("no annual finance row was matched");
  });

  it("an unparseable district id still short-circuits to null before any fetch", async () => {
    await expect(
      fetchLatestTifFinanceContext({ ...BOUNDARY, districtId: "" }),
    ).resolves.toBeNull();
    expect(socrataFetchResultMock).not.toHaveBeenCalled();
  });
});
