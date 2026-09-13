import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DecoratedShortlistCandidate } from "@/lib/shortlist-engine";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/shortlist-access", async (original) => ({ ...await original<object>(), hasValidShortlistAccessSession: () => true }));
vi.mock("@/components/vacancy/SiteShortlistResults", () => ({ default: ({ ranked }: { ranked: DecoratedShortlistCandidate[] }) => <div data-testid="ordinary-results">{ranked.map((r) => <p key={r.key}>{r.address} | {r.screeningEvidence?.recordedType}</p>)}</div> }));
vi.mock("@/components/vacancy/ShortlistFunnelEvent", () => ({ default: () => null }));
import Page from "../page";
async function render(patch: Record<string, string> = {}) {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ zip: "60617" }), searchParams: Promise.resolve({ sm_v: "2", sm_use: "retail-service", sm_property: "existing-building", sm_building_types: "commercial", sm_zoning: "aligned", ...patch }) }));
}
describe("refined shortlist page with actual committed screening data", () => {
  it("renders commercial matches while excluding the frozen residential counterexamples", async () => {
    const html = await render();
    expect(html).toContain("3100 E 92ND ST | commercial");
    expect(html).not.toContain("9513 S OGLESBY AVE");
    expect(html).not.toContain("8100 S BRANDON AVE");
    expect(html).toContain("Evidence coverage across this ZIP");
    expect(html).toContain("Needs verification");
  });
  it("renders housing without presenting the commercial counterexample as a home", async () => {
    const html = await render({ sm_use: "housing-mixed-use", sm_building_types: "house" });
    expect(html).toContain("| house");
    expect(html).not.toContain("3100 E 92ND ST");
  });
  it("shows missing available-space evidence rather than asserting no suitable properties exist", async () => {
    const html = await render({ sm_min_sqft: "1000", sm_area_basis: "available-interior" });
    expect(html).toContain("More evidence is needed");
    expect(html).toContain("No records passed every evaluated requirement");
    expect(html).toContain("Unknown requested measurements are not replaced by a different area type");
  });
});
