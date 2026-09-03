import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * R1 finding 5 — the recurrence fence, for the two download/email surfaces
 * that cannot be cheaply mounted in a unit test.
 *
 * `components/map/MapPolygonPanel.tsx`'s "Download PDF" button is an
 * `async` click handler with no `catch`: a failed jsPDF render became a
 * silent unhandled rejection, and the reader simply got no file, with nothing
 * on screen to say so and nothing to retry from. Mounting that panel needs a
 * live Mapbox GL instance, so this asserts the SHAPE of the fix at the source
 * level instead — the same technique as
 * app/report/__tests__/gate-prepare-call-site-fence.test.ts and
 * lib/source-guard/fork-parity.ts, which is the house style for a guard whose
 * subject is "the code must keep looking like this".
 *
 * The behavioural assertions live next door in
 * download-gate-promise-safety.test.tsx (the modal that awaits these
 * handlers) and funding-window-email-offer.test.tsx (the email deadline).
 */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function source(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("MapPolygonPanel: the area PDF download cannot fail silently again", () => {
  const panel = source("components/map/MapPolygonPanel.tsx");

  it("wraps the PDF generation in a try/catch instead of letting it reject unhandled", () => {
    const handler = panel.slice(
      panel.indexOf("const handleDownloadPdf"),
      panel.indexOf("const handleExportCsv"),
    );
    expect(handler).toContain("try {");
    expect(handler).toContain("catch");
    expect(handler).toContain("setPdfDownloadFailed(true)");
    // The failure flag is cleared when a fresh attempt starts, so a stale
    // error can never outlive the attempt that produced it.
    expect(handler).toContain("setPdfDownloadFailed(false)");
  });

  it("renders an on-screen failure state with a real retry, not just a console line", () => {
    expect(panel).toContain('data-testid="area-pdf-download-error"');
    expect(panel).toContain("Retry PDF");
    // Honest: it says nothing was produced, and blames nobody.
    expect(panel).toContain("Nothing was saved or sent");
  });
});

// Fork-unification round: this used to iterate two renderer files —
// app/report/page.tsx's private ReportDisplay and the exported component.
// The private copy is gone; /report renders the exported one. Both
// assertions are kept, applied once, to the renderer that survived.
describe("the ReportDisplay renderer hands the gate a PROMISE, so failures are observable", () => {
  const RENDERER = "components/report/ReportDisplay.tsx";

  it(`${RENDERER}'s handleDownloadAfterCapture stays async and does not swallow its error`, () => {
    const text = source(RENDERER);
    const start = text.indexOf("const handleDownloadAfterCapture");
    expect(start, `${RENDERER} should still define handleDownloadAfterCapture`).toBeGreaterThan(-1);
    const handler = text.slice(start, start + 700);

    expect(handler).toContain("async ()");
    // A local try/catch here would re-create the exact defect: the gate
    // would see a resolved promise and move to "done" for a file that was
    // never produced. The rejection must reach DownloadGateModal.
    expect(handler).not.toContain("catch");
  });

  it("fires report_pdf_downloaded only AFTER the PDF is generated", () => {
    const text = source(RENDERER);
    const start = text.indexOf("const handleDownloadAfterCapture");
    const handler = text.slice(start, start + 700);
    const generateAt = handler.indexOf("generateReportPdf(report)");
    const trackAt = handler.indexOf("report_pdf_downloaded");
    expect(generateAt).toBeGreaterThan(-1);
    expect(trackAt).toBeGreaterThan(generateAt);
  });
});

describe("the download gate itself never fires the success event before the download", () => {
  const modals = source("components/report/ReportModals.tsx");

  it("the skip path awaits the download and only then tracks it", () => {
    const start = modals.indexOf("const handleSkip");
    expect(start).toBeGreaterThan(-1);
    const handler = modals.slice(start, modals.indexOf("return (", start));
    const awaitAt = handler.indexOf("await runDownload()");
    // Match the CALL, not the prose: the comment above it names the event too.
    const trackAt = handler.indexOf('trackEvent("report_pdf_downloaded"');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(trackAt).toBeGreaterThan(-1);
    expect(trackAt).toBeGreaterThan(awaitAt);
  });

  it("every /api/email-report call site in components/report carries an abort deadline", () => {
    for (const file of [
      "components/report/ReportModals.tsx",
      "components/report/FundingWindowChart.tsx",
    ]) {
      const text = source(file);
      const at = text.indexOf('fetch("/api/email-report"');
      expect(at, `${file} should still call /api/email-report`).toBeGreaterThan(-1);
      const call = text.slice(at, at + 900);
      expect(call, file).toContain("AbortSignal.timeout(EMAIL_REPORT_TIMEOUT_MS)");
    }
  });
});
