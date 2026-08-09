import { describe, expect, it } from "vitest";
import {
  bestMatchedPermit,
  classifyMatch,
  haversineMetres,
  normalizePermitAddress,
  parcelPinMatchesPermitPin,
  pinMatchConfidence,
  SPATIAL_MATCH_RADIUS_M,
  type MatchableParcel,
  type MatchablePermit,
  type MatchedPermit,
} from "../permit-match";
import {
  PERMIT_COST_LABEL,
  PERMIT_DATA_SOURCE_TEXT,
  PERMIT_NO_MATCH_TEXT,
  PERMIT_VERIFICATION_NOTE,
  formatPermitCost,
  permitDetailLines,
} from "../permit-match-lines";

/**
 * MATCH QUALITY — fixture-based, no network and no database.
 *
 * The six parcels below are spread across the North, West and South sides so
 * the suite proves the rules hold citywide rather than only in the three
 * SE-Chicago ZIPs the pilot covered. Coordinates and PIN area codes are
 * realistic for their side (PIN area 11/14 = far north, 16 = west, 20/25 =
 * south); nothing here is fetched.
 */

interface Fixture {
  side: "North" | "West" | "South";
  parcel: MatchableParcel;
}

const PARCELS: Fixture[] = [
  {
    side: "North",
    parcel: {
      pin: "11322100120000",
      address: "1424 W MORSE AVE",
      lat: 42.0079,
      lon: -87.6672,
    },
  },
  {
    side: "North",
    parcel: {
      pin: "14083080450000",
      address: "4611 N BROADWAY",
      lat: 41.9664,
      lon: -87.6558,
    },
  },
  {
    side: "West",
    parcel: {
      pin: "16111050040000",
      address: "3717 W CHICAGO AVE",
      lat: 41.8951,
      lon: -87.7196,
    },
  },
  {
    side: "West",
    parcel: {
      pin: "16232180040000",
      address: "3351 W DOUGLAS BLVD",
      lat: 41.8621,
      lon: -87.7099,
    },
  },
  {
    side: "South",
    parcel: {
      pin: "20032220170000",
      address: "437 E 42ND PL",
      lat: 41.8173,
      lon: -87.6150,
    },
  },
  {
    side: "South",
    parcel: {
      pin: "25101150030000",
      address: "10432 S MICHIGAN AVE",
      lat: 41.7043,
      lon: -87.6199,
    },
  },
];

/** A permit whose 10-digit PIN is the parcel's first ten digits. */
function pinPermit(parcel: MatchableParcel, permitId: string): MatchablePermit {
  return {
    permitId,
    pins: [(parcel.pin ?? "").slice(0, 10)],
    address: null,
    lat: null,
    lon: null,
  };
}

describe("PIN tier — the 10-digit vs 14-digit fact the whole match rests on", () => {
  it("matches a 10-digit permit PIN to the parcel's first ten digits", () => {
    expect(parcelPinMatchesPermitPin("16111050040000", "1611105004")).toBe(true);
  });

  it("does NOT match on raw digits-only equality, which is why a naive join finds nothing", () => {
    // The naive version of this join compares the full strings and matches zero
    // rows citywide. Pinned so nobody "simplifies" it back.
    const parcelPin: string = "16111050040000";
    const permitPin: string = "1611105004";
    expect(parcelPin === permitPin).toBe(false);
    expect(parcelPinMatchesPermitPin("16111050040000", "16111050040000")).toBe(true);
  });

  it("refuses a partial PIN rather than matching a prefix", () => {
    expect(parcelPinMatchesPermitPin("16111050040000", "161110")).toBe(false);
    expect(parcelPinMatchesPermitPin("161110500400", "1611105004")).toBe(false);
    expect(parcelPinMatchesPermitPin(null, "1611105004")).toBe(false);
    expect(parcelPinMatchesPermitPin("16111050040000", null)).toBe(false);
  });

  it("grades an undivided parcel HIGH and a unit-suffixed parcel MEDIUM", () => {
    expect(pinMatchConfidence("16111050040000")).toBe("high");
    expect(pinMatchConfidence("16111050041007")).toBe("medium");
  });

  it.each(PARCELS)("PIN-matches the $side parcel $parcel.address at high confidence", ({ parcel }) => {
    const outcome = classifyMatch(parcel, pinPermit(parcel, "B100000001"));
    expect(outcome).not.toBeNull();
    expect(outcome!.method).toBe("pin_exact");
    expect(outcome!.confidence).toBe("high");
    expect(outcome!.matchedOn).toBe((parcel.pin ?? "").slice(0, 10));
  });

  it("does not cross-match parcels on different sides", () => {
    const north = PARCELS[0].parcel;
    const south = PARCELS[5].parcel;
    expect(classifyMatch(north, pinPermit(south, "B1"))).toBeNull();
    expect(classifyMatch(south, pinPermit(north, "B2"))).toBeNull();
  });

  it("finds the parcel among a permit's MULTIPLE pins, not just the first", () => {
    const west = PARCELS[2].parcel;
    const permit: MatchablePermit = {
      permitId: "B100000009",
      pins: ["2605112042", "1733326038", (west.pin ?? "").slice(0, 10)],
      address: null,
      lat: null,
      lon: null,
    };
    const outcome = classifyMatch(west, permit);
    expect(outcome?.method).toBe("pin_exact");
  });
});

