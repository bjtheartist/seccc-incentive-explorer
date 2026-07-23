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
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VacancySubNav } from "../VacancySubNav";
import { Header } from "@/components/layout/Header";

describe("VacancySubNav — four views", () => {
  it("renders all four tabs with the correct per-ZIP hrefs", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="overview" />);
    expect(html).toContain('href="/vacancy/60617"'); // Overview
    expect(html).toContain('href="/vacancy/60617/areas"'); // Opportunity Areas
    expect(html).toContain('href="/vacancy/60617/map"'); // Property Map
    expect(html).toContain('href="/vacancy/60617/directory"'); // All Properties
    for (const label of ["Overview", "Opportunity Areas", "Property Map", "All Properties"]) {
      expect(html).toContain(label);
    }
  });

  it("preserves the active view when switching neighborhoods", () => {
    const html = renderToStaticMarkup(<VacancySubNav zip="60617" active="areas" />);
    // The switcher for another pilot ZIP keeps the areas view.
    expect(html).toContain('href="/vacancy/60619/areas"');
    expect(html).toContain('href="/vacancy/60636/areas"');
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
