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

  it("renders next-step and primary contact from real structured catalog fields", () => {
    const html = renderToStaticMarkup(
      <ProgramCardFace
        item={baseItem({
          nextStep: "Attend a mandatory SBIF orientation session",
          primaryContact: { agency: "SomerCor 504", phone: "(312) 360-3384" },
        })}
      />,
    );
    expect(html).toContain("Next step");
    expect(html).toContain("Attend a mandatory SBIF orientation session");
    expect(html).toContain("SomerCor 504");
    expect(html).toContain("(312) 360-3384");
  });

  it("omits each block honestly when its underlying field is absent", () => {
    const html = renderToStaticMarkup(<ProgramCardFace item={baseItem({ administrator: "SomerCor 504" })} />);
    expect(html).not.toContain("Window");
    expect(html).not.toContain("Decision by");
    expect(html).not.toContain("Commonly required");
    expect(html).not.toContain("Next step");
  });
});
