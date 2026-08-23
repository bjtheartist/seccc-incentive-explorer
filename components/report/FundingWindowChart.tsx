"use client";

// ─── Funding Window Chart (spec v2 item 4, owner: starting/growing) ─────
// Interval bars for the SBIF application window(s) already resolved for
// this address (lib/report-charts.ts, reading lib/deadlines.ts's
// per-address resolution — never a fabricated date). Renders nothing when
// the address has no SBIF window in range.

import { useState } from "react";
import { AlertCircle, Check, Loader2, Mail, X } from "lucide-react";
import { buildFundingWindowChartData } from "@/lib/report-charts";
import { programCount } from "@/lib/report-email";
import type { GeneratedReport } from "@/lib/report-engine";

const CHART_WIDTH = 560;
const ROW_HEIGHT = 30;
const LABEL_WIDTH = 140;
const PLOT_WIDTH = CHART_WIDTH - LABEL_WIDTH - 20;
// Gate finding 15: this plotting window is intentionally narrower than the
// 365-day range lib/deadlines.ts resolves deadlines across (a wide plot
// would flatten every near-term bar to a sliver) — but a window whose real
// dates fall outside it (e.g. one opening in 300 days) used to render
// CLAMPED to the same position as one opening at 150 days, with no date
// text anywhere to tell them apart. Fixed below by printing each bar's
// real start/end dates and flagging a clamped bar visually, not by
// widening the plot (which would defeat its own purpose).
const SPAN_DAYS = 180; // today - 30d .. today + 150d, a fixed 6-month plotting window

function dayOffset(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function xFor(dayOffsetValue: number): number {
  const clamped = Math.max(-30, Math.min(SPAN_DAYS - 30, dayOffsetValue));
  return LABEL_WIDTH + ((clamped + 30) / SPAN_DAYS) * PLOT_WIDTH;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function FundingWindowChart({ report }: { report: GeneratedReport }) {
  const rows = buildFundingWindowChartData(report);
  if (!rows) return null;

  const height = rows.length * ROW_HEIGHT + 24;
  const todayX = xFor(0);

  return (
    <div data-testid="funding-window-chart" className="mt-3">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} className="w-full max-w-[560px]" role="img" aria-label="SBIF funding window chart">
        <line x1={todayX} y1={4} x2={todayX} y2={height - 4} stroke="#0C1B33" strokeOpacity={0.15} strokeDasharray="2,2" />
        <text x={todayX} y={12} fontSize="9" fill="#0C1B33" fillOpacity={0.4} textAnchor="middle">
          today
        </text>
        {rows.map((row, index) => {
          const y = index * ROW_HEIGHT + 24;
          const startOffset = dayOffset(row.startDate);
          const endOffset = dayOffset(row.endDate);
          const x1 = xFor(startOffset);
          const x2 = xFor(endOffset);
          const width = Math.max(x2 - x1, 4);
          // Gate finding 15: a bar whose REAL end falls beyond the plotted
          // range renders clamped to the same right edge regardless of how
          // far past it the real date is — the printed date text (below)
          // is what actually disambiguates a 300-day window from a
          // 150-day one; this flag also draws a small ›› marker so the
          // clamp itself is visible, not just inferable from the label.
          const isClamped = endOffset > SPAN_DAYS - 30;
          const dateLabel =
            row.startDate === row.endDate
              ? formatShortDate(row.startDate)
              : `${formatShortDate(row.startDate)} – ${formatShortDate(row.endDate)}`;
          return (
            <g key={row.label}>
              <title>{row.tooltip}</title>
              <text x={0} y={y + 5} fontSize="10" fill="#0C1B33">
                {row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label}
              </text>
              <rect
                x={x1}
                y={y - 5}
                width={width}
                height={10}
                rx={2}
                fill={row.amber ? "#A45B00" : "#2563EB"} /* gate finding 22 (minor): #F59E0B failed contrast as a warning color */
              />
              {isClamped && (
                <text x={x2 + 3} y={y + 4} fontSize="9" fill="#0C1B33" fillOpacity={0.4}>
                  ››
                </text>
              )}
              <text x={x1 + width + (isClamped ? 14 : 6)} y={y + 4} fontSize="9" fill="#0C1B33" fillOpacity={0.6}>
                {dateLabel}
              </text>
              {row.amber && (
                <text x={x1 + width + (isClamped ? 14 : 6)} y={y + 14} fontSize="8" fontWeight={600} fill="#A45B00">
                  {startOffset < 0 ? "open now" : "opens within 60 days"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[9px] text-[#0C1B33]/40">
        Source: City of Chicago SBIF rollout calendar — hover a bar for details.
      </p>
      <FundingWindowEmailOffer report={report} />
    </div>
  );
}

type OfferStatus = "idle" | "sending" | "sent" | "error";

/**
 * Inline email offer beside the SBIF/funding-window region (spec §C).
 * Deliberately NOT a scheduled "notify me when this window opens": no
 * reminder-send backend exists anywhere in this repo (no cron, no
 * scheduled job — grep confirmed zero matches for "reminder" outside this
 * comment). Promising a future-triggered send here would be a claim the
 * system cannot keep. Instead this sends the report NOW, using the exact
 * same real, working mechanism as the report's own "Email Report" action
 * (POST /api/email-report — see components/report/ReportModals.tsx's
 * EmailReportModal) — just inline, context-rich, and dismissible next to
 * the dates it's about, never a modal.
 */
function FundingWindowEmailOffer({ report }: { report: GeneratedReport }) {
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<OfferStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (dismissed) return null;

  const handleSend = async () => {
    if (!email.includes("@") || status === "sending" || status === "sent") return;
    setStatus("sending");
    setErrorMessage("");
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
          incentiveCount: programCount(report),
          source: "funding_window_inline_offer",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "We could not email this report. Please try again.");
      }
      setStatus("sent");
    } catch (sendError) {
      setStatus("error");
      setErrorMessage(
        sendError instanceof Error
          ? sendError.message
          : "We could not email this report. Please try again.",
      );
    }
  };

  return (
    <div
      data-testid="funding-window-email-offer"
      className="mt-3 flex flex-col gap-2 border border-[#0C1B33]/10 bg-[#FAF9F6] px-3 py-2.5 print:hidden"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-[#0C1B33]/70">
          Want these dates where you won&rsquo;t lose them? We&rsquo;ll email this report,
          including the window dates above, to your inbox right now.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[#0C1B33]/35 hover:text-[#0C1B33]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {status === "sent" ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-[#0C1B33]">
          <Check className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
          Sent — check your inbox.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleSend()}
            placeholder="you@business.com"
            disabled={status === "sending"}
            className="min-w-0 flex-1 border border-[#0C1B33]/15 bg-white px-3 py-2 text-[12px] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB] disabled:opacity-55"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!email.includes("@") || status === "sending"}
            className="flex shrink-0 items-center justify-center gap-1.5 bg-[#2563EB] px-3.5 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "sending" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                Email me this report
              </>
            )}
          </button>
        </div>
      )}
      {status === "error" && errorMessage && (
        <p role="alert" className="flex items-start gap-1.5 text-[10.5px] text-red-700">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {errorMessage}
        </p>
      )}
    </div>
  );
}
