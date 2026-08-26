// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";

const { routerMock } = vi.hoisted(() => ({
  routerMock: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { email: "owner@example.com" } },
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "report-9" }),
  useRouter: () => routerMock,
}));

vi.mock("@/components/report/ReportDisplay", () => ({
  ReportDisplay: ({ report }: { report: { title: string } }) => (
    <output data-testid="rendered-report-title">{report.title}</output>
  ),
}));

import SavedReportPage from "./page";

const savedDrawnAreaScope = createDrawnAreaReportScope({
  name: "79th Corridor — Ward 17",
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-87.71, 41.74],
      [-87.69, 41.74],
      [-87.69, 41.76],
      [-87.71, 41.76],
      [-87.71, 41.74],
    ]],
  },
  generatedAt: "2026-08-26T12:00:00.000Z",
  vacancy: {
    loadFailed: true,
    freshnessFilter: "current_screening",
    licenseFilter: "all",
    returnedCountBeforeFilters: null,
    selectedFeatures: [],
  },
});
if (!savedDrawnAreaScope.ok) throw new Error(savedDrawnAreaScope.detail);

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("Saved report reload", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse({
        report: {
          id: "report-9",
          title: "79th Corridor — Ward 17",
          wizardState: {},
          reportData: {
            schemaVersion: 2,
            title: "Area Analysis Report — Auburn Gresham",
            subtitle: "Drawn-area public-record analysis",
            reportType: "best-location",
            generatedAt: "2026-08-26T12:00:00.000Z",
            summary: "Saved drawn-area report.",
            sections: [{ title: "Area Snapshot", items: [] }],
            recommendedActions: [],
            metadata: { address: "Auburn Gresham" },
            drawnAreaScope: savedDrawnAreaScope.scope,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the authoritative row title instead of the stale snapshot title", async () => {
    render(<SavedReportPage />);

    expect((await screen.findByTestId("rendered-report-title")).textContent).toBe(
      "79th Corridor — Ward 17",
    );
    expect(screen.queryByText("Area Analysis Report — Auburn Gresham")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/saved-reports/report-9");
  });
});
