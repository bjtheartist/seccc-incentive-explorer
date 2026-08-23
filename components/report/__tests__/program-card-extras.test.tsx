import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import type { ReportItem } from "@/lib/report-engine";

function baseItem(overrides: Partial<ReportItem> = {}): ReportItem {
  return { label: "Test Program", value: "", ...overrides };
}

describe("ProgramCardExtras", () => {
  it("renders nothing when none of worksWith/expectations/verifySources are present — never an empty shell", () => {
    const html = renderToStaticMarkup(<ProgramCardExtras item={baseItem()} />);
    expect(html).toBe("");
  });

  it("renders only the blocks whose data is present (honest omission)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras item={baseItem({ expectations: "Rolling intake" })} />,
    );
    expect(html).toContain("What to expect");
    expect(html).toContain("Rolling intake");
    expect(html).not.toContain("Can combine with");
    expect(html).not.toContain("Verify at the source");
  });

  it("renders 'Can combine with' chips and their stacking caveat", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras
        item={baseItem({ worksWith: [{ label: "TIF Districts", detail: "Funded through TIF dollars." }] })}
      />,
    );
    expect(html).toContain("Can combine with");
    expect(html).toContain("TIF Districts");
    expect(html).toContain("Stacking rules vary");
  });

  it("renders 'Verify at the source' links with their dated label and the traceability line", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras
        item={baseItem({
          verifySources: [{ label: "Official program page", url: "https://example.com/x", dated: "2026-07-10" }],
        })}
      />,
    );
    expect(html).toContain("Verify at the source");
    expect(html).toContain("Official program page");
    expect(html).toContain("2026-07-10");
    expect(html).toMatch(/every figure above traces to a public record/i);
  });

  it("renders worksWith detail VISIBLY, not only in a hover title= attribute (gate finding 21)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras
        item={baseItem({ worksWith: [{ label: "TIF Districts", detail: "Funded through TIF dollars." }] })}
      />,
    );
    // The detail text itself must be in the rendered markup body, not only
    // reachable via a title="" attribute a touch/print reader never sees.
    expect(html).toContain("Funded through TIF dollars.");
  });

  it("renders cost-signal pills with the non-suppressible caption (gate finding 4)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras
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
    const html = renderToStaticMarkup(<ProgramCardExtras item={baseItem({ expectations: "Rolling" })} />);
    expect(html).not.toContain("Cost signals");
    expect(html).not.toMatch(/Signals, not estimates/);
  });

  it("never renders a timeline/process diagram (owner ruling — timeline treatment REJECTED)", () => {
    const html = renderToStaticMarkup(
      <ProgramCardExtras
        item={baseItem({
          worksWith: [{ label: "TIF", detail: "x" }],
          expectations: "Rolling",
          verifySources: [{ label: "Source", url: "https://example.com", dated: null }],
        })}
      />,
    );
    // Icons (e.g. the external-link glyph) are fine; a linear process
    // graphic naming its own steps/stages is what's prohibited.
    expect(html).not.toMatch(/timeline|process-step|step-\d|stage-\d/i);
  });
});
