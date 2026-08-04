import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Guard for the approved Set-A global navigation: three dropdown groups plus a
 * pinned primary CTA, with the logo carrying the home link. Asserts the
 * load-bearing contract — verbatim labels, every approved href, the primary
 * treatment on Generate Report, and the disclosure ARIA wiring — not the
 * private layout classes.
 *
 * Rendered with renderToStaticMarkup, so effects never run: the desktop panels
 * are always in the markup (hidden with `invisible` until opened) and the
 * mobile drawer, a Radix portal, is not.
 */

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated" }),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { Header } from "../Header";

function render(pathname = "/") {
  nav.pathname = pathname;
  return renderToStaticMarkup(<Header />);
}

/** Every approved destination, keyed by its approved label. */
const APPROVED_ITEMS: Array<[label: string, href: string]> = [
  ["Quick Address Check", "/check"],
  ["Eligibility Survey", "/qualify"],
  ["Program Directory", "/programs"],
  ["FAQ", "/faq"],
  ["Vacant Sites", "/vacancy"],
  ["Site Matchmaker", "/locate"],
  ["Incentive Map", "/map"],
  ["Community Investment", "/investment"],
  ["Corridor Signals", "/corridors"],
];

describe("Header — approved Set-A structure", () => {
  const html = render("/");

  it("renders the three approved group labels", () => {
    for (const label of ["Check Eligibility", "Find a Site", "Community Insights"]) {
      expect(html).toContain(label);
    }
  });

  it.each(APPROVED_ITEMS)("links %s to %s", (label, href) => {
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain(label);
  });

  it("keeps the logo as the home link and drops the Home nav item", () => {
    expect(html).toContain('href="/"');
    expect(html).toContain("Chicago Incentive Explorer");
    expect(html).not.toMatch(/>\s*Home\s*</);
  });

  it("never links the index-less /neighborhoods route", () => {
    expect(html).not.toContain('href="/neighborhoods"');
    // Community Insights carries exactly two entries.
    expect(html).toContain('href="/investment"');
    expect(html).toContain('href="/corridors"');
  });

  it("exposes every approved item as a menu item, and no others", () => {
    expect(html.match(/role="menu"/g) ?? []).toHaveLength(3);
    expect(html.match(/role="menuitem"/g) ?? []).toHaveLength(APPROVED_ITEMS.length);
  });
});

describe("Header — Generate Report primary CTA", () => {
  const html = render("/");
  const cta = html.match(/<a[^>]*href="\/report"[^>]*>/)?.[0] ?? "";

  it("keeps its href and primary treatment", () => {
    expect(cta).not.toBe("");
    expect(cta).toContain("bg-[#2563EB]");
    expect(cta).toContain("text-white");
    expect(html).toContain("Generate Report");
  });

  it("is not swallowed into a dropdown group", () => {
    expect(cta).not.toContain('role="menuitem"');
  });

  it("takes the active ring on /report", () => {
    const active = render("/report").match(/<a[^>]*href="\/report"[^>]*>/)?.[0] ?? "";
    expect(active).toContain("ring-2");
    expect(active).toContain("ring-[#2563EB]/30");
  });
});

describe("Header — dropdown ARIA wiring", () => {
  const html = render("/");

  it("marks each trigger as a collapsed popup owner", () => {
    expect(html.match(/aria-haspopup="true"/g) ?? []).toHaveLength(3);
    for (const id of ["eligibility", "site", "data"]) {
      const trigger = html.match(new RegExp(`<button[^>]*id="nav-trigger-${id}"[^>]*>`))?.[0] ?? "";
      expect(trigger).toContain('aria-haspopup="true"');
      expect(trigger).toContain('aria-expanded="false"');
    }
    // Nothing in the header ships expanded on first paint.
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("points every trigger at the panel it controls", () => {
    for (const id of ["eligibility", "site", "data"]) {
      expect(html).toContain(`id="nav-trigger-${id}"`);
      expect(html).toContain(`aria-controls="nav-panel-${id}"`);
      expect(html).toContain(`id="nav-panel-${id}"`);
      expect(html).toContain(`aria-labelledby="nav-trigger-${id}"`);
    }
  });

  it("keeps closed panels out of the tab order", () => {
    // visibility:hidden, so the links stay crawlable but are not focusable.
    expect(html.match(/invisible/g) ?? []).toHaveLength(3);
  });
});

describe("Header — active group indicator", () => {
  it("highlights the group owning the current route", () => {
    const html = render("/programs");
    const trigger =
      html.match(/<button[^>]*id="nav-trigger-eligibility"[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain("ring-2");
    expect(trigger).toContain("ring-[#2563EB]/30");
  });

  it("highlights on a nested member route", () => {
    const html = render("/vacancy/60617/areas");
    const site = html.match(/<button[^>]*id="nav-trigger-site"[^>]*>/)?.[0] ?? "";
    const data = html.match(/<button[^>]*id="nav-trigger-data"[^>]*>/)?.[0] ?? "";
    expect(site).toContain("ring-[#2563EB]/30");
    expect(data).not.toContain("ring-[#2563EB]/30");
  });

  it("highlights nothing on the home route", () => {
    const html = render("/");
    expect(html).not.toContain("ring-[#2563EB]/30");
  });
});
