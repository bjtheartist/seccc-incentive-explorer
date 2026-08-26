// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PERMIT_AREA_ACTIVITY_NOTE, type PermitAreaResult } from "@/lib/permit-area";
import { PermitActivityBrief, buildPermitBriefCsv } from "./PermitActivityBrief";

const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const GEOMETRY: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[
    [-87.65, 41.7],
    [-87.58, 41.7],
    [-87.58, 41.77],
    [-87.65, 41.77],
    [-87.65, 41.7],
  ]]],
};

const AREAS = [
  { id: 8, name: "Near North Side", slug: "near-north-side" },
  { id: 44, name: "Chatham", slug: "chatham" },
  { id: 76, name: "O'Hare", slug: "o-hare" },
];

const MONTHLY_BREAKDOWN = Array.from({ length: 36 }, (_, index) => {
  const month = new Date(Date.UTC(2023, 8 + index, 1)).toISOString().slice(0, 7);
  const countByMonth: Record<string, number> = {
    "2024-01": 2,
    "2025-01": 2,
    "2026-01": 2,
    "2026-08": 2,
  };
  return { month, count: countByMonth[month] ?? 0 };
});

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
  rollingPulse: {
    asOf: "2026-08-20",
    current: {
      start: "2025-08-21",
      end: "2026-08-20",
      filings: 4,
      distinctAddresses: 3,
      addressedFilings: 4,
    },
    previous: {
      start: "2024-08-21",
      end: "2025-08-20",
      filings: 2,
      distinctAddresses: 2,
      addressedFilings: 2,
    },
    changeCount: 2,
    changePercent: 100,
  },
  monthlyBreakdown: MONTHLY_BREAKDOWN,
  topAddresses: [
    { address: "123 S STATE ST", count: 2 },
    { address: "700 E 79TH ST", count: 1 },
  ],
  typeBreakdown: [
    { key: "new_construction", label: "New Construction", sourceValue: "PERMIT - NEW CONSTRUCTION", color: "#059669", count: 5 },
    { key: "signs", label: "Signs", sourceValue: "PERMIT - SIGNS", color: "#D97706", count: 3 },
  ],
  yearBreakdown: [
    { year: 2024, count: 2 },
    { year: 2025, count: 2 },
    { year: 2026, count: 4 },
  ],
  statusBreakdown: [
    { status: "ACTIVE", count: 5 },
    { status: "COMPLETE", count: 3 },
  ],
  records: [{
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
  }],
  recordsReturned: 1,
  recordsTruncated: true,
};

const ZERO_RESULT: PermitAreaResult = {
  ...RESULT,
  sourceRefresh: { asOf: null, asOfBasis: null },
  totalFilings: 0,
  distinctAddresses: 0,
  issueDateSpan: null,
  rollingPulse: {
    asOf: null,
    current: { start: null, end: null, filings: 0, distinctAddresses: 0, addressedFilings: 0 },
    previous: { start: null, end: null, filings: 0, distinctAddresses: 0, addressedFilings: 0 },
    changeCount: 0,
    changePercent: null,
  },
  monthlyBreakdown: [],
  topAddresses: [],
  typeBreakdown: [],
  yearBreakdown: [],
  statusBreakdown: [],
  records: [],
  recordsReturned: 0,
  recordsTruncated: false,
};

