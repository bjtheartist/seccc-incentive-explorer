import { describe, expect, it } from "vitest";
import {
  collectUpcomingDeadlines,
  deadlinesForAddress,
  TIF_EXPIRES_SOON_MONTHS,
  type ProgramCardSlim,
  type SbifWindow,
  type TifFinancialsSlim,
} from "@/lib/deadlines";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TODAY = new Date("2026-07-02T12:00:00Z");

function daysFromToday(days: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const programs: ProgramCardSlim[] = [
  { id: "cdg-small", name: "Community Development Grant — Small", deadline: daysFromToday(6) }, // July 8
  { id: "nof-q3", name: "Neighborhood Opportunity Fund Q3", deadline: daysFromToday(43) }, // Aug 14
  { id: "cdg-medium", name: "Community Development Grant — Medium", deadline: daysFromToday(43) }, // Aug 14
  { id: "workforce-solutions", name: "Workforce Solutions Program", deadline: null }, // no deadline
  { id: "old-program", name: "Old Grant", deadline: daysFromToday(-5) }, // past
  { id: "far-future", name: "Far Future Program", deadline: daysFromToday(120) }, // > 90 days
];

// ── collectUpcomingDeadlines ──────────────────────────────────────────────────

describe("collectUpcomingDeadlines", () => {
  it("returns only future deadlines within the default 90-day window", () => {
    const items = collectUpcomingDeadlines(programs, TODAY);
    const ids = items.map((i) => i.programId);
    expect(ids).toContain("cdg-small");
    expect(ids).toContain("nof-q3");
    expect(ids).toContain("cdg-medium");
    // These must not appear:
    expect(ids).not.toContain("workforce-solutions"); // no deadline
    expect(ids).not.toContain("old-program");         // past
    expect(ids).not.toContain("far-future");           // beyond window
  });

  it("sorts results nearest-first", () => {
    const items = collectUpcomingDeadlines(programs, TODAY);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].daysFromToday).toBeGreaterThanOrEqual(
        items[i - 1].daysFromToday
      );
    }
  });

  it("sets daysFromToday accurately", () => {
    const items = collectUpcomingDeadlines(programs, TODAY);
    const cdg = items.find((i) => i.programId === "cdg-small")!;
    expect(cdg.daysFromToday).toBe(6);
    expect(cdg.isPast).toBe(false);
  });

  it("respects a custom windowDays argument", () => {
    const narrow = collectUpcomingDeadlines(programs, TODAY, 10);
    const wide = collectUpcomingDeadlines(programs, TODAY, 50);
    expect(narrow.length).toBeLessThan(wide.length);
    // Only cdg-small (6 days) should appear in the narrow window.
    expect(narrow.map((i) => i.programId)).toEqual(["cdg-small"]);
  });

  it("returns empty array when no programs have upcoming deadlines", () => {
    const result = collectUpcomingDeadlines(
      [{ id: "x", name: "X", deadline: daysFromToday(-1) }],
      TODAY
    );
    expect(result).toHaveLength(0);
  });

  it("sets kind='program_deadline' on all items", () => {
    const items = collectUpcomingDeadlines(programs, TODAY);
    for (const item of items) {
      expect(item.kind).toBe("program_deadline");
    }
  });
});

// ── deadlinesForAddress ───────────────────────────────────────────────────────

const sbifRollout: SbifWindow[] = [
  {
    tifDistrict: "Commercial Avenue TIF",
    windowStart: daysFromToday(-1), // already open
    windowEnd: daysFromToday(29),
  },
  {
    tifDistrict: "Stony Island Arts Bank TIF",
    windowStart: daysFromToday(30),
    windowEnd: daysFromToday(59),
  },
];

