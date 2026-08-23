import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import { ReasonChips } from "@/components/report/ReasonChips";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import type { ReportItem } from "@/lib/report-engine";

/**
 * Gate round 3, BLOCKER 11 RULING: the reviewer flagged that
 * lib/__tests__/refine-tier1.test.ts's "in board order" test only ever
 * did a SOURCE-GREP check — it confirms the three components
 * (ProgramCardFace, ReasonChips, ProgramCardExtras) are MOUNTED in that
 * order in both forks' source text, which is real and worth keeping, but
 * it cannot and does not prove the fine-grained board order WITHIN each
 * component (cost signals before "What it funds" before "Commonly
 * required" inside Face; "Can combine with" before next-step before
 * "What to expect" before "Verify at the source" inside Extras). That
 * test's name was demoted to describe exactly what it checks — mount
 * order, not full board order — see refine-tier1.test.ts.
 *
 * This is the real render-level proof: render all three components with
 * one fully-populated fixture item, in the exact sequence both forks
 * actually mount them (Face, then ReasonChips, then Extras), concatenate
 * the markup the same way the real card does, then locate each block by
 * a stable, visible marker in that OUTPUT and assert strictly increasing
 * indices — genuinely proving the full board sequence, not just that
 * three component tags appear in the right order in source.
 */

function fullyPopulatedItem(): ReportItem {
  return {
    label: "SBIF Facade Grant",
    value: "Review published terms",
    programId: "sbif",
    administrator: "SomerCor 504",
    availability: "active",
    nextWindow: { expected: "2026-09-15", note: "September 2026 window open through 2026-09-15" },
    decisionBy: "SomerCor + DPD",
    costSignals: [
      { label: "Free to apply", severity: "info" },
      { label: "Permit fees apply", severity: "amber" },
    ],
    detail: "Grants up to $50,000 for storefront and facade improvements in eligible TIF districts.",
    eligibilityRules: [
      { description: "Property inside an eligible TIF district", required: true },
      { description: "Two contractor bids", required: false },
    ],
    matchExplanation: {
      whyItAppears: ["Address falls inside a TIF district", "Project goal matches published uses"],
      knownFromPublicData: [],
      basedOnUserAnswers: [],
      stillToConfirm: [],
      currentDocumentsToGather: [],
      confirmWith: [],
    },
    worksWith: [{ label: "TIF Districts", detail: "Funded through TIF dollars." }],
    nextStep: "Attend a mandatory SBIF orientation session",
    primaryContact: { agency: "SomerCor 504", phone: "(312) 360-3384" },
    expectations: "Applications are being accepted under the published intake window as of 2026-08-23.",
    verifySources: [{ label: "Official program page", url: "https://example.com/sbif", dated: "2026-07-10" }],
  };
}

/** Renders the three components in the exact sequence both real forks
 *  mount them (app/report/page.tsx and components/report/ReportDisplay.tsx's
 *  shared `<ProgramCardFace/><ReasonChips/><ProgramCardExtras/>` block) and
 *  concatenates their markup, mirroring how they land in one card's DOM. */
function renderFullCard(item: ReportItem): string {
  const face = renderToStaticMarkup(<ProgramCardFace item={item} />);
  const chips = renderToStaticMarkup(<ReasonChips explanation={item.matchExplanation} />);
  const extras = renderToStaticMarkup(<ProgramCardExtras item={item} />);
  return face + chips + extras;
}

describe("program card face — real render-level board order (gate round 3, BLOCKER 11 RULING)", () => {
  it("renders every blessed block in the exact R5OwnerFinal board sequence, located by stable marker in the RENDERED OUTPUT", () => {
    const html = renderFullCard(fullyPopulatedItem());

    // Stable, visible markers for each block, in the board's own order.
    const markers = {
      header: "Administered by SomerCor 504",
      glance: "Decision by",
      costSignals: "Cost signals",
      whatItFunds: "What it funds",
      commonlyRequired: "Commonly required",
      whyThisIsShown: "Why this is shown",
      canCombineWith: "Can combine with",
      nextStep: "Next step",
      whatToExpect: "What to expect",
      verifyAtSource: "Verify at the source",
    };

    const indices: Record<string, number> = {};
    for (const [key, marker] of Object.entries(markers)) {
      const idx = html.indexOf(marker);
      expect(idx, `marker "${marker}" (${key}) present in rendered output`).toBeGreaterThan(-1);
      indices[key] = idx;
    }

    const orderedKeys = [
      "header",
      "glance",
      "costSignals",
      "whatItFunds",
      "commonlyRequired",
      "whyThisIsShown",
      "canCombineWith",
      "nextStep",
      "whatToExpect",
      "verifyAtSource",
    ];
    for (let i = 0; i < orderedKeys.length - 1; i++) {
      const a = orderedKeys[i];
      const b = orderedKeys[i + 1];
      expect(indices[a], `${a} (${indices[a]}) before ${b} (${indices[b]})`).toBeLessThan(indices[b]);
    }
  });

  it("the traces-to-public-record line renders whenever the Verify block renders (gate round 3 nit — suppressibility was previously unenforced)", () => {
    const html = renderFullCard(fullyPopulatedItem());
    const verifyIdx = html.indexOf("Verify at the source");
    expect(verifyIdx).toBeGreaterThan(-1);
    const afterVerify = html.slice(verifyIdx);
    expect(afterVerify).toMatch(/Every figure above traces to a public record\./);
  });
});
