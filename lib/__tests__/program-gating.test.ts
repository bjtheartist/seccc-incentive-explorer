import { describe, expect, it } from "vitest";
import type { Program } from "../types";
import type { SbifWindow } from "../deadlines";
import { resolveAvailability, isExpired, excludeExpiredPrograms } from "../program-gating";

/** Fixed reference date for every case: July 2, 2026. */
const TODAY = new Date("2026-07-02T12:00:00Z");

function program(overrides: Partial<Program> & { id: string }): Program {
  return {
    name: `Test Program ${overrides.id}`,
    level: "City",
    zoneKey: "",
    summary: "Test summary.",
    whoQualifies: "",
    benefits: [],
    howToApply: [],
    requiredDocs: [],
    contact: "",
    url: "",
    ...overrides,
  };
}

const SBIF_ROLLOUT: SbifWindow[] = [
  // Window already closed relative to TODAY
  { tifDistrict: "119th/Halsted", windowStart: "2026-02-01", windowEnd: "2026-03-02" },
  // Window currently open (contains TODAY)
  { tifDistrict: "Archer/Western", windowStart: "2026-07-01", windowEnd: "2026-07-30" },
  // Window scheduled in the future
  { tifDistrict: "43rd/Cottage Grove", windowStart: "2026-08-01", windowEnd: "2026-08-30" },
];