const tifFinancials: Record<string, TifFinancialsSlim> = {
  "T-141": {
    tifNumber: "T-141",
    tifName: "Commercial Avenue",
    expirationDate: daysFromToday(300), // ~10 months — act soon
    expirationYear: TODAY.getFullYear() + 1,
    expiresWithin24Months: true,
  },
  "T-200": {
    tifNumber: "T-200",
    tifName: "Far Future District",
    expirationDate: daysFromToday(1000), // ~33 months — not soon
    expirationYear: TODAY.getFullYear() + 3,
    expiresWithin24Months: false,
  },
  "T-001": {
    tifNumber: "T-001",
    tifName: "Already Expired",
    expirationDate: daysFromToday(-5), // expired 5 days ago
    expirationYear: TODAY.getFullYear(),
    expiresWithin24Months: false,
  },
};

describe("deadlinesForAddress", () => {
  it("returns program deadlines only for matched programs", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [programs[0], programs[1]], // cdg-small + nof-q3
      tifDistrict: null,
      tifFinancials: null,
      sbifRollout: null,
      today: TODAY,
    });
    const ids = result.upcomingProgramDeadlines.map((d) => d.programId);
    expect(ids).toContain("cdg-small");
    expect(ids).toContain("nof-q3");
  });

  it("surfaces the SBIF window when the district matches an open window", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: "Commercial Avenue TIF",
      tifFinancials: null,
      sbifRollout,
      today: TODAY,
    });
    expect(result.sbifWindow).not.toBeNull();
    expect(result.sbifWindow!.kind).toBe("sbif_window");
    // Window is currently open (start was yesterday) — daysFromToday should be 0 or near-0.
    expect(result.sbifWindow!.isPast).toBe(false);
    expect(result.sbifWindow!.note).toMatch(/open through/i);
  });

  it("returns null sbifWindow when district does not match rollout", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: "T-999",
      tifFinancials: null,
      sbifRollout,
      today: TODAY,
    });
    expect(result.sbifWindow).toBeNull();
  });

  it("sets actSoon=true when TIF expires within 24 months", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: "T-141",
      tifFinancials,
      sbifRollout: null,
      today: TODAY,
    });
    expect(result.tifExpirationAlert).not.toBeNull();
    expect(result.tifExpirationAlert!.actSoon).toBe(true);
  });

  it("sets actSoon=false when TIF expiration is beyond 24 months", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: "T-200",
      tifFinancials,
      sbifRollout: null,
      today: TODAY,
    });
    expect(result.tifExpirationAlert).not.toBeNull();
    expect(result.tifExpirationAlert!.actSoon).toBe(false);
  });

  it("surfaces already-expired TIF with non-positive monthsRemaining", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: "T-001",
      tifFinancials,
      sbifRollout: null,
      today: TODAY,
    });
    // Expired 5 days ago — within 1 year so should still surface.
    // 5 days rounds to ~0 months (< 1 month), so we check ≤ 0.
    expect(result.tifExpirationAlert).not.toBeNull();
    expect(result.tifExpirationAlert!.monthsRemaining).toBeLessThanOrEqual(0);
  });

  it("returns null tifExpirationAlert when no TIF district", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [],
      tifDistrict: null,
      tifFinancials,
      sbifRollout: null,
      today: TODAY,
    });
    expect(result.tifExpirationAlert).toBeNull();
  });

  it("allItems combines program deadlines, sbif window, and tif alert sorted by date", () => {
    const result = deadlinesForAddress({
      matchedPrograms: [programs[0], programs[1]],
      tifDistrict: "T-141",
      tifFinancials,
      sbifRollout,
      today: TODAY,
    });
    expect(result.allItems.length).toBeGreaterThanOrEqual(3);
    // Sorted ascending.
    for (let i = 1; i < result.allItems.length; i++) {
      expect(result.allItems[i].daysFromToday).toBeGreaterThanOrEqual(
        result.allItems[i - 1].daysFromToday
      );
    }
    const kinds = result.allItems.map((i) => i.kind);
    expect(kinds).toContain("program_deadline");
    expect(kinds).toContain("tif_expiration");
  });

  it("TIF_EXPIRES_SOON_MONTHS is 24", () => {
    expect(TIF_EXPIRES_SOON_MONTHS).toBe(24);
  });
});
