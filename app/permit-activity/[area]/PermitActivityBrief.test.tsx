// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PermitAreaResult } from "@/lib/permit-area";
import {
  PermitActivityBrief,
  buildPermitBriefCsv,
} from "./PermitActivityBrief";

const GEOMETRY: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-87.65, 41.7],
        [-87.58, 41.7],
        [-87.58, 41.77],
        [-87.65, 41.77],
        [-87.65, 41.7],
      ],
    ],
  ],
};

const RESULT: PermitAreaResult = {
  status: "ready",
  source: {
    label: "City of Chicago Building Permits (ydr8-5enu)",
    url: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data",
    portalUrl: "https://webapps1.chicago.gov/buildingrecords/",
  },
  dataWindow: "Since 2015",
  sourceRefresh: {
    asOf: "2026-08-20T18:22:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 8,
  distinctAddresses: 7,
  issueDateSpan: { first: "2024-01-10", latest: "2026-08-20" },
  typeBreakdown: [
    {
      key: "new_construction",
      label: "New Construction",
      sourceValue: "PERMIT - NEW CONSTRUCTION",
      color: "#059669",
      count: 5,
    },
    {
      key: "signs",
      label: "Signs",
      sourceValue: "PERMIT - SIGNS",
      color: "#D97706",
      count: 3,
    },
  ],
  yearBreakdown: [
    { year: 2026, count: 5 },
    { year: 2024, count: 3 },
  ],
  statusBreakdown: [
    { status: "ACTIVE", count: 5 },
    { status: "COMPLETE", count: 3 },
  ],
  records: [
    {
      permitId: "100012345",
      permitTypeKey: "new_construction",
      permitTypeLabel: "New Construction",
      rawPermitType: "PERMIT - NEW CONSTRUCTION",
      address: "123 S STATE ST",
      issueDate: "2026-08-20",
      permitStatus: "ACTIVE",
      permitMilestone: "PERMIT ISSUED",
      workType: "NEW CONSTRUCTION",
      workDescription: "Construct a two-story commercial building",
    },
  ],
  recordsReturned: 1,
  recordsTruncated: true,
};

function renderBrief() {
  return render(
    <PermitActivityBrief
      area={{ id: 44, name: "Chatham", slug: "chatham" }}
      geometry={GEOMETRY}
      reportDate="August 24, 2026"
    />,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PermitActivityBrief", () => {
  it("renders source-backed counts and keyboard-readable exact chart values", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { container } = renderBrief();
    await screen.findByText("8", { selector: "p" });

    expect(fetch).toHaveBeenCalledWith(
      "/api/permit-area",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ polygon: GEOMETRY }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Permit Activity Analysis · Chatham" })).toBeTruthy();
    expect(screen.getByText("123 S STATE ST")).toBeTruthy();
    expect(screen.getByText(/Recent-record response returned 1 rows and is truncated/)).toBeTruthy();

    const yearMark = screen.getByRole("button", {
      name: "2026, 5 recorded filings",
    });
    fireEvent.focus(yearMark);
    expect(screen.getByText("2026 · 5 recorded filings")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View record" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Permit filing detail" }).hasAttribute("open")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Verify permit records" }));
    expect(screen.getByRole("dialog", { name: "Verify Chicago permit records" }).hasAttribute("open")).toBe(true);

    expect(container.textContent).not.toMatch(/activity score/i);
    expect(container.textContent).not.toContain("$");
  });

  it("keeps a valid zero distinct from source failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...RESULT,
          totalFilings: 0,
          distinctAddresses: 0,
          issueDateSpan: null,
          sourceRefresh: { asOf: null, asOfBasis: null },
          typeBreakdown: [],
          yearBreakdown: [],
          statusBreakdown: [],
          records: [],
          recordsReturned: 0,
          recordsTruncated: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderBrief();
    expect(await screen.findByText(/0 recorded filings in this geocoded source window/)).toBeTruthy();
    expect(screen.queryByText(/Source lookup unavailable/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Filing activity over time" })).toBeNull();
  });

  it("withholds charts and exposes retry for unavailable and malformed responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { unmount } = renderBrief();
    expect(await screen.findByText(/Source lookup unavailable/)).toBeTruthy();
    expect(screen.getByText("Data window Unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry lookup/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Filing activity over time" })).toBeNull();
    unmount();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ready", totalFilings: 9 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderBrief();
    expect(await screen.findByText(/Source response malformed/)).toBeTruthy();
    expect(screen.getByText("Data window Unavailable")).toBeTruthy();
    expect(screen.queryByText(/0 recorded filings in this geocoded source window/)).toBeNull();
  });

  it("exports explicit aggregate and recent-record denominators without a cost field", () => {
    const csv = buildPermitBriefCsv("Chatham", RESULT);
    expect(csv).toContain('"Recorded filings","8"');
    expect(csv).toContain('"Returned recent records","1"');
    expect(csv).toContain('"Recent records truncated","Yes"');
    expect(csv).toContain("Aggregate tables cover 8 matching records");
    expect(csv).not.toMatch(/reported.?cost/i);
    expect(csv).not.toContain("$");
  });
});
