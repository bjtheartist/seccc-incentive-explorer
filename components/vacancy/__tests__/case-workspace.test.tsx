// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";

vi.mock("@/components/vacancy/CaseWorkspaceMapIsland", () => ({
  default: ({
    onSelect,
    onCandidateBounds,
  }: {
    onSelect: (id: string) => void;
    onCandidateBounds: (bounds: [number, number, number, number]) => void;
  }) => (
    <div data-testid="case-workspace-map">
      <button type="button" onClick={() => onSelect("record-1")}>
        Select record from map
      </button>
      <button
        type="button"
        onClick={() => onCandidateBounds([-87.6, 41.72, -87.53, 41.78])}
      >
        Move map
      </button>
    </div>
  ),
}));

import CaseWorkspace from "@/components/vacancy/CaseWorkspace";

const scrollIntoView = vi.fn();
const originalMatchMedia = window.matchMedia;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: originalScrollIntoView,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

function record(
  index: number,
  overrides: Partial<VacancyCaseRecord> = {},
): VacancyCaseRecord {
  return {
    id: `record-${index}`,
    address: `${index} TEST AVE`,
    pin: null,
    universe: "land",
    ownerType: "local_private",
    ownerStructure: null,
    ownerGeography: null,
    saleYear: null,
    violation: false,
    squareFeet: null,
    lat: null,
    lon: null,
    ...overrides,
  };
}

const SUBJECT_PIN = "21-32-211-039-0000";
const SUBJECT_PIN14 = "21322110390000";

function renderWorkspace(records: readonly VacancyCaseRecord[]) {
  return render(
    <CaseWorkspace
      zip="60617"
      neighborhood="South Chicago"
      records={records}
      boundary={null}
      centroid={null}
      initialView="list"
      initialUniverse="all"
      initialQuery=""
      initialBounds={null}
    />,
  );
}

describe("CaseWorkspace record disclosure", () => {
  it("keeps map-origin selections on the map while list selections reveal the details", () => {
    const records = [record(1, { lat: 41.75823, lon: -87.55234 })];
    const mapRender = renderWorkspace(records);

    fireEvent.click(screen.getByRole("button", { name: "Select record from map" }));

    expect(screen.getByRole("heading", { name: "1 TEST AVE" })).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();

    mapRender.unmount();
    scrollIntoView.mockClear();
    renderWorkspace(records);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("keeps desktop list selections beside the map until details are requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    renderWorkspace([record(1, { lat: 41.75823, lon: -87.55234 })]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    expect(screen.getByRole("heading", { name: "1 TEST AVE" })).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps narrow-screen map actions in separate vertical bands", () => {
    renderWorkspace([record(1, { lat: 41.75823, lon: -87.55234 })]);

    fireEvent.click(screen.getByRole("button", { name: "Select record from map" }));
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));

    expect(screen.getByTestId("case-workspace-search-area").className).toContain("top-3");
    expect(screen.getByTestId("case-workspace-map-legend").className).toContain("bottom-10");
    expect(screen.getByTestId("case-workspace-selected-action").className).toContain("bottom-24");
  });

  it("starts with 15 records and reveals the remaining five on request", () => {
    const records = Array.from({ length: 20 }, (_, index) => record(index + 1));

    renderWorkspace(records);

    expect(screen.getByRole("heading", { name: "Matching properties" })).toBeTruthy();
    expect(screen.getByText("15 TEST AVE")).toBeTruthy();
    expect(screen.queryByText("16 TEST AVE")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));

    expect(screen.getByText("16 TEST AVE")).toBeTruthy();
    expect(screen.getByText("20 TEST AVE")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it("combines parcel sources and the three analyses in one selected-record panel", () => {
    renderWorkspace([
      record(1, {
        pin: SUBJECT_PIN,
        lat: 41.75823,
        lon: -87.55234,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    const addressHeading = screen.getByRole("heading", { name: "1 TEST AVE" });
    const parcelLink = screen.getByRole("link", { name: /Parcel record/ });
    const assessorLink = screen.getByRole("link", { name: /Assessor record/ });
    const deedLink = screen.getByRole("link", { name: /Deed history/ });
    const incentiveLink = screen.getByRole("link", { name: /incentive analysis/i });
    const permitLink = screen.getByRole("link", { name: /permit activity/i });
    const communiDataLink = screen.getByRole("link", {
      name: /market and community insights/i,
    });

    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(parcelLink.getAttribute("href")).toBe(
      `https://maps.cookcountyil.gov/cookviewer/?pin14=${SUBJECT_PIN14}`,
    );
    expect(assessorLink.getAttribute("href")).toBe(
      `https://www.cookcountyassessoril.gov/pin/${SUBJECT_PIN14}`,
    );
    expect(deedLink.getAttribute("href")).toBe(
      `https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=${SUBJECT_PIN14}`,
    );
    expect(incentiveLink.getAttribute("href")).toBe(
      "/report?instant=true&lat=41.75823&lon=-87.55234&addr=1%20TEST%20AVE",
    );
    expect(permitLink.getAttribute("href")).toBe(`/permit-exhibit/${SUBJECT_PIN14}`);
    expect(communiDataLink.getAttribute("href")).toBe("https://www.communidata.app/");

    const ownerType = screen.getByText("Owner type");
    const analysisHeading = screen.getByRole("heading", { name: "Choose an analysis" });
    expect(addressHeading.compareDocumentPosition(parcelLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ownerType.compareDocumentPosition(analysisHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("case-workspace-selected-record").className).toContain(
      "scroll-mt-24",
    );
  });

  it("lays out the three analysis cards in one row at the tablet+ breakpoint and stacks them below it (vitest mirror of tests/e2e/vacancy-workbench-map.spec.ts's 'one consolidated surface' geometry check, which asserts the SAME cards share one y-position at >=768px and stack with a shared x at mobile — that box-geometry assertion needs a real browser layout engine and stays e2e-only; what a jsdom test CAN pin, and what this asserts, is the single Tailwind class both behaviors actually come from)", () => {
    renderWorkspace([
      record(1, {
        pin: SUBJECT_PIN,
        lat: 41.75823,
        lon: -87.55234,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    // Same selector tests/e2e/vacancy-workbench-map.spec.ts uses via
    // document.querySelectorAll('[aria-labelledby="record-analysis-actions"] .grid > *')
    // to read back the three cards' rendered boxes.
    const grid = document.querySelector('[aria-labelledby="record-analysis-actions"] .grid');
    expect(grid).not.toBeNull();
    // Base (mobile, <768px): implicit single column — Tailwind's bare
    // `grid` sets one column per row unless overridden by a breakpoint
    // variant, which is exactly what makes the mobile e2e case stack the
    // three cards with a shared x. `md:grid-cols-3` is the breakpoint
    // variant that switches them into one row at >=768px — the desktop
    // e2e case's shared-y assertion. If either class is dropped, that
    // breakpoint's e2e layout check regresses.
    expect(grid!.className).toContain("grid");
    expect(grid!.className).toContain("md:grid-cols-3");
    expect(grid!.children).toHaveLength(3);
  });

  it("disables coordinate- and PIN-dependent analyses without creating broken links", () => {
    renderWorkspace([record(1)]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /market and community insights/i }).getAttribute("href"),
    ).toBe("https://www.communidata.app/");
    expect(screen.queryByRole("link", { name: /Parcel|Assessor|Deed|incentive|permit/i })).toBeNull();
    expect(screen.getAllByText("Unavailable for this record")).toHaveLength(2);
  });
});
