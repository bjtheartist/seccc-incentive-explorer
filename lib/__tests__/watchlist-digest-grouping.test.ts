import { describe, expect, it } from "vitest";
import {
  buildDigestEmailHtml,
  buildDigestSummary,
  assessWatchedArea,
  assessTifExpiration,
  programDeadlineSlims,
  type AreaAssessment,
} from "../watchlist-digest";
import type { DeadlineItem } from "../deadlines";
import { collectUpcomingDeadlines, deadlinesForAddress, findSbifWindow } from "../deadlines";
import type { Program } from "../types";
import catalog from "../../data/programs-internal.json";

const TODAY = new Date("2026-11-02T13:00:00Z");

function deadline(days: number, programId = "program", label = "Application closes"): DeadlineItem {
  return {
    kind: "program_deadline",
    programId,
    label,
    date: new Date(Date.UTC(2026, 10, 2 + days)).toISOString().slice(0, 10),
    daysFromToday: days,
    isPast: days < 0,
  };
}

function area(areaId: string, deadlines: DeadlineItem[] = []): AreaAssessment {
  return {
    areaId,
    areaLabel: `Area ${areaId}`,
    lat: 41.8,
    lon: -87.6,
    tif: null,
    deadlines,
    notable: true,
    zoneDataIncomplete: false,
  };
}

describe("watched-area digest event grouping", () => {
  it("counts November 2's two events across three areas as two deadlines and six matches", () => {
    const events = [deadline(59, "peoplesGas"), deadline(84, "sba")];
    const result = buildDigestSummary([area("a", events), area("b", events), area("c", events)], TODAY);
    expect(result.uniqueDeadlineCount).toBe(2);
    expect(result.areaMatchCount).toBe(6);
    expect(result.dueThisWeek).toHaveLength(0);
    expect(result.planAhead).toHaveLength(2);
    expect(result.planAhead.map((event) => event.areas.length)).toEqual([3, 3]);
  });

  it("does not merge distinct dates or different deadline labels from the same program", () => {
    const result = buildDigestSummary([area("a", [deadline(2), deadline(3), deadline(3, "program", "Separate round")])], TODAY);
    expect(result.uniqueDeadlineCount).toBe(3);
    expect(result.areaMatchCount).toBe(3);
  });

  it("counts duplicate event rows and duplicate area inputs only once per area", () => {
    const first = area("a", [deadline(2), deadline(2)]);
    const result = buildDigestSummary([first, first, area("b", [deadline(2)])], TODAY);
    expect(result.uniqueDeadlineCount).toBe(1);
    expect(result.areaMatchCount).toBe(2);
    expect(result.dueThisWeek[0].areas).toHaveLength(2);
  });

  it("uses seven calendar days including today, then days 7 through 90 for planning", () => {
    const result = buildDigestSummary([area("a", [-1, 0, 6, 7, 90, 91].map((days) => deadline(days)))], TODAY);
    expect(result.dueThisWeek.map((event) => event.item.daysFromToday)).toEqual([0, 6]);
    expect(result.planAhead.map((event) => event.item.daysFromToday)).toEqual([7, 90]);
    expect(result.uniqueDeadlineCount).toBe(4);
  });

  it("keeps a shared TIF expiration separate from program-deadline counts", () => {
    const tif = { districtId: "T-1", districtName: "District", expirationDate: "2027-03-01", daysRemaining: 119, urgent: true };
    const result = buildDigestSummary([{ ...area("a", [deadline(2)]), tif }, { ...area("b"), tif }], TODAY);
    expect(result.uniqueDeadlineCount).toBe(1);
    expect(result.tifExpirations).toHaveLength(1);
    expect(result.tifExpirations[0].areas).toHaveLength(2);
  });

  it("uses an open SBIF window's close date, not its past start or zero-day marker", () => {
    const window: DeadlineItem = {
      kind: "sbif_window", label: "SBIF window", tifDistrict: "T-1",
      date: "2026-11-01", windowEnd: "2026-11-30", daysFromToday: 0, isPast: false,
    };
    const result = buildDigestSummary([area("a", [window])], TODAY);
    expect(result.dueThisWeek).toHaveLength(0);
    expect(result.planAhead).toHaveLength(1);
    expect(result.planAhead[0].item.date).toBe("2026-11-30");
    expect(result.planAhead[0].item.daysFromToday).toBe(28);
  });

  it("recomputes calendar days from Chicago dates rather than trusting stale counters", () => {
    // UTC November 3 is still November 2 in Chicago.
    const evening = new Date("2026-11-03T02:00:00Z");
    const item = { ...deadline(6), daysFromToday: 999 };
    const result = buildDigestSummary([area("a", [item])], evening);
    expect(result.dueThisWeek).toHaveLength(1);
    expect(result.dueThisWeek[0].item.daysFromToday).toBe(6);
  });

  it("handles a seven-day horizon across Chicago's spring DST change", () => {
    const now = new Date("2027-03-13T18:00:00Z");
    const items = ["2027-03-19", "2027-03-20"].map((date) => ({ ...deadline(0), date }));
    const result = buildDigestSummary([area("a", items)], now);
    expect(result.dueThisWeek.map((event) => event.item.date)).toEqual(["2027-03-19"]);
    expect(result.planAhead.map((event) => event.item.date)).toEqual(["2027-03-20"]);
  });

  it("excludes unparseable and impossible dates rather than inventing a deadline", () => {
    const items = ["not-a-date", "2026-11-31"].map((date) => ({ ...deadline(0), date }));
    const result = buildDigestSummary([area("a", items)], TODAY);
    expect(result.uniqueDeadlineCount).toBe(0);
    expect(result.invalidDateAreas).toHaveLength(1);
    expect(buildDigestEmailHtml(null, [area("a", items)], TODAY).subject).toContain("data incomplete");
  });
});

