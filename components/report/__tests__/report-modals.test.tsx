import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DownloadGateModal,
  EmailReportModal,
} from "@/components/report/ReportModals";
import type { GeneratedReport } from "@/lib/report-engine";

const report: GeneratedReport = {
  title: "Location Snapshot",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-08-11T00:00:00Z",
  summary: "",
  sections: [],
  recommendedActions: [],
  metadata: { address: "9101 S Commercial Ave" },
};

describe("EmailReportModal", () => {
  it("renders the email form in its idle state", () => {
    const html = renderToStaticMarkup(
      <EmailReportModal report={report} onClose={() => {}} />,
    );
    expect(html).toContain("Email Report");
    expect(html).toContain("PDF attached");
    expect(html).toContain("Recipient Email");
    expect(html).toContain("Send Report");
  });
});

describe("DownloadGateModal", () => {
  const baseProps = {
    reportAddress: "9101 S Commercial Ave",
    reportTitle: "Location Snapshot",
    onDownload: async () => {},
    onClose: () => {},
  };

  it("requires details by default (public display fork)", () => {
    const html = renderToStaticMarkup(<DownloadGateModal {...baseProps} />);
    expect(html).toContain("Enter your details to download");
    expect(html).not.toContain("download-gate-skip");
    expect(html).not.toContain("Download without sharing details");
    expect(html).toContain("Download PDF");
  });

  it("offers the skip path when allowSkip is set (live /report fork)", () => {
    const html = renderToStaticMarkup(
      <DownloadGateModal {...baseProps} allowSkip />,
    );
    expect(html).toContain("Share your details, or download right away");
    expect(html).toContain("download-gate-skip");
    expect(html).toContain("Download without sharing details");
  });
});
