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

import { VacancySubNav } from "../VacancySubNav";
import { Header } from "@/components/layout/Header";

describe("VacancySubNav — five views", () => {
  it("renders all five tabs with the correct per-ZIP hrefs", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="workbench" />);
    expect(html).toContain('href="/vacancy/60617"'); // Workbench (ZIP root)
    expect(html).toContain('href="/vacancy/60617/report"'); // Report
    expect(html).toContain('href="/vacancy/60617/areas"'); // Opportunity Areas
    expect(html).toContain('href="/vacancy/60617/map"'); // Property Map
    expect(html).toContain('href="/vacancy/60617/directory"'); // All Properties
    // The retired standalone Case Workbench route is gone.
    expect(html).not.toContain('href="/vacancy/60617/cases"');
    for (const label of [
      "Workbench",
      "Report",
      "Opportunity Areas",
      "Property Map",
      "All Properties",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("preserves the active view when switching neighborhoods", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="areas" />);
    // The switcher for another pilot ZIP keeps the areas view.
    expect(html).toContain('href="/vacancy/60619/areas"');
    expect(html).toContain('href="/vacancy/60636/areas"');
  });

  it("preserves the active view when the Report tab is active", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="report" />);
    expect(html).toContain('href="/vacancy/60619/report"');
    expect(html).toContain('aria-current="page"');
  });

  it("hides the desktop pill row on mobile and shows the NeighborhoodSelect dropdown instead", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="workbench" />);
    // Desktop pill row: hidden by default, shown from md.
    expect(html).toMatch(/class="mb-4 hidden flex-wrap gap-1\.5 md:flex"/);
    // Mobile select: a labeled <select> listing all nine pilot ZIPs.
    expect(html).toContain('aria-label="Neighborhood"');
    expect(html).toContain("<select");
    expect(html).toContain('value="60617"');
    for (const zip of ["60617", "60619", "60649", "60624", "60623", "60644", "60651", "60621", "60636"]) {
      expect(html).toContain(`<option`);
      expect(html).toMatch(new RegExp(`value="${zip}"`));
    }
  });
});

describe("Global nav", () => {
  it("labels the incentive map and adds a Vacant Sites entry", () => {
    const html = renderToStaticMarkup(<Header />);
    expect(html).toContain("Incentive Map");
    expect(html).toContain("Vacant Sites");
    expect(html).toContain('href="/vacancy"');
    // The bare "Map" label is gone (renamed to "Incentive Map").
    expect(html).not.toMatch(/>\s*Map\s*</);
  });
});
