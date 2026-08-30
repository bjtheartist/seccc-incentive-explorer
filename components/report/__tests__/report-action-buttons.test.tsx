// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportActionButtons } from "@/components/report/ReportActionButtons";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import {
  getReportActionPolicy,
  isVacancyReport,
} from "@/lib/report-action-policy";

function report(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-08-29T12:00:00.000Z",
    summary: "",
    sections: [],
    recommendedActions: [],
    metadata: {},
    ...overrides,
  };
}

const wizardState = {} as WizardState;

afterEach(cleanup);

function renderActions({
  currentReport = report(),
  includeWizardState = true,
  isDrawnAreaReport = false,
  linkCopied = false,
}: {
  currentReport?: GeneratedReport;
  includeWizardState?: boolean;
  isDrawnAreaReport?: boolean;
  linkCopied?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <ReportActionButtons
      report={currentReport}
      wizardState={includeWizardState ? wizardState : undefined}
      isDrawnAreaReport={isDrawnAreaReport}
      linkCopied={linkCopied}
      onDownload={() => {}}
      onSave={() => {}}
      onEmail={() => {}}
      onShare={() => {}}
      afterSave={<span>Preparation slot</span>}
      afterEmail={<span>CSV slot</span>}
    />,
  );
}

describe("report action policy", () => {
  it("uses one vacancy definition for current vacancy types and legacy vacancy-titled reports", () => {
    expect(isVacancyReport(report({ reportType: "dev-feasibility" }))).toBe(true);
    expect(isVacancyReport(report({ reportType: "best-location" }))).toBe(true);
    expect(isVacancyReport(report({ title: "Legacy Vacancy Snapshot" }))).toBe(true);
    expect(isVacancyReport(report())).toBe(false);
  });

  it("exposes report-type-aware labels and only permits sharing a non-drawn report with wizard state", () => {
    expect(getReportActionPolicy(report(), wizardState, false)).toEqual({
      isVacancyReport: false,
      saveLabel: "Save to Workspace",
      emailLabel: "Email Report",
      canShare: true,
    });
    expect(
      getReportActionPolicy(
        report({ reportType: "best-location" }),
        wizardState,
        true,
      ),
    ).toEqual({
      isVacancyReport: true,
      saveLabel: "Save Report",
      emailLabel: "Email This to Me",
      canShare: false,
    });
    expect(getReportActionPolicy(report(), undefined, false).canShare).toBe(false);
  });
});

describe("ReportActionButtons", () => {
  it("wires each generic button to the renderer-owned handler", () => {
    const onDownload = vi.fn();
    const onSave = vi.fn();
    const onEmail = vi.fn();
    const onShare = vi.fn();
    render(
      <ReportActionButtons
        report={report()}
        wizardState={wizardState}
        isDrawnAreaReport={false}
        linkCopied={false}
        onDownload={onDownload}
        onSave={onSave}
        onEmail={onEmail}
        onShare={onShare}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Email Report" }));
    fireEvent.click(screen.getByRole("button", { name: "Share Report" }));

    expect(onDownload).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onEmail).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
  });

  it("renders ordinary report copy and preserves the existing action-slot order", () => {
    const html = renderActions();

    expect(html).toContain("Download PDF");
    expect(html).toContain("Save to Workspace");
    expect(html).toContain("Email Report");
    expect(html).toContain("Share Report");
    expect(html.indexOf("Save to Workspace")).toBeLessThan(html.indexOf("Preparation slot"));
    expect(html.indexOf("Preparation slot")).toBeLessThan(html.indexOf("Email Report"));
    expect(html.indexOf("Email Report")).toBeLessThan(html.indexOf("CSV slot"));
    expect(html.indexOf("CSV slot")).toBeLessThan(html.indexOf("Share Report"));
  });

  it("renders vacancy-specific copy and the copied-link state", () => {
    const html = renderActions({
      currentReport: report({ reportType: "dev-feasibility" }),
      linkCopied: true,
    });

    expect(html).toContain("Save Report");
    expect(html).toContain("Email This to Me");
    expect(html).toContain("Link Copied!");
    expect(html).not.toContain("Save to Workspace");
    expect(html).not.toContain("Share Report");
  });

  it("suppresses Share for drawn-area reports and reports without wizard state", () => {
    expect(renderActions({ isDrawnAreaReport: true })).not.toContain("Share Report");
    expect(renderActions({ includeWizardState: false })).not.toContain("Share Report");
  });
});
