import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import type { GeneratedReport } from "@/lib/report-engine";

const report: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-07-10T12:00:00.000Z",
  summary: "",
  sections: [],
  recommendedActions: [],
  metadata: {
    address: "4200 S California Ave, Chicago, IL",
  },
};

function renderGate(reportOverride: GeneratedReport = report) {
  return renderToStaticMarkup(
    <ReportEmailGate
      report={reportOverride}
      source="test"
      onPrepareReport={async () => reportOverride}
      onReportReady={() => {}}
    />,
  );
}

/**
 * Opening tag of the element carrying `data-testid="<id>"`, with the class
 * attribute stripped — Tailwind's `disabled:` variants would otherwise make
 * every styled button look disabled to a substring check.
 */
function openTagFor(html: string, testId: string): string | null {
  const match = html.match(
    new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`),
  );
  return match?.[0].replace(/\sclass="[^"]*"/g, "") ?? null;
}

describe("ReportEmailGate", () => {
  it("makes email optional while keeping the project goals checkpoint", () => {
    const html = renderGate();

    expect(html).toContain("<dialog");
    expect(html).toContain('data-testid="report-email-gate"');
    expect(html).toContain("Your report is ready");
    expect(html).toContain("Project goals");
    expect(html).toContain("0/3");
    expect(html).toContain("Hire or retain employees");
    expect(html).toContain("Email Address (Optional)");
    expect(html).toContain("Email and View Report");
    expect(html).toContain("Continue Without Email");
    expect(html).toContain("Chamber follow-up happens only when you request it");
  });

  it("offers an instant PDF download alongside the email option", () => {
    const html = renderGate();

    expect(html).toContain('data-testid="report-pdf-download"');
    expect(html).toContain("Download PDF");
    // The email path is an alternative, never replaced by the download.
    expect(html).toContain("Email and View Report");
  });

  it("keeps the PDF download reachable without an email address", () => {
    // Nothing has been typed in this render: no email, no name, no goal. The
    // email submit is correctly disabled in that state — the PDF button must
    // NOT be, or the 110 gate-skippers still have no way to a file (WP2).
    const html = renderGate();

    const pdfTag = openTagFor(html, "report-pdf-download");
    expect(pdfTag).not.toBeNull();
    expect(pdfTag).not.toContain("disabled");

    // Control: the email-gated submit *is* disabled in the same markup, so the
    // assertion above is proving reachability rather than that this render
    // simply never emits `disabled`.
    expect(html).toContain("disabled=\"\"");
  });

  // ─── Persona intake (owner ruling A1, spec v2 deliverable 6) ──────────
  describe("persona intake chip row", () => {
    it("renders as an optional row, not a blocking question", () => {
      const html = renderGate();
      expect(html).toContain('data-testid="report-email-gate-persona-row"');
      expect(html).toContain("Which best describes you? (Optional)");
      // Still reachable: the row never disables the PDF/continue paths.
      const pdfTag = openTagFor(html, "report-pdf-download");
      expect(pdfTag).not.toContain("disabled");
    });

    it("pre-selects the inferred lens from industry/goal (developer signal)", () => {
      const developerSignal: GeneratedReport = {
        ...report,
        metadata: { ...report.metadata, industry: "realEstate" },
      };
      const html = renderGate(developerSignal);
      // Exactly one chip in the persona row carries aria-pressed="true".
      const rowStart = html.indexOf('data-testid="report-email-gate-persona-row"');
      const rowEnd = html.indexOf("</form>", rowStart);
      const row = html.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
      expect((row.match(/aria-pressed="true"/g) || []).length).toBe(1);
      // The pressed chip is the developer one specifically.
      const developerButtonMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Developer or investor<\/button>/,
      );
      expect(developerButtonMatch?.[1]).toBe("true");
    });

    it("pre-selects growing (the default) when no strong signal is present", () => {
      const html = renderGate();
      const rowStart = html.indexOf('data-testid="report-email-gate-persona-row"');
      const rowEnd = html.indexOf("</form>", rowStart);
      const row = html.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
      const growingButtonMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Growing \/ property owner<\/button>/,
      );
      expect(growingButtonMatch?.[1]).toBe("true");
      // Gate round 2, MAJOR 25 + RULING: this same "no strong signal"
      // input is exactly the shape that would trip the inference
      // function's own "looking" branch in isolation — but the real
      // report here still carries a real reportType ("site-incentives"),
      // so in production this pre-selects "growing", never "looking".
      // See lib/persona-inference.ts's updated doc comment and
      // lib/__tests__/persona-inference.test.ts's "never infers looking
      // for any input shape the real call site can actually produce" test
      // for the same claim proven at the pure-function level.
      const lookingButtonMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Just looking<\/button>/,
      );
      expect(lookingButtonMatch?.[1]).toBe("false");
    });

    // Gate round 2, MAJOR 25 + RULING: "Just looking" must be a VISIBLE,
    // directly tappable option in this row — the real, reachable path to
    // the "looking" persona for an actual visitor, since the inference
    // branch that could otherwise produce it is dead in production (see
    // the test above and lib/persona-inference.ts). PERSONA_CHIPS.map
    // renders every chip generically with no persona-specific filter, so
    // this is really just confirming that generic rendering reaches
    // "looking" too — but the earlier round's gap was exactly this class
    // of unstated assumption, so it gets its own explicit assertion.
    it("renders 'Just looking' as a real, enabled, tappable chip in the row — not merely inferable", () => {
      const html = renderGate();
      const rowStart = html.indexOf('data-testid="report-email-gate-persona-row"');
      const rowEnd = html.indexOf("</form>", rowStart);
      const row = html.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
      expect(row).toContain("Just looking");
      const lookingTag = row.match(/<button[^>]*>Just looking<\/button>/)?.[0];
      expect(lookingTag).toBeTruthy();
      expect(lookingTag).not.toMatch(/\sdisabled(=|\/|>)/);
      expect(lookingTag).toContain('type="button"');
    });
  });
});
