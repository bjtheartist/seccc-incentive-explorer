import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Contract for the restored /check surface.
 *
 * Rendered with renderToStaticMarkup, so effects never run: what these assert
 * is FIRST PAINT — which is exactly where the load-bearing promises live. The
 * page must never dead-end, must never claim an absence of coverage before the
 * zone lookup has answered, and must always carry the same point into /report.
 *
 * The zone and site-activity payloads themselves are covered by
 * lib/__tests__/vacancy-site-zones.test.ts and lib/__tests__/site-activity.test.ts.
 */

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { QuickCheckClient } from "../QuickCheckClient";
import { InlineCrossLinkBanner } from "@/components/report/CrossLinkBanner";

function render(query = "") {
  nav.params = new URLSearchParams(query);
  return renderToStaticMarkup(<QuickCheckClient />);
}

/** The canonical resolved-point query the nav and deep links produce. */
const RESOLVED = "lat=41.74400&lon=-87.57750&address=9133+S+Stony+Island+Ave";

describe("/check — no resolvable params", () => {
  const html = render();

  it("shows the address entry state instead of dead-ending", () => {
    expect(html).toContain('data-testid="quick-check-address-entry"');
    expect(html).toContain('id="quick-check-address"');
    expect(html).not.toContain('data-testid="quick-check-results"');
  });

  it("falls back to entry for a half-specified point", () => {
    expect(render("lat=41.744")).toContain(
      'data-testid="quick-check-address-entry"',
    );
    expect(render("lat=abc&lon=def")).toContain(
      'data-testid="quick-check-address-entry"',
    );
  });

  it("falls back to entry for a point outside Chicago", () => {
    // Null Island and a Los Angeles point both resolve as numbers; neither can
    // produce a meaningful answer from Chicago-only layers.
    expect(render("lat=0&lon=0")).toContain(
      'data-testid="quick-check-address-entry"',
    );
    expect(render("lat=34.05&lon=-118.24")).toContain(
      'data-testid="quick-check-address-entry"',
    );
  });

  it("uses neutral review language instead of making qualification claims", () => {
    expect(html).toContain("a program-by-program review");
    expect(html).not.toMatch(/may (?:actually )?qualify|eligibility survey/i);
  });
});

describe("/check — resolved point", () => {
  const html = render(RESOLVED);

  it("renders results, not the entry form", () => {
    expect(html).toContain('data-testid="quick-check-results"');
    expect(html).not.toContain('data-testid="quick-check-address-entry"');
  });

  it("echoes the address and the point it resolved", () => {
    expect(html).toContain("9133 S Stony Island Ave");
    expect(html).toContain("41.74400");
    expect(html).toContain("-87.57750");
  });

  it("renders the zone panel and the site activity card slot", () => {
    expect(html).toContain('data-testid="quick-check-zones"');
    expect(html).toContain("Mapped incentive geographies");
    // SiteActivityCard renders null until its fetch resolves, so first paint
    // carries no site-activity node — the card must not be inlined or forked.
    expect(html).not.toContain('data-testid="site-activity-card"');
  });

  it("never claims an absence of coverage before the lookup answers", () => {
    expect(html).toContain("Checking mapped geographies at this point…");
    expect(html).not.toContain("Not inside a mapped incentive geography");
  });

  it("labels zone coverage as coverage, never as eligibility", () => {
    expect(html).toContain("Coverage — not eligibility");
    expect(html).toContain("requirements to verify");
    expect(html).not.toMatch(/may (?:actually )?qualify|eligibility survey/i);
  });
});

describe("/check — Generate Full Report CTA", () => {
  /** The CTA's href, decoded back into the params /report will read. */
  function ctaParams(query: string) {
    const html = render(query);
    const cta =
      html.match(/<a[^>]*data-testid="quick-check-report-cta"[^>]*>/)?.[0] ?? "";
    const href = (cta.match(/href="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&");
    expect(href.startsWith("/report?")).toBe(true);
    return new URLSearchParams(href.slice("/report?".length));
  }

  it("carries the same point into the instant report", () => {
    const params = ctaParams(RESOLVED);
    expect(params.get("instant")).toBe("true");
    expect(params.get("lat")).toBe("41.74400");
    expect(params.get("lon")).toBe("-87.57750");
    expect(params.get("addr")).toBe("9133 S Stony Island Ave");
  });

  it("attributes the report back to /check", () => {
    expect(ctaParams(RESOLVED).get("src")).toBe("/check");
  });

  it("passes wizard context through untouched", () => {
    const params = ctaParams(`${RESOLVED}&sector=retail&sa=eyJhIjoxfQ%3D%3D`);
    expect(params.get("sector")).toBe("retail");
    expect(params.get("sa")).toBe("eyJhIjoxfQ==");
  });

  it("renders as a prominent primary action", () => {
    const html = render(RESOLVED);
    const cta =
      html.match(/<a[^>]*data-testid="quick-check-report-cta"[^>]*>/)?.[0] ?? "";
    expect(cta).toContain("bg-[#2563EB]");
    expect(cta).toContain("text-white");
    expect(html).toContain("Generate Full Report →");
  });
});

describe("/check — legacy deep links", () => {
  it("accepts the short addr= spelling encodeCheckState emits", () => {
    const html = render("lat=41.74400&lon=-87.57750&addr=2404+E+79th+St");
    expect(html).toContain('data-testid="quick-check-results"');
    expect(html).toContain("2404 E 79th St");
  });
});

// /check no longer mounts a cross-link banner at all: its only hand-offs
// were the sunset vacant-sites and program-fit-questions links (owner's
// ruling — the product boundary is discovery, not compliance), and it never
// had the report's neighborhood-investment-activity hand-off to fall back
// to. See components/report/CrossLinkBanner.tsx and
// components/check/QuickCheckClient.tsx.
describe("InlineCrossLinkBanner — investment-activity hand-off (shared component, mounted on /report)", () => {
  it("routes to neighborhood investment activity, and no longer offers vacant sites or program fit questions", () => {
    const banner = renderToStaticMarkup(<InlineCrossLinkBanner />);
    expect(banner).toContain('href="/investment"');
    expect(banner).toContain("See neighborhood investment activity");
    expect(banner).not.toContain('href="/qualify"');
    expect(banner).not.toContain('href="/vacancy"');
  });

  it("gate finding F5: renders as the primary (blue button) treatment now that it is the card's only action, not the old secondary micro-link", () => {
    const banner = renderToStaticMarkup(<InlineCrossLinkBanner />);
    const link = banner.match(/<a[^>]*href="\/investment"[^>]*>/)?.[0] ?? "";
    expect(link).toContain("bg-[#2563EB]");
    expect(link).toContain("text-white");
    expect(link).not.toContain("underline-offset-4");
  });
});