describe("address tier", () => {
  it("normalizes case, punctuation and spacing identically on both sides", () => {
    expect(normalizePermitAddress("3717 W Chicago Ave.")).toBe("3717wchicagoave");
    expect(normalizePermitAddress("3717  W  CHICAGO   AVE")).toBe("3717wchicagoave");
  });

  it.each(PARCELS)("address-matches the $side parcel when the PIN is absent", ({ parcel }) => {
    const permit: MatchablePermit = {
      permitId: "B200000001",
      pins: [],
      address: (parcel.address ?? "").toLowerCase() + ".",
      lat: null,
      lon: null,
    };
    const outcome = classifyMatch({ ...parcel, pin: null }, permit);
    expect(outcome).not.toBeNull();
    expect(outcome!.method).toBe("address_normalized");
    expect(outcome!.confidence).toBe("medium");
  });

  it("does NOT fuzzy-match a near-miss address", () => {
    const west = PARCELS[2].parcel;
    // Same block, no suffix — a fuzzy matcher would take it. This one must not.
    const permit: MatchablePermit = {
      permitId: "B2",
      pins: [],
      address: "3717 W CHICAGO",
      lat: null,
      lon: null,
    };
    expect(classifyMatch({ ...west, pin: null, lat: null, lon: null }, permit)).toBeNull();
  });

  it("does not let placeholder or stub addresses match each other", () => {
    const permit: MatchablePermit = {
      permitId: "B3",
      pins: [],
      address: "Unknown",
      lat: null,
      lon: null,
    };
    expect(
      classifyMatch(
        { pin: null, address: "Unknown", lat: null, lon: null },
        permit,
      ),
    ).toBeNull();
    expect(
      classifyMatch(
        { pin: null, address: "12 A St", lat: null, lon: null },
        { permitId: "B4", pins: [], address: "12 A St", lat: null, lon: null },
      ),
    ).toBeNull();
  });
});

describe("spatial tier", () => {
  it.each(PARCELS)(
    "matches a nearby permit point for the $side parcel at LOW confidence",
    ({ parcel }) => {
      // ~11 m north of the parcel.
      const permit: MatchablePermit = {
        permitId: "B300000001",
        pins: [],
        address: null,
        lat: (parcel.lat ?? 0) + 0.0001,
        lon: parcel.lon,
      };
      const outcome = classifyMatch({ ...parcel, pin: null, address: null }, permit);
      expect(outcome).not.toBeNull();
      expect(outcome!.method).toBe("spatial_proximity");
      expect(outcome!.confidence).toBe("low");
    },
  );

  it("rejects a point beyond the disclosed radius", () => {
    const south = PARCELS[4].parcel;
    const permit: MatchablePermit = {
      permitId: "B3",
      pins: [],
      address: null,
      // ~55 m away — outside the 25 m radius.
      lat: (south.lat ?? 0) + 0.0005,
      lon: south.lon,
    };
    expect(classifyMatch({ ...south, pin: null, address: null }, permit)).toBeNull();
  });

  it("measures the radius in metres the way the SQL tier does", () => {
    const d = haversineMetres(41.8173, -87.615, 41.8174, -87.615);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(13);
    expect(SPATIAL_MATCH_RADIUS_M).toBe(25);
  });
});

describe("tier precedence", () => {
  it("prefers PIN over address and address over proximity for the same pair", () => {
    const west = PARCELS[2].parcel;
    const everything: MatchablePermit = {
      permitId: "B4",
      pins: [(west.pin ?? "").slice(0, 10)],
      address: west.address,
      lat: west.lat,
      lon: west.lon,
    };
    expect(classifyMatch(west, everything)!.method).toBe("pin_exact");

    const noPin = { ...everything, pins: [] };
    expect(classifyMatch(west, noPin)!.method).toBe("address_normalized");

    const noPinNoAddress = { ...noPin, address: null };
    expect(classifyMatch(west, noPinNoAddress)!.method).toBe("spatial_proximity");
  });

  it("shows the strongest, then most recent, match on the card", () => {
    const mk = (
      permitId: string,
      matchMethod: MatchedPermit["matchMethod"],
      issueDate: string,
    ): MatchedPermit => ({
      permitId,
      permitType: "PERMIT - RENOVATION/ALTERATION",
      workType: null,
      workDescription: null,
      issueDate,
      reportedCost: 1000,
      permitStatus: "COMPLETE",
      permitMilestone: null,
      permitCondition: null,
      matchMethod,
      matchConfidence: matchMethod === "pin_exact" ? "high" : "low",
    });

    const chosen = bestMatchedPermit([
      mk("B-old-pin", "pin_exact", "2019-01-01"),
      mk("B-new-proximity", "spatial_proximity", "2025-06-01"),
      mk("B-new-pin", "pin_exact", "2024-09-09"),
    ]);
    expect(chosen!.permitId).toBe("B-new-pin");
    expect(bestMatchedPermit([])).toBeNull();
  });
});