describe("resolveAvailability", () => {
  it("returns active when the card has no gating info", () => {
    const result = resolveAvailability(program({ id: "plain" }), TODAY);
    expect(result.state).toBe("active");
    expect(result.nextWindow).toBeUndefined();
    expect(result.note).toBeUndefined();
  });

  it("returns active with the nearest nextWindow when a future deadline exists", () => {
    const result = resolveAvailability(
      program({
        id: "futureDeadline",
        deadlines: [
          { label: "Early round", date: "2026-01-15" }, // past — ignored
          { label: "Final round", date: "2026-08-14" },
          { label: "Late round", date: "2026-11-01" },
        ],
      }),
      TODAY
    );
    expect(result.state).toBe("active");
    expect(result.nextWindow?.date).toBe("2026-08-14");
    expect(result.nextWindow?.label).toBe("Final round");
  });

  it("returns expired for a oneTime program whose every deadline has passed", () => {
    const result = resolveAvailability(
      program({
        id: "oneShot",
        oneTime: true,
        deadlines: [
          { label: "Application deadline", date: "2026-01-15" },
          { label: "Second chance deadline", date: "2026-05-01" },
        ],
      }),
      TODAY
    );
    expect(result.state).toBe("expired");
    expect(result.note).toContain("2026-05-01");
  });

  it("returns expired when an explicit expiresOn date is in the past", () => {
    const result = resolveAvailability(
      program({ id: "hardExpiry", expiresOn: "2026-06-30" }),
      TODAY
    );
    expect(result.state).toBe("expired");
    expect(result.note).toContain("2026-06-30");
  });

  it("keeps a oneTime program active until its expiresOn/deadline passes", () => {
    // Mirrors sbaDisasterEidl: oneTime with a future final deadline.
    const card = program({
      id: "disasterLoan",
      oneTime: true,
      expiresOn: "2027-01-25",
      deadlines: [{ label: "Economic injury EIDL application deadline", date: "2027-01-25" }],
    });
    expect(resolveAvailability(card, TODAY).state).toBe("active");
    expect(resolveAvailability(card, TODAY).nextWindow?.date).toBe("2027-01-25");
    // ...and expires once the date passes.
    expect(resolveAvailability(card, new Date("2027-02-01T00:00:00Z")).state).toBe("expired");
  });

  it("does not expire a oneTime card with no dated deadlines (safe default)", () => {
    const result = resolveAvailability(program({ id: "oneTimeNoDates", oneTime: true }), TODAY);
    expect(result.state).toBe("active");
  });

  describe("SBIF district windows (recurring, rollout-driven)", () => {
    const sbif = program({
      id: "sbif",
      zoneKey: "tif",
      recurring: true,
      deadlines: [
        { label: "July 2026 window opens (eligible districts)", date: "2026-07-01" },
        { label: "July 2026 window closes", date: "2026-07-30" },
      ],
    });

    it("returns window-closed with a note for a district whose window has passed", () => {
      const result = resolveAvailability(sbif, TODAY, {
        sbifRollout: SBIF_ROLLOUT,
        tifDistrict: "119th/Halsted",
      });
      expect(result.state).toBe("window-closed");
      expect(result.note).toMatch(/applications currently closed/i);
      expect(result.note).toMatch(/next window expected/i);
      expect(result.nextWindow).toBeUndefined();
    });

    it("returns window-closed with the scheduled nextWindow for a future-window district", () => {
      const result = resolveAvailability(sbif, TODAY, {
        sbifRollout: SBIF_ROLLOUT,
        tifDistrict: "43rd/Cottage Grove",
      });
      expect(result.state).toBe("window-closed");
      expect(result.note).toMatch(/next window opens 2026-08-01/i);
      expect(result.nextWindow?.date).toBe("2026-08-01");
      expect(result.nextWindow?.endDate).toBe("2026-08-30");
    });

    it("returns active with the open window for an in-window district", () => {
      const result = resolveAvailability(sbif, TODAY, {
        sbifRollout: SBIF_ROLLOUT,
        tifDistrict: "Archer/Western",
      });
      expect(result.state).toBe("active");
      expect(result.nextWindow?.date).toBe("2026-07-01");
      expect(result.nextWindow?.endDate).toBe("2026-07-30");
      expect(result.note).toMatch(/open through 2026-07-30/i);
    });

    it("falls back to generic card dates when the district is not in the rollout", () => {
      const result = resolveAvailability(sbif, TODAY, {
        sbifRollout: SBIF_ROLLOUT,
        tifDistrict: "Nonexistent District",
      });
      // Generic path: future July 30 close date exists → active.
      expect(result.state).toBe("active");
      expect(result.nextWindow?.date).toBe("2026-07-30");
    });
  });

  it("returns lapsed-notice with the existing lapse warning for status=lapsed", () => {
    const result = resolveAvailability(
      program({
        id: "wotcOverlay",
        status: "lapsed",
        sunsetWarning:
          "WOTC authority lapsed 12/31/2025. Continue IRS Form 8850 pre-screening.",
      }),
      TODAY
    );
    expect(result.state).toBe("lapsed-notice");
    expect(result.note).toContain("WOTC authority lapsed");
  });

  it("returns lapsed-notice with a generic note when the card has no sunsetWarning", () => {
    const result = resolveAvailability(program({ id: "lapsedPlain", status: "lapsed" }), TODAY);
    expect(result.state).toBe("lapsed-notice");
    expect(result.note).toMatch(/lapsed/i);
  });

  it("returns window-closed for a recurring program whose rounds have all passed", () => {
    // Mirrors cdgSmall after its August 14 deadline.
    const result = resolveAvailability(
      program({
        id: "cdgSmallLike",
        recurring: true,
        deadlines: [{ label: "Small CDG application deadline", date: "2026-08-14" }],
      }),
      new Date("2026-09-01T00:00:00Z")
    );
    expect(result.state).toBe("window-closed");
    expect(result.note).toMatch(/applications currently closed/i);
  });

  it("keeps a recurring program active when its latest past event was a window OPENING", () => {
    // Mirrors workforceSolutions: "Q3 2026 window opened (non-TIF businesses)"
    // dated 2026-07-01 — the window is open, not between rounds.
    const result = resolveAvailability(
      program({
        id: "workforceLike",
        recurring: true,
        deadlines: [{ label: "Q3 2026 window opened (non-TIF businesses)", date: "2026-07-01" }],
      }),
      TODAY
    );
    expect(result.state).toBe("active");
  });

  it("keeps a recurring program with no dated windows active (rolling submissions)", () => {
    // Mirrors nof: rolling submission, evaluated quarterly.
    const result = resolveAvailability(program({ id: "nofLike", recurring: true }), TODAY);
    expect(result.state).toBe("active");
  });
});

describe("isExpired / excludeExpiredPrograms", () => {
  it("filters expired cards and keeps the rest", () => {
    const expired = program({ id: "gone", expiresOn: "2026-01-01" });
    const alive = program({ id: "alive" });
    const lapsed = program({ id: "lapsed", status: "lapsed" });
    expect(isExpired(expired, TODAY)).toBe(true);
    expect(isExpired(alive, TODAY)).toBe(false);
    const kept = excludeExpiredPrograms([expired, alive, lapsed], TODAY);
    expect(kept.map((p) => p.id)).toEqual(["alive", "lapsed"]);
  });
});
