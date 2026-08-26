import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import { normalizeSavedReport, CURRENT_REPORT_SCHEMA_VERSION } from "@/lib/report-schema";

/**
 * The save route is the only writer of `saved_reports.report_data_json`, so it
 * is the only place the persisted-shape version can be stamped. These tests
 * capture the JSON the route actually hands the database and feed it back
 * through the load-path normalizer — the round trip is the contract, not the
 * stamping call on its own.
 */

const captured: { reportJson?: string } = {};

vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: async () => "user-1",
}));

vi.mock("@/lib/db", () => ({
  getSQL: () => {
    // Tagged-template stub: records the report JSON on the INSERT into
    // saved_reports and returns the row shape each query site expects.
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("INSERT INTO business_projects")) {
        return [{ id: "project-1" }];
      }
      if (text.includes("INSERT INTO saved_reports")) {
        // report_data_json is the last interpolated value before RETURNING.
        captured.reportJson = values[8] as string;
        return [
          {
            id: "report-1",
            project_id: "project-1",
            title: "Incentive Report",
            report_type: "site-incentives",
            address: null,
            lat: null,
            lon: null,
            created_at: "2026-08-11T00:00:00.000Z",
            updated_at: "2026-08-11T00:00:00.000Z",
          },
        ];
      }
      return [];
    };
    return sql;
  },
}));

const { POST } = await import("./route");

function saveRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/saved-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reportBody(reportData: unknown) {
  return { goalType: "improve-storefront", reportData, wizardState: {} };
}

const REPORT = {
  title: "Incentive Report",
  subtitle: "1234 S Halsted St",
  reportType: "site-incentives",
  generatedAt: "2026-08-11T00:00:00.000Z",
  summary: "Two programs mapped.",
  sections: [{ title: "Programs Mapped at This Address", items: [] }],
  recommendedActions: [],
  metadata: { address: "1234 S Halsted St" },
};

function exactAreaReport() {
  const scope = createDrawnAreaReportScope({
    name: "79th Corridor — Ward 6",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-87.63, 41.75],
        [-87.61, 41.75],
        [-87.61, 41.76],
        [-87.63, 41.76],
        [-87.63, 41.75],
      ]],
    },
    generatedAt: "2026-08-26T14:15:00.000Z",
    vacancy: {
      loadFailed: true,
      freshnessFilter: "current_screening",
      licenseFilter: "all",
      returnedCountBeforeFilters: null,
      selectedFeatures: [],
    },
  });
  if (!scope.ok) throw new Error(scope.detail);
  return {
    ...REPORT,
    title: "Area Analysis Report — 79th Corridor — Ward 6",
    subtitle: "Drawn-area public-record vacancy signals and permit context",
    reportType: "best-location",
    drawnAreaScope: scope.scope,
  };
}

describe("POST /api/saved-reports", () => {
  beforeEach(() => {
    delete captured.reportJson;
  });

  it("stamps the current schema version onto the persisted JSON", async () => {
    const res = await POST(saveRequest(reportBody(REPORT)));

    expect(res.status).toBe(201);
    expect(captured.reportJson).toBeDefined();
    const stored = JSON.parse(captured.reportJson as string);
    expect(stored.schemaVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
  });

  it("stamps a new exact-polygon report as schema version 2", async () => {
    const res = await POST(saveRequest(reportBody(exactAreaReport())));

    expect(res.status).toBe(201);
    const stored = JSON.parse(captured.reportJson as string);
    expect(stored.schemaVersion).toBe(2);
    expect(stored.drawnAreaScope.scope.type).toBe("polygon");
  });

  it("overwrites a schemaVersion the client tried to supply", async () => {
    await POST(saveRequest(reportBody({ ...REPORT, schemaVersion: 999 })));

    const stored = JSON.parse(captured.reportJson as string);
    expect(stored.schemaVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
  });

  it("writes JSON the load path can normalize without migration", async () => {
    await POST(saveRequest(reportBody(REPORT)));

    const result = normalizeSavedReport(JSON.parse(captured.reportJson as string));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(false);
    expect(result.report.title).toBe("Incentive Report");
  });

  it("still rejects a non-object reportData", async () => {
    const res = await POST(saveRequest(reportBody("not a report")));
    expect(res.status).toBe(400);
  });

  it("rejects an array reportData rather than stamping it", async () => {
    const res = await POST(saveRequest(reportBody([REPORT])));
    expect(res.status).toBe(400);
  });
});
