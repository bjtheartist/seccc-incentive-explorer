// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ProgramsCatalog from "../ProgramsCatalog";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T17:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderCatalog() {
  return render(<ProgramsCatalog initialNowIso="2026-10-09T17:00:00.000Z" />);
}

function cards() {
  return screen.getAllByRole("heading", { level: 2 }).filter((heading) => heading.closest("button")).map((heading) => heading.textContent);
}

describe("Programs discovery through the real catalog", () => {
  it("keeps ongoing SBA lending and current SBIF and CCSA windows discoverable", () => {
    renderCatalog();
    expect(cards()).toContain("Small Business Improvement Fund (SBIF)");
    expect(cards().some((name) => name?.includes("SBA 7(a)"))).toBe(true);
    expect(cards().some((name) => name?.includes("Commercial Corridor"))).toBe(true);
  });

  it("includes all three nonprofit lenders in their filter and printable overview", () => {
    renderCatalog();
    const group = screen.getByRole("group", { name: "Filter programs by government level" });
    fireEvent.click(within(group).getByRole("button", { name: /^Nonprofit \/ CDFI 3/ }));
    const names = cards();
    expect(names.filter((name) => /Kiva|Greenwood|Allies/.test(name ?? ""))).toHaveLength(3);
    const overview = document.querySelector("#cheat-sheet")!;
    expect(within(overview as HTMLElement).getByText(/Kiva Chicago/)).toBeDefined();
    const cityList = Array.from(overview.querySelectorAll("ul")).find((list) => list.textContent?.includes("Community Development Grant"))!;
    expect(cityList.firstElementChild?.textContent).toContain("Community Development Grant — Small");
    const federalList = Array.from(overview.querySelectorAll("ul")).find((list) => list.textContent?.includes("NSF America"))!;
    expect(federalList.lastElementChild?.textContent).toContain("NSF America");
  });

  it("withdraws open/current claims after a published cutoff even when past windows are shown", () => {
    vi.setSystemTime(new Date("2026-11-20T23:00:01Z"));
    render(<ProgramsCatalog initialNowIso="2026-11-20T23:00:01.000Z" />);
    expect(cards().some((name) => name?.includes("Commercial Corridor"))).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /Show inactive programs/ }));
    const button = screen.getByRole("button", { name: /Commercial Corridor Storefront/ });
    expect(within(button).queryByText("Open")).toBeNull();
    expect(within(button).getByText(/published window has passed/)).toBeDefined();
  });
  it("renders CDG first and NSF last among the program cards", () => {
    renderCatalog();
    const names = cards().filter((name) => name !== "How well do you know Chicago incentives?");
    expect(names.slice(0, 3)).toEqual([
      "Community Development Grant — Small (≤ $250K)",
      "Community Development Grant — Medium ($300K – $5M)",
      "Community Development Grant — Large (> $5M)",
    ]);
    expect(names.at(-1)).toBe("NSF America’s Seed Fund (SBIR/STTR)");
  });

  it("searches NSF research and exposes the federal detail link", () => {
    renderCatalog();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "NSF research" } });
    expect(cards()).toContain("NSF America’s Seed Fund (SBIR/STTR)");
    expect(cards()).not.toContain("Community Development Grant — Small (≤ $250K)");
    fireEvent.click(screen.getByRole("button", { name: /NSF America/ }));
    expect(screen.getByRole("link", { name: "View full program details" }).getAttribute("href"))
      .toBe("/programs/nsf-america-s-seed-fund");
  });

  it("surfaces all 15 current DCEO EIT resources under State and supports industry discovery", () => {
    renderCatalog();
    fireEvent.click(within(screen.getByRole("group", { name: "Filter programs by government level" })).getByRole("button", { name: /^State \d+/ }));
    const names = cards();
    for (const name of [
      "Illinois Innovation Venture Fund (INVENT)", "Advantage Illinois (AI)",
      "Illinois Climate Bank Finance Loan Program", "Illinois Angel Investment Tax Credit Program",
      "Illinois New Markets Development Program", "Illinois SBIR/STTR State Matching Program",
      "Illinois Innovation Voucher Program", "Illinois Small Business Development Centers (SBDCs)",
      "Illinois International Trade Centers (ITCs)", "Illinois APEX Accelerators",
      "Clean Energy Contractor Incubator Program", "Clean Energy Primes Contractor Accelerator Program",
      "First Stop Business Information Center (BIC)", "Illinois Regulatory Flexibility Program",
      "Small Business Environmental Assistance Program (SBEAP)",
    ]) expect(names).toContain(name);
    fireEvent.click(screen.getByRole("button", { name: /Tech \/ Software/ }));
    expect(cards()).toContain("Illinois SBIR/STTR State Matching Program");
  });

  it("keeps legacy resources hidden until requested and labels their historical source", () => {
    renderCatalog();
    expect(screen.queryByRole("heading", { name: "Illinois Innovation Venture Fund (IIVF — SSBCI 1.0)" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show inactive programs/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "IIVF" } });
    const button = screen.getByRole("button", { name: /IIVF/ });
    expect(within(button).getByText("Inactive / maintenance only")).toBeDefined();
    fireEvent.click(button);
    expect(screen.getByRole("link", { name: "View historical official source" }).getAttribute("href"))
      .toMatch(/^https:\/\//);
  });
});
