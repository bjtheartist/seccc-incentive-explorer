"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import { ReasonChips } from "@/components/report/ReasonChips";
import { selectedProjectGoalLabels } from "@/lib/report-wizard-config";
import { buildLocationSnapshot } from "@/lib/report-looking-overview";
import { personaSummaryProgramNames } from "@/lib/report-personas";
import { DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import { SITE_URL } from "@/lib/seo";
import {
  SECTION_IDS,
  type GeneratedReport,
  type ReportItem,
} from "@/lib/report-engine";

export const PERSONA_SCREENING_DISCLOSURE =
  "Screening report from public records — not an eligibility determination. Full record one line below. Confirm zoning with the Zoning Board of Appeals.";

const PERSONA_BOARD_LABEL: Record<Exclude<PersonaId, "all">, string> = {
  starting: "Business owner",
  growing: "Business owner",
  supporter: "Supporting businesses",
  developer: "Developer",
  looking: "Just looking",
};

function dataVerifiedMonth(report: GeneratedReport): string | null {
  const generated = new Date(report.generatedAt);
  return Number.isNaN(generated.getTime())
    ? null
    : generated.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function civicCommunityArea(report: GeneratedReport): string | null {
  const civic = report.sections?.find(
    (section) =>
      section.id === SECTION_IDS.civicRepresentation ||
      section.title === "Civic Representation" ||
      section.title === "Civic representation",
  );
  return (
    report.communityAssets?.communityArea ||
    report.corridorInvestment?.communityArea ||
    civic?.items.find((item) => item.label === "Community area")?.value ||
    report.neighborhoodEconomics?.anchorGeography ||
    null
  );
}

function reportZip(report: GeneratedReport): string | null {
  return [report.metadata?.address, report.title, report.subtitle]
    .filter(Boolean)
    .join(" ")
    .match(/\b606\d{2}\b/)?.[0] ?? null;
}

function displayAddress(report: GeneratedReport): string {
  const raw = report.metadata?.address || report.title || "Chicago location";
  const street = raw.replace(/,?\s+Chicago(?:,?\s+IL)?\s+606\d{2}.*$/i, "").trim();
  const communityArea = civicCommunityArea(report);
  const zip = reportZip(report);
  if (communityArea) return `${street} · ${communityArea}${zip ? ` (${zip})` : ""}`;
  return zip && !street.includes(zip) ? `${street} · ${zip}` : street;
}

function reportGoalLine(report: GeneratedReport, persona: PersonaId): string {
  const goals = selectedProjectGoalLabels({
    projectGoals: report.metadata?.projectGoals,
    projectType: report.metadata?.projectType,
    customGoal: report.metadata?.customGoal,
  });
  if (goals.length > 0) return `Goal: ${goals.join(", ")}`;
  if (persona === "looking") return "Getting oriented — no goal set yet";
  return "Goal: Review the programs and next steps mapped to this address";
}

export function PersonaReportHeader({
  report,
  persona,
  onSwitchToAll,
  compact = false,
}: {
  report: GeneratedReport;
  persona: Exclude<PersonaId, "all">;
  onSwitchToAll: () => void;
  compact?: boolean;
}) {
  const label = PERSONA_BOARD_LABEL[persona];
  return (
    <header
      data-testid="persona-report-header"
      className={`${compact ? "px-4 py-5" : "px-5 py-7 sm:px-12 md:px-16"} border-b-2 border-[#0C1B33] bg-[#FAF9F6]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono-bureau text-[10px] tracking-[0.14em] uppercase text-[#2563EB]">
          Location report · {label}
        </p>
        <button
          type="button"
          onClick={onSwitchToAll}
          className="border border-[#D8DDE6] bg-white px-2 py-1 font-mono-bureau text-[9px] tracking-[0.08em] uppercase text-[#5A6478] transition-colors hover:border-[#2563EB] hover:text-[#2563EB] print:hidden"
        >
          Viewing as {label} · Switch to All
        </button>
      </div>
      <h1 className={`${compact ? "text-xl" : "text-[23px]"} mt-2 font-editorial font-bold leading-tight text-[#0C1B33]`}>
        {displayAddress(report)}
      </h1>
      <p className="mt-1 text-[13px] text-[#5A6478]">{reportGoalLine(report, persona)}</p>
    </header>
  );
}

export function PersonaGuidepostBand({ part }: { part: 1 | 2 | 3 }) {
  const label = {
    1: "Site & Standing",
    2: "Capital & Programs",
    3: "Partners & Next Steps",
  }[part];
  return (
    <div data-testid={`guidepost-part-${part}`} className="mt-10 mb-5 flex items-center gap-3">
      <span className="bg-[#0C1B33] px-2.5 py-1 font-mono-bureau text-[10px] tracking-[0.18em] text-white">
        PART {String(part).padStart(2, "0")}
      </span>
      <span className="font-editorial text-[19px] font-bold text-[#0C1B33]">{label}</span>
      <span className="h-[2px] flex-grow bg-[#0C1B33]" />
    </div>
  );
}

export function PersonaSectionHeading({
  number,
  title,
}: {
  number: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex items-baseline gap-2.5">
      <span className="font-mono-bureau text-[10px] text-[#2563EB]">{number}</span>
      <h2 className="font-editorial text-[15.5px] font-semibold normal-case tracking-normal text-[#0C1B33]">
        {title}
      </h2>
    </div>
  );
}

export function PersonaReportSection({
  number,
  title,
  children,
  id,
  testId,
  className = "",
}: {
  number: string;
  title: string;
  children: ReactNode;
  id?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={`border-b border-[#D8DDE6] py-4 ${className}`}
    >
      <PersonaSectionHeading number={number} title={title} />
      {children}
    </section>
  );
}

export function PersonaExecutiveSummary({
  report,
  programsAnchor,
  sectionNumber,
}: {
  /** Report whose visible program set the summary must describe. */
  report: GeneratedReport;
  programsAnchor: string;
  /** Looking renders this panel as numbered "Location snapshot" in PART 01. */
  sectionNumber?: string;
}) {
  const snapshot = buildLocationSnapshot(report);
  const names = personaSummaryProgramNames(report);
  const tiles = [
    snapshot.zoneClass ? { label: "Zoning", value: snapshot.zoneClass } : null,
    snapshot.mappedZoneCount != null
      ? { label: "Mapped zones", value: String(snapshot.mappedZoneCount) }
      : null,
    { label: "Programs", value: String(snapshot.programCount) },
    snapshot.dataVerified ? { label: "Data verified", value: snapshot.dataVerified } : null,
  ].filter((tile): tile is { label: string; value: string } => Boolean(tile));

  const panel = (
    <div
      data-testid="persona-executive-summary"
      className="grid grid-cols-2 gap-3 border-2 border-[#0C1B33] bg-white p-4 sm:grid-cols-4"
    >
      <div className="col-span-2 border-b border-[#E4ECF7] pb-1.5 font-mono-bureau text-[8.5px] tracking-[0.16em] uppercase text-[#0C1B33] sm:col-span-4">
        Executive summary
      </div>
      {tiles.map((tile) => (
        <div key={tile.label}>
          <span className="block font-mono-bureau text-[8.5px] tracking-[0.14em] uppercase text-[#5A6478]">
            {tile.label}
          </span>
          <span className="font-mono-bureau text-[15px] text-[#0C1B33]">{tile.value}</span>
        </div>
      ))}
      {names.length > 0 && (
        <div className="col-span-2 border-t border-[#E4ECF7] pt-2 sm:col-span-4">
          <span className="block font-mono-bureau text-[8.5px] tracking-[0.14em] uppercase text-[#5A6478]">
            Programs matched here
          </span>
          <p
            data-testid="persona-summary-programs"
            className="mt-0.5 text-[12.5px] leading-relaxed text-[#0C1B33]"
          >
            {names.map((program, index) => (
              <span key={program.programId}>
                {index > 0 && " · "}
                <a href={programsAnchor ? `#${programsAnchor}` : undefined} className="text-[#2563EB] hover:underline">
                  {program.label}
                </a>
              </span>
            ))}{" "}
            <span className="text-[#5A6478]">— details below</span>
          </p>
        </div>
      )}
      <p className="col-span-2 border-t border-[#E4ECF7] pt-2 text-[10.5px] leading-relaxed text-[#5A6478] sm:col-span-4">
        {PERSONA_SCREENING_DISCLOSURE}
      </p>
    </div>
  );

  if (!sectionNumber) return <div className="mb-5">{panel}</div>;
  return (
    <PersonaReportSection
      number={sectionNumber}
      title="Location snapshot"
      testId="location-snapshot"
    >
      {panel}
    </PersonaReportSection>
  );
}

export function PersonaAlsoAtAddress({
  items,
}: {
  items: ReportItem[];
}) {
  return (
    <details
      data-testid="persona-also-at-address"
      className="group/also my-2 border border-[#D8DDE6] bg-white text-[12.5px] text-[#5A6478]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
        <span className="flex-shrink-0 transition-transform group-open/also:rotate-90">
          <ChevronRight aria-hidden="true" className="h-3 w-3" />
        </span>
        <span>Also at this address ({items.length})</span>
      </summary>
      <div
        data-testid="persona-also-program-list"
        className="divide-y divide-[#D8DDE6] border-t border-[#D8DDE6] px-3.5"
      >
        {items.map((item) => (
          <details
            key={item.programId ?? item.label}
            data-testid="persona-also-program"
            data-program-id={item.programId}
            className="group/program text-[#0C1B33]"
          >
            <summary className="flex cursor-pointer list-none items-start gap-2 py-3.5 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
              <span className="mt-0.5 flex-shrink-0 text-[#5A6478] transition-transform group-open/program:rotate-90">
                <ChevronRight aria-hidden="true" className="h-3 w-3" />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[13px] font-semibold">{item.label}</span>
                {item.value && (
                  <span className="font-mono-bureau text-[10px] text-[#5A6478]">
                    {item.value}
                  </span>
                )}
              </span>
            </summary>
            <article
              data-testid="persona-also-program-details"
              className="border-t border-[#D8DDE6] pb-4 pt-3 pl-5 text-[#0C1B33] sm:pl-6"
            >
              <ProgramCardFace item={item} />
              <ReasonChips explanation={item.matchExplanation} />
              <ProgramCardExtras item={item} />
            </article>
          </details>
        ))}
      </div>
    </details>
  );
}

export function PersonaReportFooter({ report }: { report: GeneratedReport }) {
  const labels = report.dataSources?.map((source) => source.label) ?? [];
  const sources: string[] = [];
  if (labels.some((label) => /city of chicago/i.test(label))) sources.push("City of Chicago");
  if (labels.some((label) => /cook county.*assessor|assessor.*cook county/i.test(label))) {
    sources.push("Cook County Assessor");
  }
  for (const label of labels) {
    if (sources.length >= 2) break;
    if (!sources.includes(label)) sources.push(label);
  }
  if (sources.length === 0) sources.push("Public records");
  const verified = dataVerifiedMonth(report);
  const hostname = (() => {
    try {
      return new URL(SITE_URL).hostname.replace(/^www\./, "");
    } catch {
      return "chicagoincentiveexplorer.com";
    }
  })();
  return (
    <footer data-testid="persona-report-footer" className="mt-5 text-[10.5px] leading-relaxed text-[#5A6478]">
      {sources.join(" · ")}
      {verified ? ` · verified ${verified}` : ""} · {hostname}
    </footer>
  );
}

export function isRealPersona(persona: PersonaId): persona is Exclude<PersonaId, "all"> {
  return persona !== DEFAULT_PERSONA;
}