describe("watched-area digest honest rendering", () => {
  it("renders each unique event once, labels the horizons, and avoids snapshot-as-change language", () => {
    const events = [deadline(59, "gas", "Gas cycle"), deadline(84, "sba", "Disaster loan")];
    const { html, subject } = buildDigestEmailHtml("Billy", [area("a", events), area("b", events), area("c", events)], TODAY);
    expect(html.match(/Gas cycle/g)).toHaveLength(1);
    expect(html.match(/Disaster loan/g)).toHaveLength(1);
    expect(html).toContain("Next 7 days — including today");
    expect(html).toContain("Plan ahead");
    expect(html).toContain("90");
    expect(html).not.toContain("what changed");
    expect(subject).not.toContain("6 upcoming deadlines this week");
    expect(html).toContain("Area a");
    expect(html).toContain("Area b");
    expect(html).toContain("Area c");
  });

  it("never presents incomplete-only data as a confirmed zero-deadline result", () => {
    const incomplete = { ...area("a"), zoneDataIncomplete: true };
    const result = buildDigestSummary([incomplete], TODAY);
    expect(result.incompleteAreas).toHaveLength(1);
    const { html, subject } = buildDigestEmailHtml(null, [incomplete], TODAY);
    expect(subject).not.toMatch(/0 (?:upcoming )?deadlines/);
    expect(html).toContain("could not be verified for this location this week");
    expect(html).not.toMatch(/No deadlines (?:are )?due this week/);
  });

  it("escapes names, event labels, and area labels in grouped output", () => {
    const unsafe = { ...area("a", [deadline(2, "p", '<script>alert("event")</script>')]), areaLabel: "<b>Area & name</b>" };
    const { html } = buildDigestEmailHtml("<img src=x>", [unsafe], TODAY);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Area");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Area &amp; name");
  });
});

