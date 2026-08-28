import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Keep the client-only PDF button out of the server render.
vi.mock("@/components/owner-file/VacancyIndexPdfButton", () => ({
  VacancyIndexPdfButton: () => null,
}));
// Header is a client component: stub next-auth + routing hooks.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated" }),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { hrefFor, VacancySubNav } from "../VacancySubNav";
import { Header } from "@/components/layout/Header";

describe("VacancySubNav — three primary views", () => {
  it("renders only Find Sites, Report, and Map in the primary navigation", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="workbench" />);
    expect(html).toContain('href="/vacancy/60617"'); // Find Sites (ZIP root)
    expect(html).toContain('href="/vacancy/60617/report"'); // Report
    expect(html).toContain('href="/vacancy/60617/map"'); // Map
    // The retired standalone Case Workbench route is gone.
    expect(html).not.toContain('href="/vacancy/60617/cases"');
    for (const label of ["Find Sites", "Report", "Map"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain(">Workbench</a>");
    expect(html).not.toContain(">All Properties</a>");
    expect(html).not.toContain(">Opportunity Areas</a>");
    expect(html).not.toContain(">Properties</a>");
    expect(html).not.toContain(">Areas</a>");

    const tabOrder = ["Find Sites", "Report", "Map"];
    let previousIndex = -1;
    for (const label of tabOrder) {
      const index = html.indexOf(`>${label}</a>`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("keeps stable per-ZIP destinations for the neighborhood switcher", () => {
    expect(hrefFor("workbench", "60619")).toBe("/vacancy/60619");
    expect(hrefFor("report", "60619")).toBe("/vacancy/60619/report");
    expect(hrefFor("directory", "60619")).toBe("/vacancy/60619/directory");
    expect(hrefFor("map", "60619")).toBe("/vacancy/60619/map");
    expect(hrefFor("areas", "60619")).toBe("/vacancy/60619/areas");
  });

  it("preserves the active view when the Report tab is active", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="report" />);
    expect(hrefFor("report", "60636")).toBe("/vacancy/60636/report");
    expect(html).toContain('aria-current="page"');
  });

  it("uses exactly one labeled neighborhood select at every viewport", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="workbench" />);
    expect(html.match(/<select/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Neighborhood"');
    expect(html).toContain('value="60617"');
    expect(html).not.toContain("hidden flex-wrap gap-1.5 md:flex");
    for (const zip of ["60617", "60619", "60649", "60624", "60623", "60644", "60651", "60621", "60636"]) {
      expect(html).toMatch(new RegExp(`value="${zip}"`));
    }
  });
});

describe("Global nav", () => {
  // Vacant Sites and the Incentive Map now live under the approved "Find a Site"
  // group. Full Set-A coverage lives in components/layout/__tests__.
  it("keeps Vacant Sites reachable from the Find a Site group", () => {
    const html = renderToStaticMarkup(<Header />);
    expect(html).toContain("Find a Site");
    expect(html).toContain("Incentive Map");
    expect(html).toContain("Vacant Sites");
    expect(html).toContain('href="/vacancy"');
    // The bare "Map" label is gone (renamed to "Incentive Map").
    expect(html).not.toMatch(/>\s*Map\s*</);
  });
});
