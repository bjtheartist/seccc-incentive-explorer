import { describe, expect, it } from "vitest";
import {
  buildReportEventKey,
  isValidAnalyticsToken,
  normalizeAnalyticsWindow,
  summarizeAnalyticsEvents,
  type AnalyticsEventRow,
} from "../analytics-dashboard";

const generatedAt = "2026-06-16T10:00:00.000Z";

function row(overrides: Partial<AnalyticsEventRow>): AnalyticsEventRow {
  return {
    event_type: "location_snapshot_generated",
    report_type: "site-incentives",
    source: "test",
    address: "3039 E 91st St, Chicago, IL 60617",
    metadata_json: {
      reportKey: "site-incentives|2026-06-16|3039-e-91st",
      reportTitle: "Location Snapshot",
      communityArea: "South Chicago",
      zipCode: "60617",
    },
    created_at: generatedAt,
    ...overrides,
  };
}

describe("analytics dashboard metrics", () => {
  it("dedupes activated reports while counting resource contact actions", () => {
    const summary = summarizeAnalyticsEvents(
      [
        row({ event_type: "search_performed" }),
        row({ event_type: "location_snapshot_requested" }),
        row({ event_type: "location_snapshot_generated" }),
        row({
          event_type: "support_resource_viewed",
          metadata_json: {
            reportKey: "site-incentives|2026-06-16|3039-e-91st",
            communityArea: "South Chicago",
            organizationCount: 3,
          },
        }),
        row({
          event_type: "support_resource_clicked",
          metadata_json: {
            reportKey: "site-incentives|2026-06-16|3039-e-91st",
            communityArea: "South Chicago",
            organizationName: "Claretian Associates",
            contactMethod: "website",
          },
        }),
        row({
          event_type: "report_pdf_downloaded",
          metadata_json: {
            reportKey: "site-incentives|2026-06-16|3039-e-91st",
            communityArea: "South Chicago",
          },
        }),
      ],
      {
        windowDays: 30,
        since: "2026-05-17T10:00:00.000Z",
      }
    );

    expect(summary.totals.reportsGenerated).toBe(1);
    expect(summary.totals.activatedReports).toBe(1);
    expect(summary.totals.activationActions).toBe(2);
    expect(summary.totals.activationRate).toBe(100);
    expect(summary.totals.localResourceConnections).toBe(1);
    expect(summary.totals.connectionOpportunitiesSurfaced).toBe(3);
    expect(summary.totals.resourceConnectionRate).toBe(100);
    expect(summary.topSupportOrganizations).toEqual([
      { label: "Claretian Associates", count: 1 },
    ]);
  });

  it("aggregates daily and weekly site traffic from anonymous sessions", () => {
    const summary = summarizeAnalyticsEvents(
      [
        row({
          event_type: "site_page_viewed",
          address: null,
          metadata_json: {
            path: "/",
            page: "Home",
            sessionId: "visitor-a",
            deviceType: "desktop",
          },
          created_at: "2026-06-15T15:00:00.000Z",
        }),
        row({
          event_type: "site_page_viewed",
          address: null,
          metadata_json: {
            path: "/report",
            page: "Report Flow",
            sessionId: "visitor-a",
            deviceType: "desktop",
          },
          created_at: "2026-06-15T15:05:00.000Z",
        }),
        row({
          event_type: "site_page_viewed",
          address: null,
          metadata_json: {
            path: "/report",
            page: "Report Flow",
            sessionId: "visitor-b",
            deviceType: "mobile",
          },
          created_at: "2026-06-16T15:05:00.000Z",
        }),
      ],
      {
        windowDays: 30,
        since: "2026-05-17T10:00:00.000Z",
      }
    );

    expect(summary.totals.pageViews).toBe(3);
    expect(summary.totals.uniqueVisitorSessions).toBe(2);
    expect(summary.dailyTraffic).toEqual([
      { day: "2026-06-16", pageViews: 1, uniqueVisitorSessions: 1 },
      { day: "2026-06-15", pageViews: 2, uniqueVisitorSessions: 1 },
    ]);
    expect(summary.weeklyTraffic).toEqual([
      { weekStart: "2026-06-15", pageViews: 3, uniqueVisitorSessions: 2 },
    ]);
    expect(summary.topPages).toEqual([
      { label: "Report Flow", count: 2 },
      { label: "Home", count: 1 },
    ]);
    expect(summary.deviceBreakdown).toEqual([
      { label: "desktop", count: 2, percent: 67 },
      { label: "mobile", count: 1, percent: 33 },
    ]);
  });

  it("uses explicit report keys before falling back to address and hour", () => {
    expect(
      buildReportEventKey(
        row({
          metadata_json: { reportKey: "explicit-key" },
        })
      )
    ).toBe("explicit-key");

    expect(
      buildReportEventKey(
        row({
          metadata_json: {},
          created_at: "2026-06-16T10:45:00.000Z",
        })
      )
    ).toBe("3039 e 91st st, chicago, il 60617|site-incentives|2026-06-16T10");
  });

  it("normalizes dashboard access inputs", () => {
    expect(normalizeAnalyticsWindow(0)).toBe(1);
    expect(normalizeAnalyticsWindow(500)).toBe(365);
    expect(normalizeAnalyticsWindow(Number.NaN)).toBe(30);
    expect(isValidAnalyticsToken("secret", "secret")).toBe(true);
    expect(isValidAnalyticsToken(null, "secret")).toBe(false);
    expect(isValidAnalyticsToken("wrong", "secret")).toBe(false);
  });
});
