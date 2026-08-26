// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import type { GeneratedReport } from "@/lib/report-engine";
import { normalizeSavedReport } from "@/lib/report-schema";
import { storePendingReport } from "./PendingReportSaver";

describe("storePendingReport", () => {
  afterEach(() => localStorage.clear());

  it("stamps an exact-polygon pending write as schema version 2", () => {
    const created = createDrawnAreaReportScope({
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
    if (!created.ok) throw new Error(created.detail);

    const report: GeneratedReport = {
      title: "Area Analysis Report — 79th Corridor — Ward 6",
      subtitle: "Drawn-area public-record vacancy signals and permit context",
      reportType: "best-location",
      generatedAt: "2026-08-26T14:15:00.000Z",
      summary: "Saved exact-area report.",
      sections: [],
      recommendedActions: [],
      metadata: {},
      drawnAreaScope: created.scope,
    };

    storePendingReport({ reportData: report });

    const pending = JSON.parse(
      localStorage.getItem("csim.pendingReport") as string,
    ) as { reportData: Record<string, unknown> };
    expect(pending.reportData.schemaVersion).toBe(2);

    const normalized = normalizeSavedReport(pending.reportData);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.migrated).toBe(false);
    expect(normalized.report.drawnAreaScope?.scope.type).toBe("polygon");
  });
});