describe("November catalog deadline regressions", () => {
  const rollout = ["Stockyards SEQ", "111th/Kedzie", "Little Village East"].map((tifDistrict) => ({
    tifDistrict, windowStart: "2026-11-01", windowEnd: "2026-11-30",
  }));

  it.each([
    ["Stockyards Southeast Quadrant Industrial", "Stockyards SEQ"],
    ["111th Street/Kedzie Avenue Business District", "111th/Kedzie"],
  ])("matches the published SBIF shorthand for %s", (district, expected) => {
    expect(findSbifWindow(rollout, district)?.tifDistrict).toBe(expected);
  });

  it.each(["Stockyards Annex", "Little Village Industrial Corridor"])("does not confuse neighboring %s with an open district", (district) => {
    expect(findSbifWindow(rollout, district)).toBeNull();
  });

  it.each([{ sbifRollout: null }, { sbifRollout: [] }])("flags an unavailable SBIF rollout ($sbifRollout) instead of claiming no deadlines", async ({ sbifRollout }) => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.8,-87.6", areaLabel: "District area" },
      {
        programs: [],
        findTifBoundary: async () => ({ districtId: "T-1", rawDistrictId: "T-1", districtName: "Stockyards Southeast Quadrant Industrial", expirationDate: null, boundaryWards: null }),
        checkZones: async () => ({ schemaVersion: 2, dataRevision: "test", checkedAt: TODAY.toISOString(), requestedLayers: ["tif"], layers: { tif: { state: "matched", name: "District" } } }),
        tifFinancials: null,
        sbifRollout,
      },
      TODAY,
    );
    expect(result?.sbifDataIncomplete).toBe(true);
    expect(result?.notable).toBe(true);
    expect(buildDigestEmailHtml(null, [result!], TODAY).subject).toContain("data incomplete");
  });

  it("uses a known boundary name to resolve SBIF when the financial catalog is unavailable", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.8,-87.6", areaLabel: "Stockyards" },
      {
        programs: [],
        findTifBoundary: async () => ({ districtId: "T-1", rawDistrictId: "T-1", districtName: "Stockyards Southeast Quadrant Industrial", expirationDate: null, boundaryWards: null }),
        checkZones: async () => ({ schemaVersion: 2, dataRevision: "test", checkedAt: TODAY.toISOString(), requestedLayers: ["tif"], layers: { tif: { state: "matched", name: "District" } } }),
        tifFinancials: null,
        sbifRollout: rollout,
      },
      TODAY,
    );
    expect(result?.deadlines.filter((item) => item.kind === "sbif_window")).toHaveLength(1);
    expect(buildDigestSummary([result!], TODAY).planAhead[0].item.date).toBe("2026-11-30");
  });

  it("retains a TIF expiration all day in Chicago rather than rounding elapsed hours", () => {
    const boundary = { districtId: "T-1", rawDistrictId: "T-1", districtName: "District", expirationDate: "2026-11-02", boundaryWards: null };
    expect(assessTifExpiration(boundary, TODAY)?.daysRemaining).toBe(0);
    expect(assessTifExpiration({ ...boundary, expirationDate: "2026-11-03" }, new Date("2026-11-03T02:00:00Z"))?.daysRemaining).toBe(1);
  });

  it("does not normalize Chicago midnight twice before the 90-day cutoff", () => {
    const summary = deadlinesForAddress({
      matchedPrograms: [0, 1, 90, 91].map((days) => ({ id: `p${days}`, name: `Program ${days}`, deadline: deadline(days).date })),
      today: TODAY,
      tifDistrict: null,
      tifFinancials: null,
      sbifRollout: null,
      deadlineWindowDays: 90,
    });
    expect(summary.upcomingProgramDeadlines.map((item) => item.daysFromToday)).toEqual([0, 1, 90]);
  });

  it("retains NSF November 4 and EEC November 6 in the November 2 near-term digest", () => {
    const programs = (catalog as unknown as Program[]).filter((program) =>
      ["nsfSeedFund", "economicEmpowermentCenters"].includes(program.id));
    const events = collectUpcomingDeadlines(programDeadlineSlims(programs), TODAY);
    const result = buildDigestSummary([area("a", events)], TODAY);
    expect(result.dueThisWeek.map((event) => [event.item.programId, event.item.date])).toEqual([
      ["nsfSeedFund", "2026-11-04"],
      ["economicEmpowermentCenters", "2026-11-06"],
    ]);
  });

  it("preserves today's, tomorrow's, and the 90th day's deadlines through assessment and rendering", async () => {
    const programs = [0, 1, 90, 91].map((days) => ({
      id: `program${days}`, name: `Program ${days}`, zoneKey: "tif", summary: "Test", deadline: deadline(days).date,
    })) as unknown as Program[];
    const assessed = await assessWatchedArea(
      { areaType: "point", areaId: "41.8,-87.6", areaLabel: "Test area" },
      {
        programs,
        findTifBoundary: async () => null,
        checkZones: async () => ({ schemaVersion: 2, dataRevision: "test", checkedAt: TODAY.toISOString(), requestedLayers: ["tif"], layers: { tif: { state: "matched", name: "District" } } }),
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );
    expect(assessed?.deadlines.map((item) => item.daysFromToday)).toEqual([0, 1, 90]);
    const result = buildDigestSummary([assessed!], TODAY);
    expect(result.dueThisWeek.map((event) => event.item.daysFromToday)).toEqual([0, 1]);
    expect(result.planAhead.map((event) => event.item.daysFromToday)).toEqual([90]);
    const { html } = buildDigestEmailHtml(null, [assessed!], TODAY);
    expect(html).toContain("2026-11-02 — today");
    expect(html).toContain("2026-11-03 — tomorrow");
  });

  it("does not apply every generic SBIF district-month deadline to one watched district", async () => {
    const programs = [{
      id: "sbif", name: "SBIF", zoneKey: "tif", summary: "District-specific windows",
      deadlines: [
        { label: "November district window closes", date: "2026-11-30" },
        { label: "December district window closes", date: "2026-12-30" },
      ],
    }] as unknown as Program[];
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.8,-87.6", areaLabel: "November district" },
      {
        programs,
        findTifBoundary: async () => ({ districtId: "T-1", rawDistrictId: "T-1", districtName: "November district", expirationDate: null, boundaryWards: null }),
        checkZones: async () => ({ schemaVersion: 2, dataRevision: "test", checkedAt: TODAY.toISOString(), requestedLayers: ["tif"], layers: { tif: { state: "matched", name: "November district" } } }),
        tifFinancials: null,
        sbifRollout: [{ tifDistrict: "T-1", windowStart: "2026-11-01", windowEnd: "2026-11-30" }],
      },
      TODAY,
    );
    expect(result?.deadlines.filter((item) => item.programId === "sbif")).toHaveLength(0);
    const summary = buildDigestSummary([result!], TODAY);
    expect(summary.planAhead.map((event) => event.item.date)).toEqual(["2026-11-30"]);
  });

  it("does not surface SBIF dates belonging to a different district", async () => {
    const programs = [{ id: "sbif", name: "SBIF", zoneKey: "tif", summary: "District-specific windows", deadlines: [{ date: "2026-11-30" }] }] as unknown as Program[];
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.8,-87.6", areaLabel: "Different district" },
      {
        programs,
        findTifBoundary: async () => ({ districtId: "T-999", rawDistrictId: "T-999", districtName: "Different district", expirationDate: null, boundaryWards: null }),
        checkZones: async () => ({ schemaVersion: 2, dataRevision: "test", checkedAt: TODAY.toISOString(), requestedLayers: ["tif"], layers: { tif: { state: "matched", name: "Different district" } } }),
        tifFinancials: null,
        sbifRollout: [{ tifDistrict: "T-1", windowStart: "2026-11-01", windowEnd: "2026-11-30" }],
      },
      TODAY,
    );
    expect(result?.deadlines).toHaveLength(0);
  });
});
