// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CaseKey, VacancyCaseRecord } from "@/lib/vacancy-cases";

vi.mock("@/components/vacancy/CaseWorkspaceMapIsland", () => ({
  default: () => <div data-testid="case-workspace-map" />,
}));

vi.mock("@/components/vacancy/PermitEvidencePanel", () => ({
  PermitEvidencePanel: () => <div data-testid="permit-evidence-panel" />,
}));

import CaseWorkspace from "@/components/vacancy/CaseWorkspace";

afterEach(cleanup);

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

function renderWorkspace(
  caseKey: CaseKey,
  records: readonly VacancyCaseRecord[],
) {
  return render(
    <CaseWorkspace
      caseKey={caseKey}
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
  it("starts with 15 records and reveals the remaining five on request", () => {
    const records = Array.from({ length: 20 }, (_, index) => record(index + 1));

    renderWorkspace("public-land", records);

    expect(screen.getByRole("heading", { name: "Matching properties" })).toBeTruthy();
    expect(screen.getByText("15 TEST AVE")).toBeTruthy();
    expect(screen.queryByText("16 TEST AVE")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));

    expect(screen.getByText("16 TEST AVE")).toBeTruthy();
    expect(screen.getByText("20 TEST AVE")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it("places CookViewer and Assessor links below the selected address without a second action panel", () => {
    renderWorkspace("title-holder", [
      record(1, {
        pin: SUBJECT_PIN,
        lat: 41.75823,
        lon: -87.55234,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    const addressHeading = screen.getByRole("heading", { name: "1 TEST AVE" });
    const addressBlock = addressHeading.parentElement;
    expect(addressBlock).toBeTruthy();

    const links = within(addressBlock as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(2);
    const cookViewerLink = within(addressBlock as HTMLElement).getByRole("link", {
      name: /CookViewer/,
    });
    const assessorLink = within(addressBlock as HTMLElement).getByRole("link", {
      name: /Cook County Assessor/,
    });
    expect(cookViewerLink.getAttribute("href")).toBe(
      `https://maps.cookcountyil.gov/cookviewer/?pin14=${SUBJECT_PIN14}`,
    );
    expect(assessorLink.getAttribute("href")).toBe(
      `https://www.cookcountyassessoril.gov/pin/${SUBJECT_PIN14}`,
    );
    expect(addressHeading.compareDocumentPosition(cookViewerLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(addressHeading.compareDocumentPosition(assessorLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Check the parcel record" })).toBeNull();
    expect(screen.queryByText("Official property sources")).toBeNull();
    expect(screen.queryByText(/Option [12]/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Clerk|deed history/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /incentive|permit|CommuniData/i })).toBeNull();
    expect(screen.queryByTestId("permit-evidence-panel")).toBeNull();
  });

  it("offers exactly three next analyses for a selected property and scopes permits to its PIN", () => {
    renderWorkspace("property-review", [
      record(1, {
        pin: SUBJECT_PIN,
        lat: 41.75823,
        lon: -87.55234,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /1 TEST AVE/ }));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: /incentive analysis/i }).getAttribute("href"),
    ).toBe("/report?instant=true&lat=41.75823&lon=-87.55234&addr=1%20TEST%20AVE");
    expect(
      screen.getByRole("link", { name: /permit activity/i }).getAttribute("href"),
    ).toBe(`/permit-exhibit/${SUBJECT_PIN14}`);
    expect(
      screen.getByRole("link", { name: /market and community insights/i }).getAttribute("href"),
    ).toBe("https://www.communidata.app/");
    expect(screen.queryByRole("link", { name: /CookViewer|Assessor|Clerk|deed history/i })).toBeNull();
    expect(screen.queryByTestId("permit-evidence-panel")).toBeNull();
  });
});
