"use client";

// ─── Email Report & Download Gate Modals ─────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing these modals keeps the download/email
// surfaces from diverging further.
//
// Analytics stay at the call site where they differ per fork: each fork
// passes onSent to EmailReportModal built from its own
// reportAnalyticsPayload. The live /report flow also passes allowSkip so
// the download gate offers "download without sharing details"; the public
// display fork renders the required-details gate exactly as before.

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Mail,
  Printer,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { GeneratedReport } from "@/lib/report-engine";
import { programCount } from "@/lib/report-email";

/**
 * R1 finding 5. Building a PDF and posting it can take a long time on a big
 * report over a slow link, and the send previously had NO deadline at all —
 * a stalled connection left the modal on "Sending…" forever with no way out.
 * A 30s ceiling turns that into a stateable, retryable failure.
 */
export const EMAIL_REPORT_TIMEOUT_MS = 30_000;

/** Distinct from a server error: the request never came back. */
export const EMAIL_REPORT_TIMEOUT_MESSAGE =
  "That took too long — the report was not sent. Please try again.";

/** True for an aborted fetch (our own deadline) rather than a rejected send. */
export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || err.name === "AbortError";
}

/** Copy shown when the PDF itself could not be produced or handed over. */
export const PDF_DOWNLOAD_FAILURE_MESSAGE =
  "We couldn't build your PDF just then. Nothing was sent or saved — try again.";

