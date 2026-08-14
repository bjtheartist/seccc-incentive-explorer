"use client";

// ─── Report Navigation Links & Freshness Badge ───────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing these keeps official-source links, portal
// chips, and verification framing from diverging further.

import { ExternalLink } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { ApplicationPortal, VerificationStep } from "@/lib/types";

export type ReportNavigationItem = GeneratedReport["sections"][number]["items"][number] & {
  applicationPortals?: ApplicationPortal[];
  verificationSteps?: VerificationStep[];
};

export function FreshnessBadge({ lastVerifiedAt, isStale }: { lastVerifiedAt: string | null; isStale?: boolean }) {
  if (!lastVerifiedAt) return null;
  const d = new Date(lastVerifiedAt);
  const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return (
    <span className={`font-mono-bureau text-[8px] tracking-[0.1em] uppercase ${isStale ? "text-[#0C1B33]/25" : "text-[#0C1B33]/35"}`}>
      {isStale ? `Unverified since ${label}` : `Verified ${label}`}
    </span>
  );
}

// review7 S20 (MEDIUM) — the optional `program?: Program` fallback prop
// was removed here. review6 S11's investigation of
// `programReportItem()` (lib/report-engine.ts) already confirmed every
// program-linked `ReportItem` sets `applicationPortals`/
// `verificationSteps`/`sourceUrl` directly at generation time, so the
// `item.X || program?.X` fallback was ALREADY redundant for the real
// code path — S11 dropped the prop from app/report/page.tsx's own
// ReportDisplay fork's call site, but not from
// components/report/ReportDisplay.tsx (the SEPARATE shared fork this
// component's own doc comment above says was deliberately never
// consolidated) or from this component's own signature. The
// strengthened review7 S20 client-Program-reference guard caught both
// remaining occurrences as real, live raw-`Program` prop types with no
// actual caller ever populating them (confirmed: neither fork passes
// `program=` anymore after this fix) — genuinely dead code, not just an
// unused type.
export function ReportNavigationLinks({
  item,
}: {
  item: ReportNavigationItem;
}) {
  const officialSourceUrl = item.sourceUrl;
  const officialSourceLabel = item.sourceLabel
    ? `${item.sourceLabel} source`
    : "Official source";
  const applicationPortals = (item.applicationPortals || []).filter(
    (portal) => portal.url,
  );
  const verificationSteps = (item.verificationSteps || []).filter(
    (step) => step.url,
  );

  if (!officialSourceUrl && applicationPortals.length === 0 && verificationSteps.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 pt-1">
      {officialSourceUrl && (
        <a
          href={officialSourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          {officialSourceLabel}
        </a>
      )}

      {applicationPortals.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            Application Portals
          </span>
          <div className="flex flex-wrap gap-2">
            {applicationPortals.map((portal) => (
              <a
                key={`${portal.label}-${portal.url}`}
                href={portal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 border border-[#0C1B33]/10 px-2.5 py-1.5 text-[10px] text-[#0C1B33]/50 hover:text-[#0C1B33] hover:border-[#0C1B33]/20 transition-colors font-mono-bureau tracking-wide"
                title={portal.notes}
              >
                {portal.label}
                {portal.language && portal.language !== "en" && (
                  <span className="text-[#0C1B33]/25 uppercase">{portal.language}</span>
                )}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      {verificationSteps.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            Suggested Next Steps
          </span>
          <ul className="space-y-1.5">
            {verificationSteps.map((step) => (
              <li key={`${step.label}-${step.url}`} className="text-[11px] text-[#0C1B33]/45 leading-relaxed">
                <a
                  href={step.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#0C1B33]/55 hover:text-[#0C1B33] transition-colors"
                >
                  {step.label}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                <span className="text-[#0C1B33]/30"> — {step.agency}</span>
                {step.note && (
                  <span className="block text-[#0C1B33]/35 mt-0.5">{step.note}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