describe("honesty rails in the rendered copy", () => {
  const permit: MatchedPermit = {
    permitId: "B100912345",
    permitType: "PERMIT - RENOVATION/ALTERATION",
    workType: "Interior Alteration",
    workDescription: "INTERIOR REMODEL",
    issueDate: "2024-03-15",
    reportedCost: 125000,
    permitStatus: "COMPLETE",
    permitMilestone: "COMPLETE",
    permitCondition: null,
    matchMethod: "pin_exact",
    matchConfidence: "high",
  };

  it("labels every reported cost as an applicant estimate", () => {
    expect(formatPermitCost(125000)).toBe(`$125,000 ${PERMIT_COST_LABEL}`);
    expect(formatPermitCost(null)).toContain(PERMIT_COST_LABEL);
    const cost = permitDetailLines(permit).find((l) => l.label === "Reported cost");
    expect(cost!.value).toContain("(Applicant Estimate)");
  });

  it("renders the required substance, in order", () => {
    expect(permitDetailLines(permit).map((l) => l.label)).toEqual([
      "Type",
      "Date issued",
      "Reported cost",
      "Permit status",
      "Permit #",
      "Match basis",
    ]);
    const byLabel = Object.fromEntries(permitDetailLines(permit).map((l) => [l.label, l.value]));
    expect(byLabel["Permit #"]).toBe("B100912345");
    expect(byLabel["Date issued"]).toBe("Mar 15, 2024");
    expect(byLabel["Match basis"]).toBe("Parcel PIN · High confidence");
  });

  it("does not repeat an identical status and milestone as two confirmations", () => {
    const byLabel = Object.fromEntries(permitDetailLines(permit).map((l) => [l.label, l.value]));
    expect(byLabel["Permit status"]).toBe("COMPLETE");
  });

  it("qualifies the status with a milestone that adds information", () => {
    const lines = permitDetailLines({
      ...permit,
      permitStatus: "ACTIVE",
      permitMilestone: "INSPECTIONS",
    });
    expect(lines.find((l) => l.label === "Permit status")!.value).toBe("ACTIVE · INSPECTIONS");
  });

  it("NEVER prints permit_condition on the status line — it is free text, not a state", () => {
    // Real values observed in the loaded citywide table: a street-address range
    // and a paragraph of electrical-code notes. Either one on a line labeled
    // "Permit status" would misrepresent the record.
    const withAddressCondition = permitDetailLines({
      ...permit,
      permitStatus: "ACTIVE",
      permitMilestone: "INSPECTION ELIGIBLE",
      permitCondition: "5213-5217 W. LAWRENCE AVE",
    });
    const status = withAddressCondition.find((l) => l.label === "Permit status")!.value;
    expect(status).toBe("ACTIVE · INSPECTION ELIGIBLE");
    expect(status).not.toContain("LAWRENCE");

    const withNoteCondition = permitDetailLines({
      ...permit,
      permitStatus: null,
      permitMilestone: null,
      permitCondition: "NO OTHER WORK.",
    });
    expect(withNoteCondition.find((l) => l.label === "Permit status")!.value).toBe("Not recorded");
  });

  it("falls back to the milestone when the status is absent", () => {
    const lines = permitDetailLines({
      ...permit,
      permitStatus: null,
      permitMilestone: "CERTIFICATE OF OCCUPANCY ISSUED",
    });
    expect(lines.find((l) => l.label === "Permit status")!.value).toBe(
      "CERTIFICATE OF OCCUPANCY ISSUED",
    );
  });

  it("keeps the verification note and the source attribution verbatim", () => {
    expect(PERMIT_VERIFICATION_NOTE).toBe(
      "A recent permit record was matched to this parcel. Permit issuance does not guarantee work has commenced or finished. Verify current site conditions in person before outreach or capital commitments.",
    );
    expect(PERMIT_DATA_SOURCE_TEXT).toBe("City of Chicago Building Permits (ydr8-5enu)");
  });

  it("states the absence with the window the ingest actually queried", () => {
    expect(PERMIT_NO_MATCH_TEXT).toBe(
      "No matched permit record in current data window (2015–Present).",
    );
  });
});
