// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { email: "owner@example.com" } },
    status: "authenticated",
  }),
}));

vi.mock("@/components/workspace/PendingReportSaver", () => ({
  PendingReportSaver: () => null,
}));

import WorkspacePage from "./page";

const reports = Array.from({ length: 9 }, (_, index) => {
  const number = index + 1;
  return {
    id: `report-${number}`,
    projectId: null,
    title: `Ward ${number} Report`,
    reportType: "best-location",
    address: "Auburn Gresham",
    lat: null,
    lon: null,
    createdAt: `2026-08-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`,
    updatedAt: `2026-08-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`,
  };
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("Workspace saved report management", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/saved-reports" && !init?.method) {
        return jsonResponse({ reports });
      }
      if (url === "/api/incentive-preparation") return jsonResponse({ packets: [] });
      if (url === "/api/watchlist") return jsonResponse({ areas: [] });
      if (url === "/api/saved-reports/report-9" && init?.method === "PATCH") {
        return jsonResponse({ report: { id: "report-9", title: "Ward 9 Renamed" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows and renames the ninth saved report", async () => {
    render(<WorkspacePage />);

    expect(await screen.findByText("Ward 9 Report")).toBeTruthy();
    const renameButtons = screen.getAllByTitle("Rename report");
    expect(renameButtons).toHaveLength(9);

    fireEvent.click(renameButtons[8]);
    expect(
      screen.getByDisplayValue("Ward 9 Report").getAttribute("maxLength"),
    ).toBe("200");
    fireEvent.change(screen.getByDisplayValue("Ward 9 Report"), {
      target: { value: "  Ward 9 Renamed  " },
    });
    fireEvent.click(screen.getByTitle("Save name"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/saved-reports/report-9" &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
        title: "Ward 9 Renamed",
      });
    });
    expect(await screen.findByText("Ward 9 Renamed")).toBeTruthy();
  });
});
