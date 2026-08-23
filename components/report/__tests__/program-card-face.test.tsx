import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import type { ReportItem } from "@/lib/report-engine";

function baseItem(overrides: Partial<ReportItem> = {}): ReportItem {
  return { label: "Test Program", value: "Review published terms", ...overrides };
}

describe("ProgramCardFace (gate finding 11)", () => {
  it("renders nothing when the item carries none of the face fields — never an empty shell", () => {
    expect(renderToStaticMarkup(<ProgramCardFace item={baseItem()} />)).toBe("");
  });

  it("renders the administrator line and status pill", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace item={baseItem({ administrator: "SomerCor 504", availability: "active" })} />,
    );
    expect(html).toContain("Administered by SomerCor 504");
    expect(html).toContain("Active");
  });

  it("renders the glance row (Window / Decision by) from structured fields only", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          nextWindow: { expected: "2026-08-30", note: "August 2026 window open through 2026-08-30" },
          decisionBy: "SomerCor + DPD",
        })}
      />,
    );
    expect(html).toContain("Window");
    expect(html).toContain("August 2026 window open through 2026-08-30");
    expect(html).toContain("Decision by");
    expect(html).toContain("SomerCor + DPD");
  });

  it("never renders an Amount or Type tile — no non-blocklisted structured source exists for either", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          administrator: "SomerCor 504",
          nextWindow: { expected: "2026-08-30", note: "August window" },
          decisionBy: "SomerCor + DPD",
          eligibilityRules: [{ description: "Property inside an eligible TIF district", required: true }],
        })}
      />,
    );
    expect(html).not.toMatch(/>Amount</);
    expect(html).not.toMatch(/>Type</);
  });

  it("renders 'Commonly required' from eligibilityRules with the non-suppressible administrator-confirms footer", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          eligibilityRules: [
            { description: "Property inside an eligible TIF district", required: true },
            { description: "Two contractor bids", required: false },
          ],
        })}
      />,
    );
    expect(html).toContain("Commonly required");
    expect(html).toContain("Property inside an eligible TIF district");
    expect(html).toContain("Two contractor bids");
    expect(html).toMatch(/Your program administrator confirms current eligibility/);
  });

  // Gate round 3 BLOCKER 11 RULING: next-step + primary contact MOVED to
  // ProgramCardExtras (board order places it after "Can combine with",
  // which only exists after ReasonChips — see
  // components/report/__tests__/program-card-extras.test.tsx for the
  // moved test).
  it("does NOT render next-step or primary contact — moved to ProgramCardExtras (gate round 3 BLOCKER 11 RULING)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          administrator: "SomerCor 504",
          nextStep: "Attend a mandatory SBIF orientation session",
          primaryContact: { agency: "SomerCor 504", phone: "(312) 360-3384" },
        })}
      />,
    );
    expect(html).not.toContain("Next step");
    expect(html).not.toContain("Attend a mandatory SBIF orientation session");
    expect(html).not.toContain("(312) 360-3384");
  });

  // Gate round 3 BLOCKER 11 RULING: cost signals MOVED IN from
  // ProgramCardExtras — board order places it right after the glance row.
  it("renders cost-signal pills with the non-suppressible caption, moved IN from ProgramCardExtras (gate round 3 BLOCKER 11 RULING)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          costSignals: [
            { label: "Free to apply", severity: "info" },
            { label: "Permit fees apply", severity: "amber" },
          ],
        })}
      />,
    );
    expect(html).toContain("Cost signals");
    expect(html).toContain("Free to apply");
    expect(html).toContain("Permit fees apply");
    expect(html).toMatch(/Signals, not estimates/);
  });

  it("omits the cost-signals block entirely when the item carries no confirmed tags", () => {
    const html = renderToStaticMarkup(<ProgramCardFace item={baseItem({ administrator: "SomerCor 504" })} />);
    expect(html).not.toContain("Cost signals");
    expect(html).not.toMatch(/Signals, not estimates/);
  });

  // Gate round 3 BLOCKER 11 RULING addition: "What it funds" reads
  // item.detail (== program.summary for a real program item), gated on
  // item.programId so it never renders for a non-program item whose
  // detail means something else entirely (e.g. a Site Facts summary
  // line).
  it("renders 'What it funds' from item.detail when item.programId is present", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          programId: "sbif",
          detail: "Grants up to $50,000 for storefront and facade improvements.",
        })}
      />,
    );
    expect(html).toContain("What it funds");
    expect(html).toContain("Grants up to $50,000 for storefront and facade improvements.");
  });

  it("does NOT render 'What it funds' when item.detail is present but item.programId is absent (never mistakes an unrelated item's detail for a program description)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          administrator: "SomerCor 504",
          detail: "Some non-program detail text.",
        })}
      />,
    );
    expect(html).not.toContain("What it funds");
    expect(html).not.toContain("Some non-program detail text.");
  });

  it("omits each block honestly when its underlying field is absent", () => {
    const html = renderToStaticMarkup(<ProgramCardFace item={baseItem({ administrator: "SomerCor 504" })} />);
    expect(html).not.toContain("Window");
    expect(html).not.toContain("Decision by");
    expect(html).not.toContain("Cost signals");
    expect(html).not.toContain("What it funds");
    expect(html).not.toContain("Commonly required");
  });
});