function renderBrief() {
  return render(
    <PermitActivityBrief
      area={{ id: 44, name: "Chatham", slug: "chatham" }}
      areas={AREAS}
      geometry={GEOMETRY}
      reportDate="August 24, 2026"
    />,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.removeAttribute("open"); },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PermitActivityBrief", () => {
  it("prioritizes the recent pulse and supports neighborhood command navigation", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    renderBrief();
    expect(await screen.findByText("4", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Permit Activity Analysis · Chatham" })).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("+100.0% vs prior 12 months")).toBeTruthy();
    expect(screen.getByText(/4 geocoded filings were issued during the trailing 12 months/)).toBeTruthy();

    // The site-wide header remains the page's only brand and navigation layer.
    expect(screen.queryByText("Community evidence brief · live public data")).toBeNull();
    expect(screen.queryByText("Chicago Incentive Explorer / Evidence Briefs")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Analysis navigation" })).toBeNull();
    expect(screen.queryByText("Public Investment Analysis")).toBeNull();

    // (a) single meta line carries all four " · " segments, including the
    // report date that used to live only in the command-bar <dl>.
    expect(
      screen.getByText("Area 44 · Chatham · Report date August 24, 2026 · Data window Since 2015"),
    ).toBeTruthy();

    // (b) the restyled right column renders a "Scope statement" aside with
    // PERMIT_AREA_ACTIVITY_NOTE verbatim, and exactly once on the page.
    expect(screen.getByText("Scope statement")).toBeTruthy();
    expect(screen.getByLabelText("Scope statement")).toBeTruthy();
    expect(screen.getAllByText(PERMIT_AREA_ACTIVITY_NOTE)).toHaveLength(1);

    // (c) "Report date" no longer appears as its own row in the command <dl>
    // now that it is folded into the single meta line above.
    expect(screen.queryByText("Report date", { selector: "dt" })).toBeNull();
    expect(screen.getByText("Explorer loaded", { selector: "dt" })).toBeTruthy();

    const selector = screen.getByRole("combobox", { name: "Neighborhood" });
    expect((selector as HTMLSelectElement).value).toBe("chatham");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.change(selector, { target: { value: "o-hare" } });
    expect(mockPush).toHaveBeenCalledWith("/permit-activity/o-hare");
  });

  it("keeps the global site header visible", () => {
    const stylesheet = readFileSync(
      join(process.cwd(), "app/permit-activity/[area]/permit-activity.module.css"),
      "utf8",
    );

    expect(stylesheet).not.toContain("> :global(header)");
    expect(stylesheet).toContain(":global(body):has(.page) > :global(footer)");
  });

  it("renders keyboard-readable monthly, type, and address marks with the evidence ledger", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { container } = renderBrief();
    await screen.findByRole("heading", { name: "Monthly filing activity" });

    expect(fetch).toHaveBeenCalledWith("/api/permit-area", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygon: GEOMETRY }),
    }));

    const monthMark = screen.getByRole("button", { name: "Aug 2026, 2 recorded filings" });
    fireEvent.focus(monthMark);
    expect(screen.getByText("Aug 2026 · 2 recorded filings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "123 S STATE ST, 2 records, 50.0%" })).toBeTruthy();
    expect(screen.getAllByText("123 S STATE ST", { selector: "td" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "View record" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Permit filing detail" }).hasAttribute("open")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Verify permit records" }));
    expect(screen.getByRole("dialog", { name: "Verify Chicago permit records" }).hasAttribute("open")).toBe(true);

    expect(container.textContent).not.toMatch(/activity score/i);
    expect(container.textContent).not.toContain("$");
  });

  it("keeps recorded status and caveats inside an accessible disclosure", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { container } = renderBrief();
    await screen.findByText("About this analysis");
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText("About this analysis"));
    expect(details?.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Recorded status" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Coverage & data quality" })).toBeTruthy();
    expect(screen.getByText(/Status labels do not establish construction progress/)).toBeTruthy();
  });

  it("keeps a valid zero distinct from source failure", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(ZERO_RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    renderBrief();
    expect(await screen.findByText(/0 recorded filings in this geocoded source window/)).toBeTruthy();
    expect(screen.queryByText(/Source lookup unavailable/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Monthly filing activity" })).toBeNull();
    expect(screen.getByText(/source returned a valid zero/)).toBeTruthy();
  });

  it("withholds charts and exposes retry for unavailable and malformed responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { unmount } = renderBrief();
    expect(await screen.findByText(/Source lookup unavailable/)).toBeTruthy();
    expect(screen.getByText(/Data window Unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry lookup/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Monthly filing activity" })).toBeNull();
    unmount();

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready", totalFilings: 9 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    renderBrief();
    expect(await screen.findByText(/Source response malformed/)).toBeTruthy();
    expect(screen.getByText(/Data window Unavailable/)).toBeTruthy();
    expect(screen.queryByText(/0 recorded filings in this geocoded source window/)).toBeNull();
  });

  it("exports rolling windows, monthly counts, concentration, and explicit denominators", () => {
    const csv = buildPermitBriefCsv("Chatham", RESULT);
    expect(csv).toContain('"Recorded filings","8"');
    expect(csv).toContain('"Current 12-month filings","4"');
    expect(csv).toContain('"2026-08","2"');
    expect(csv).toContain('"123 S STATE ST","2"');
    expect(csv).toContain('"Returned recent records","1"');
    expect(csv).toContain('"Recent records truncated","Yes"');
    expect(csv).toContain("Aggregate tables cover 8 matching records");
    expect(csv).not.toMatch(/reported.?cost/i);
    expect(csv).not.toContain("$");
  });

  // Permit History Exhibit cross-link — the ONLY touch this page makes for
  // that feature (spec: "a single entry link from the permit-activity
  // brief's scope aside"). Everything else on this page is untouched.
  it("carries the Permit History Exhibit entry link in the scope aside, alongside PERMIT_AREA_ACTIVITY_NOTE, not replacing it", () => {
    renderBrief();
    const link = screen.getByRole("link", { name: /Build a Permit History Exhibit/ });
    expect(link.getAttribute("href")).toBe("/permit-exhibit");
    // Still exactly once, per the existing pinned assertion above — the new
    // link is a sibling element, not a rewrite of the scope statement.
    expect(screen.getAllByText(PERMIT_AREA_ACTIVITY_NOTE)).toHaveLength(1);
  });
});
