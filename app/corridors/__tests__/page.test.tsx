// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CorridorIntelligencePage from "../page";

afterEach(cleanup);

describe("Corridor Intelligence page", () => {
  it("renders all eight requested street scopes with their boundary decisions", () => {
    const { container } = render(<CorridorIntelligencePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Corridor Intelligence");
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(8);
    for (const name of ["79th Street", "South Chicago Avenue", "87th Street", "95th Street", "Stony Island Avenue", "Commercial Avenue", "Ewing Avenue", "106th Street"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    const commercial = container.querySelector("#commercial-avenue")!;
    expect(commercial.textContent).toContain("2–3 blocks east/west where commercially zoned");
    expect(commercial.textContent).toContain("exact side-street extent");
    expect(container.querySelector('[id="79th-street"]')?.textContent).toContain("Greenwood–Paxton");
    for (const detail of details) {
      expect(detail.querySelector("summary")).toBeTruthy();
      expect(detail.textContent).toContain("Polygon not approved");
      expect(detail.textContent).toContain("not yet measured");
    }
  });

  it("distinguishes draft scopes and proposed measures from measured or automated results", () => {
    render(<CorridorIntelligencePage />);
    const status = screen.getByRole("complementary", { name: "Baseline not yet measured" });
    expect(status.textContent).toContain("whole ZIP codes");
    expect(status.textContent).toContain("no current street-level results");
    const measures = screen.getByRole("region", { name: "A practical starting scorecard" });
    expect(within(measures).getAllByRole("listitem")).toHaveLength(6);
    expect(measures.textContent).toContain("vacant-class parcels are a separate measure");
    expect(measures.textContent).toContain("Keep closed and unknown cases visible");
    expect(screen.getByText(/does not generate a measured report or schedule a refresh/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull();
  });

  it("provides working section anchors and existing analysis destinations", () => {
    const { container } = render(<CorridorIntelligencePage />);
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(container.querySelector(anchor.getAttribute("href")!)).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Explore the incentive map" }).getAttribute("href")).toBe("/map");
    expect(screen.getByRole("link", { name: "Explore neighborhood permit activity" }).getAttribute("href")).toBe("/permit-activity");
  });
});
