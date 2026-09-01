import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MajorDevelopments } from "../MajorDevelopments";
import type { MajorDevelopmentsSummary } from "@/lib/investment-analysis";

/**
 * R1 finding 4 — the false-claims class, major-developments section.
 *
 * `loadMajorDevelopments` returns `{ count: 0, totalAnnounced: 0,
 * developments: [] }` BOTH when the export genuinely holds no megaprojects
 * and when the export could not be loaded at all. A zero count therefore
 * proves nothing on its own — yet this section rendered "No major private
 * developments with an announced capital figure are sited in this community",
 * an authoritative negative finding, for both. The caller now tells the
 * component how the load actually went.
 */

const EMPTY: MajorDevelopmentsSummary = { count: 0, totalAnnounced: 0, developments: [] };

const ABSENCE_AREA = "No major private developments with an announced capital figure are sited";
const ABSENCE_CITYWIDE = "No major private developments with an announced capital figure are on record";

describe("MajorDevelopments: a dataset outage is never an absence claim", () => {
  for (const scope of ["area", "citywide"] as const) {
    it(`renders the unavailability state for scope "${scope}", never the absence claim`, () => {
      const html = renderToStaticMarkup(
        <MajorDevelopments summary={EMPTY} scope={scope} datasetUnavailable />,
      );

      expect(html).toContain("temporarily unavailable");
      expect(html).toContain("does not report whether any are on record");
      expect(html).not.toContain(ABSENCE_AREA);
      expect(html).not.toContain(ABSENCE_CITYWIDE);
    });
  }

  it("keeps the genuine absence claim when the dataset LOADED and holds nothing", () => {
    const html = renderToStaticMarkup(<MajorDevelopments summary={EMPTY} scope="area" />);
    expect(html).toContain(ABSENCE_AREA);
    expect(html).not.toContain("temporarily unavailable");
  });

  it("an outage wins over a populated summary — it never renders stale figures as current", () => {
    const populated: MajorDevelopmentsSummary = {
      count: 1,
      totalAnnounced: 12_000_000,
      developments: [
        {
          recipient: "Fixture Development",
          announcedInvestment: 12_000_000,
          status: "announced",
          year: 2024,
          funderName: "Fixture Funder",
          logLine: "",
          sourceLink: "",
        } as MajorDevelopmentsSummary["developments"][number],
      ],
    };
    const html = renderToStaticMarkup(
      <MajorDevelopments summary={populated} scope="area" datasetUnavailable />,
    );
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("Fixture Development");
  });
});
