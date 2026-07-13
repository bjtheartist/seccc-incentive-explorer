"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ExternalLink, Mail, Phone } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { CapitalPartnerMatch } from "@/lib/capital-partners";
import { addPartnerReferralAttribution } from "@/lib/partner-referrals";
import { trackEvent } from "@/lib/analytics-events";

function reportKey(report: GeneratedReport): string {
  return [report.reportType, report.generatedAt, report.metadata.address || report.title].join("|");
}

function eventPayload(
  report: GeneratedReport,
  source: string,
  match: CapitalPartnerMatch,
  contactMethod?: "website" | "email" | "phone",
) {
  return {
    reportType: report.reportType,
    source,
    address: report.metadata.address ?? null,
    lat: report.metadata.lat ?? null,
    lon: report.metadata.lon ?? null,
    metadata: {
      reportKey: reportKey(report),
      partnerId: match.partnerId,
      partnerName: match.name,
      partnerType: match.partnerType,
      ...(contactMethod ? { contactMethod } : {}),
      projectType: report.metadata.projectType || null,
    },
  };
}

export function CapitalPartnerHandoff({
  report,
  source,
  compact = false,
}: {
  report: GeneratedReport;
  source: string;
  compact?: boolean;
}) {
  const primary = report.capitalPartnerHandoff?.primary;
  const alternates = report.capitalPartnerHandoff?.alternates ?? [];
  const shownKeyRef = useRef<string | null>(null);
  const intakeUrl = useMemo(() => {
    const raw = primary?.intakeUrl || primary?.website;
    return raw ? addPartnerReferralAttribution(raw, primary?.partnerId) : null;
  }, [primary]);

  useEffect(() => {
    if (!primary || compact) return;
    const key = `${reportKey(report)}|${primary.partnerId}|${source}`;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    const payload = eventPayload(report, source, primary);
    trackEvent("capital_partner_shown", {
      ...payload,
      metadata: {
        ...payload.metadata,
        alternateCount: report.capitalPartnerHandoff?.alternates.length || 0,
      },
    });
  }, [compact, primary, report, source]);

  if (!primary || compact) return null;

  const trackContact = (
    match: CapitalPartnerMatch,
    contactMethod: "website" | "email" | "phone",
  ) => {
    trackEvent(
      contactMethod === "website" ? "capital_partner_clicked" : "capital_partner_contact_started",
      eventPayload(report, source, match, contactMethod),
    );
  };

  return (
    <section className="scroll-mt-20 border-b border-[#0C1B33]/8 bg-[#F5F8FF] px-5 py-6 sm:px-12 md:px-16 print:bg-white">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.22em] text-[#2563EB]/70">
            Resource to explore
          </div>
          <h2 className="font-editorial text-[24px] leading-tight text-[#0C1B33] sm:text-[28px]">
            {primary.name} may be relevant to your plans
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/55">
            This organization provides financing and project-support services. Review its offerings to decide whether contacting the organization makes sense for your project.
          </p>
          {primary.fitNote && (
            <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/45">
              <span className="font-semibold text-[#0C1B33]/60">Organization focus:</span>{" "}
              {primary.fitNote}
            </p>
          )}
          <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#0C1B33]/40">
            Informational only. This listing is not an endorsement, approval, or eligibility decision. Other public, community, financing, and program reviews may apply. We have not shared your information.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:max-w-md lg:flex-wrap lg:justify-end">
          {intakeUrl && (
            <a
              href={intakeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackContact(primary, "website")}
              className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#1E3054]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View organization
            </a>
          )}
          {primary.contactEmail && (
            <a
              href={`mailto:${primary.contactEmail}`}
              onClick={() => trackContact(primary, "email")}
              className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#0C1B33]/15 bg-white px-4 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/65 transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </a>
          )}
          {primary.phone && (
            <a
              href={`tel:${primary.phone.replace(/[^\d+]/g, "")}`}
              onClick={() => trackContact(primary, "phone")}
              className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#0C1B33]/15 bg-white px-4 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/65 transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
        </div>
      </div>

      {alternates.length > 0 && (
        <details className="group mt-5 border-t border-[#0C1B33]/10 pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/55 marker:content-none">
            Explore additional resources
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 divide-y divide-[#0C1B33]/8 border-y border-[#0C1B33]/8">
            {alternates.map((match) => {
              const url = match.intakeUrl || match.website;
              const attributedUrl = url
                ? addPartnerReferralAttribution(url, match.partnerId)
                : null;

              return (
                <div
                  key={match.partnerId}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#0C1B33]/75">{match.name}</p>
                    {match.fitNote && (
                      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[#0C1B33]/45">
                        {match.fitNote}
                      </p>
                    )}
                  </div>
                  {attributedUrl && (
                    <a
                      href={attributedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackContact(match, "website")}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-[#0C1B33]/15 bg-white px-4 py-2.5 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/65 transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View organization
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