export function EmailReportModal({
  report,
  onClose,
  onSent,
}: {
  report: GeneratedReport;
  onClose: () => void;
  /** Fork-specific analytics hook, fired once when the email send succeeds. */
  onSent?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSend = async () => {
    if (!email || !email.includes("@")) return;
    setStatus("sending");
    setErrorMsg("");

    try {
      const { generateReportPdfBase64 } = await import("@/lib/pdf-report");
      const { base64, filename } = generateReportPdfBase64(report);

      const res = await fetch("/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pdfBase64: base64,
          filename,
          businessName: report.title,
          address: report.metadata?.address,
          // F14 (build-spec.md 2.4): a program count, not a section count.
          incentiveCount: programCount(report),
        }),
        // R1 finding 5: without this the modal can sit on "Sending…" forever.
        signal: AbortSignal.timeout(EMAIL_REPORT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send");
      }

      setStatus("sent");
      onSent?.();
      setTimeout(() => { onClose(); }, 2000);
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        isTimeoutError(err)
          ? EMAIL_REPORT_TIMEOUT_MESSAGE
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h3 className="text-sm font-medium text-[#0C1B33]">Email Report</h3>
            <p className="font-mono-bureau text-[10px] text-[#0C1B33]/40 tracking-wide uppercase">PDF attached</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-[#0C1B33]/5 transition-colors">
            <span className="text-[#0C1B33]/40 text-lg">&times;</span>
          </button>
        </div>
        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-2">
              Recipient Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && status === "idle" && handleSend()}
              placeholder="name@example.com"
              disabled={status === "sending" || status === "sent"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
              autoFocus
            />
          </div>
          {status === "error" && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={!email || !email.includes("@") || status === "sending" || status === "sent"}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#2563EB] hover:bg-[#1d4ed8] disabled:opacity-40 text-white transition-all font-mono-bureau text-[11px] tracking-wide uppercase"
          >
            {status === "sending" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
            ) : status === "sent" ? (
              <><Check className="w-4 h-4" /> Sent!</>
            ) : (
              <><Mail className="w-4 h-4" /> Send Report</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DownloadGateModal({
  reportAddress,
  reportTitle,
  onDownload,
  onClose,
  allowSkip,
}: {
  reportAddress?: string;
  reportTitle?: string;
  /**
   * R1 finding 5: this was typed `() => void`, so the async PDF work every
   * caller actually does was fire-and-forget. A rejected download became an
   * unhandled rejection while the modal sat at status "done" — it had already
   * declared success. It is a promise now, and it is awaited.
   */
  onDownload: () => Promise<void>;
  onClose: () => void;
  /** When set, the gate offers a "download without sharing details" path. */
  allowSkip?: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  const isValid = name.trim().length > 0 && email.includes("@") && zipCode.trim().length >= 5;

  /**
   * Run the caller's download and report the truth about it. Returns whether
   * it succeeded, so each path can gate its own analytics on the real outcome
   * instead of on having merely started.
   */
  const runDownload = async (): Promise<boolean> => {
    try {
      await onDownload();
      return true;
    } catch (err) {
      console.error("[download gate] PDF download failed:", err);
      setStatus("error");
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!isValid || status === "saving") return;
    setStatus("saving");
    trackEvent("inquiry_submitted", {
      source: "report_pdf_gate",
      address: reportAddress || null,
      metadata: { reportTitle: reportTitle || null },
    });

    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          zipCode: zipCode.trim(),
          reportAddress,
          reportTitle,
        }),
      });
    } catch {
      // Still allow download even if lead save fails
    }

    // "done" only once the download really is done — `runDownload` sets the
    // error state itself if it is not.
    if (await runDownload()) setStatus("done");
  };

  const handleSkip = async () => {
    if (status === "saving") return;
    setStatus("saving");
    // R1 finding 5: `report_pdf_downloaded` used to fire HERE, before the
    // download was even attempted — every failed skip-path download was
    // counted as a successful one. It now fires only after the PDF is real.
    if (await runDownload()) {
      trackEvent("report_pdf_downloaded", {
        source: "report_pdf_gate_skipped",
        address: reportAddress || null,
        metadata: { reportTitle: reportTitle || null },
      });
      setStatus("done");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div>
            <h3 className="text-sm font-medium text-[#0C1B33]">Download Report</h3>
            <p className="font-mono-bureau text-[10px] text-[#0C1B33]/40 tracking-wide uppercase mt-0.5">
              {allowSkip ? "Share your details, or download right away" : "Enter your details to download"}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-[#0C1B33]/5 transition-colors">
            <span className="text-[#0C1B33]/40 text-lg">&times;</span>
          </button>
        </div>
        <div className="px-6 pb-6 pt-3 space-y-3">
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              disabled={status === "saving" || status === "done"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
              autoFocus
            />
          </div>
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={status === "saving" || status === "done"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
            />
          </div>
          <div>
            <label className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1.5">
              Zip Code
            </label>
            <input
              type="text"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && isValid && status !== "saving" && status !== "done" && handleSubmit()}
              placeholder="60617"
              maxLength={10}
              disabled={status === "saving" || status === "done"}
              className="w-full bg-[#FAF9F6] border border-[#0C1B33]/10 px-4 py-2.5 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]/50 disabled:opacity-50 font-mono-bureau"
            />
          </div>
          {status === "error" && (
            <div
              data-testid="download-gate-error"
              className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{PDF_DOWNLOAD_FAILURE_MESSAGE}</span>
            </div>
          )}
          <button
            onClick={handleSubmit}
            data-testid="download-gate-submit"
            disabled={!isValid || status === "saving" || status === "done"}
            className="w-full flex items-center justify-center gap-2 py-3 mt-1 bg-[#0C1B33] hover:bg-[#0C1B33]/80 disabled:opacity-40 text-white transition-all font-mono-bureau text-[11px] tracking-wide uppercase"
          >
            {status === "saving" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</>
            ) : status === "error" ? (
              <><Printer className="w-4 h-4" /> Try Again</>
            ) : (
              <><Printer className="w-4 h-4" /> Download PDF</>
            )}
          </button>
          {allowSkip && (
            <button
              type="button"
              data-testid="download-gate-skip"
              onClick={handleSkip}
              disabled={status === "saving" || status === "done"}
              className="w-full text-center font-mono-bureau text-[10px] tracking-wide uppercase text-[#0C1B33]/70 underline underline-offset-4 hover:text-[#0C1B33] disabled:opacity-40 py-1"
            >
              {status === "error" ? "Try downloading again" : "Download without sharing details"}
            </button>
          )}
          <p className="text-[9px] text-[#0C1B33]/30 text-center leading-snug">
            Your info helps us understand who we&apos;re serving. We won&apos;t spam you.
          </p>
        </div>
      </div>
    </div>
  );
}
