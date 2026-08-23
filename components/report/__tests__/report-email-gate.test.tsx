import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import { GATE_GOAL_CHIPS } from "@/lib/gate-goal-groups";
import type { GeneratedReport } from "@/lib/report-engine";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

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

/**
 * The full outer HTML of the <div data-testid="testId">...</div> the gate
 * renders — found by depth-counting div opens/closes from the opening tag,
 * since renderToStaticMarkup emits no whitespace a fixed-offset slice could
 * rely on.
 */
function divFor(html: string, testId: string): string {
  const openMatch = html.match(new RegExp(`<div[^>]*data-testid="${testId}"[^>]*>`));
  if (!openMatch || openMatch.index == null) {
    throw new Error(`No <div data-testid="${testId}"> found`);
  }
  const start = openMatch.index;
  const tagRe = /<div\b[^>]*>|<\/div>/g;
  tagRe.lastIndex = start + openMatch[0].length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0] === "</div>") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, tagRe.lastIndex);
      }
    } else {
      depth += 1;
    }
  }
  throw new Error(`Unbalanced <div data-testid="${testId}">`);
}

describe("ReportEmailGate (email-gate redesign)", () => {
  it("renders the fixed anatomy: header, persona row, goal row, primary action, support box, save row, footer", () => {
    const html = renderGate();

    expect(html).toContain("<dialog");
    expect(html).toContain('data-testid="report-email-gate"');
    expect(html).toContain("Your report is ready");
    expect(html).toContain("Which best describes you?");
    expect(html).toContain("What brings you here? (Pick up to 2 — or just looking)");
    expect(html).toContain('data-testid="report-email-gate-view"');
    expect(html).toContain("View my report");
    expect(html).toContain("Want a hand? (Optional)");
    expect(html).toContain(
      "I’d like 1-on-1 support working through this report",
    );
    expect(html).toContain(
      "A real person from the Southeast Chicago Chamber of Commerce will follow up within 48 hours.",
    );
    expect(html).toContain("Come back anytime");
    expect(html).toContain('data-testid="report-email-gate-save"');
    expect(html).toContain("Save my report");
    expect(html).toContain(
      "PDF, email &amp; window reminders live inside the report",
    );
  });

  it("removes email-delivery-of-report and PDF download from the gate", () => {
    const html = renderGate();
    expect(html).not.toContain("Email and View Report");
    expect(html).not.toContain("Continue Without Email");
    expect(html).not.toContain('data-testid="report-pdf-download"');
    expect(html).not.toContain("Download PDF");
    // No newsletter language anywhere on the gate.
    expect(html.toLowerCase()).not.toContain("newsletter");
  });

  it("renders all 8 grouped goal chips in board order, with 'Just looking around' dashed and distinct", () => {
    const html = renderGate();
    const row = divFor(html, "report-email-gate-goal-row");

    const htmlEscaped = (value: string) => value.replace(/&/g, "&amp;");
    for (const chip of GATE_GOAL_CHIPS) {
      expect(row, chip.label).toContain(htmlEscaped(chip.label));
    }
    // Order matches the board.
    const positions = GATE_GOAL_CHIPS.map((chip) => row.indexOf(htmlEscaped(chip.label)));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${GATE_GOAL_CHIPS[i].label} should come after ${GATE_GOAL_CHIPS[i - 1].label}`).toBeGreaterThan(positions[i - 1]);
    }

    const lookingTag = row.match(/<button[^>]*>Just looking around<\/button>/)?.[0];
    expect(lookingTag).toBeTruthy();
    expect(lookingTag).toContain("border-dashed");
  });

  it("VIEW MY REPORT and Save my report are disabled until a goal chip is picked, with the exact helper copy", () => {
    const html = renderGate();
    const viewTag = openTagFor(html, "report-email-gate-view");
    const saveTag = openTagFor(html, "report-email-gate-save");
    expect(viewTag).toContain("disabled=\"\"");
    expect(saveTag).toContain("disabled=\"\"");
    expect(html).toContain('data-testid="report-email-gate-helper"');
    expect(html).toContain("Pick what brings you here to continue");
  });

  describe("persona intake chip row (4 merged board chips)", () => {
    it("renders exactly the 4 board persona chips", () => {
      const html = renderGate();
      const row = divFor(html, "report-email-gate-persona-row");
      for (const label of ["Just looking", "Business owner", "Supporting businesses", "Developer"]) {
        expect(row, label).toContain(label);
      }
      // Exactly one chip pre-selected.
      expect((row.match(/aria-pressed="true"/g) || []).length).toBe(1);
    });

    it("pre-selects the inferred lens from industry/goal (developer signal) under the merged chip", () => {
      const developerSignal: GeneratedReport = {
        ...report,
        metadata: { ...report.metadata, industry: "realEstate" },
      };
      const html = renderGate(developerSignal);
      const row = divFor(html, "report-email-gate-persona-row");
      const developerButtonMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Developer<\/button>/,
      );
      expect(developerButtonMatch?.[1]).toBe("true");
    });

    it("pre-selects Business owner (the growing/starting default) when no strong signal is present", () => {
      const html = renderGate();
      const row = divFor(html, "report-email-gate-persona-row");
      const businessOwnerMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Business owner<\/button>/,
      );
      expect(businessOwnerMatch?.[1]).toBe("true");
      const lookingMatch = row.match(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>Just looking<\/button>/,
      );
      expect(lookingMatch?.[1]).toBe("false");
    });

    it("renders 'Just looking' as a real, enabled, tappable chip", () => {
      const html = renderGate();
      const row = divFor(html, "report-email-gate-persona-row");
      const lookingTag = row.match(/<button[^>]*>Just looking<\/button>/)?.[0];
      expect(lookingTag).toBeTruthy();
      expect(lookingTag).not.toMatch(/\sdisabled(=|\/|>)/);
      expect(lookingTag).toContain('type="button"');
    });
  });
});
