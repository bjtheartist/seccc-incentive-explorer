import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MajorDevelopments } from "../MajorDevelopments";
import type { MajorDevelopmentsSummary } from "@/lib/investment-analysis";

/**
 * R1 finding 4 — the false-claims class, major-developments section.
 *
 * The finding: `loadMajorDevelopments` returns `{ count: 0, totalAnnounced: 0,
 * developments: [] }` BOTH when the export genuinely holds no megaprojects and
 * when the export could not be loaded at all, so "No major private
 * developments with an announced capital figure are sited in this community" —
 * an authoritative negative finding — must never be published on an outage.
 *
 * The FIRST fix gave this component a `datasetUnavailable` prop and an outage
 * branch, and this file proved the branch worked. It proved nothing about what
 * a reader sees, because the prop was dead: `loadMajorDevelopments` reads the
 * same export as `loadCommunityInvestment`, and both call sites render this
 * component only inside the ELSE arm of a `datasetUnavailable ? … : …`
 * ternary — so it was `false` at every site that read it, and only this file
 * ever set it true. A test whose only subject is an unreachable branch reports
 * coverage the product does not have.
 *
 * So the branch is gone, and the property it was supposed to guarantee is
 * asserted where it is actually decided:
 *   - HERE: the absence sentence is what a LOADED, empty dataset renders, and
 *     real rows still render, so the honest cases are pinned.
 *   - app/investment/page.test.ts and app/investment/[area]/page.test.ts: on
 *     every load failure the page renders its unavailability card and NEITHER
 *     absence sentence — i.e. the outage never reaches this component at all.
 */

const EMPTY: MajorDevelopmentsSummary = { count: 0, totalAnnounced: 0, developments: [] };

const ABSENCE_AREA = "No major private developments with an announced capital figure are sited";
const ABSENCE_CITYWIDE =
  "No major private developments with an announced capital figure are on record";

describe("MajorDevelopments: the absence claim belongs to a LOADED, empty dataset", () => {
  it("states the area-scoped absence when the dataset loaded and this community has none", () => {
    const html = renderToStaticMarkup(<MajorDevelopments summary={EMPTY} scope="area" />);
    expect(html).toContain(ABSENCE_AREA);
    expect(html).not.toContain(ABSENCE_CITYWIDE);
  });

  it("states the citywide-scoped absence when the dataset loaded and holds none", () => {
    const html = renderToStaticMarkup(<MajorDevelopments summary={EMPTY} scope="citywide" />);
    expect(html).toContain(ABSENCE_CITYWIDE);
    expect(html).not.toContain(ABSENCE_AREA);
  });

  it("renders the developments themselves — never the absence claim — when there are some", () => {
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
    const html = renderToStaticMarkup(<MajorDevelopments summary={populated} scope="area" />);
    expect(html).toContain("Fixture Development");
    expect(html).not.toContain(ABSENCE_AREA);
    expect(html).not.toContain(ABSENCE_CITYWIDE);
  });
});
