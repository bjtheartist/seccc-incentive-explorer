import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { buildCaseRecords } from "@/lib/vacancy-cases-data";
import { getVacancyIndexEdition } from "@/lib/vacancy-index";
import {
  deriveAllCases,
  deriveCase,
  parseCaseParam,
  type CaseKey,
  type DerivedCase,
  type VacancyCaseArea,
} from "@/lib/vacancy-cases";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { CopyCaseLink } from "@/components/vacancy/CopyCaseLink";
import { CaseAreaSwitcher } from "@/components/vacancy/CaseAreaSwitcher";
import CasePreviewMapIsland from "@/components/vacancy/CasePreviewMapIsland";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Case Workbench" };
  return {
    title: `Case Workbench — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `Start with the decision you are moving forward: pick a kind of work and get an active case of matching vacant records in ${entry.primaryNeighborhood} (ZIP ${zip}). Early possibilities from public records, not availability listings.`,
  };
}

/** A minimal stroke glyph per case, drawn in currentColor (no icon library). */
function CaseGlyph({ caseKey }: { caseKey: CaseKey }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (caseKey) {
    case "public-land": // public building — columns
      return (
        <svg {...common}>
          <path d="M2.5 6 8 2.5 13.5 6" />
          <path d="M3.5 6v6M6.5 6v6M9.5 6v6M12.5 6v6" />
          <path d="M2.5 13.5h11" />
        </svg>
      );
    case "private-outreach": // outreach — arrow out
      return (
        <svg {...common}>
          <path d="M3 13 13 3" />
          <path d="M7 3h6v6" />
        </svg>
      );
    case "ownership-check": // magnifier
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4" />
          <path d="M10 10l3.5 3.5" />
        </svg>
      );
    case "building-review": // building
      return (
        <svg {...common}>
          <path d="M3 13.5V4l5-1.5V13.5" />
          <path d="M8 6.5l5 1.5v5.5" />
          <path d="M2.5 13.5h11" />
          <path d="M5 7v.01M5 9.5v.01M10.5 10v.01" />
        </svg>
      );
    case "tax-title": // document
      return (
        <svg {...common}>
          <path d="M4 2.5h5l3 3v8H4z" />
          <path d="M9 2.5v3h3" />
          <path d="M6 8.5h4M6 10.5h4" />
        </svg>
      );
  }
}

/** One selectable case-type card. A LINK (not a button) so selection is a
 *  server-rendered `?case=` navigation — shareable and JS-free. */
function CaseCard({
  zip,
  card,
  selected,
}: {
  zip: string;
  card: DerivedCase;
  selected: boolean;
}) {
  return (
    <Link
      href={`/vacancy/${zip}?case=${card.key}`}
      aria-current={selected ? "true" : undefined}
      className={`group flex min-h-[124px] flex-col justify-between bg-white p-4 transition-colors ${
        selected
          ? "border-2 border-[#0C1B33]"
          : "border border-[#0C1B33]/12 hover:border-[#2563EB]/45"
      }`}
    >
      <span
        className={`inline-flex h-7 w-7 items-center justify-center border ${
          selected
            ? "border-[#0C1B33] text-[#0C1B33]"
            : "border-[#0C1B33]/20 text-[#0C1B33]/55 group-hover:text-[#2563EB]"
        }`}
      >
        <CaseGlyph caseKey={card.key} />
      </span>
      <span className="mt-3">
        <span
          className={`block text-[13px] font-semibold leading-snug ${
            selected
              ? "text-[#0C1B33] underline decoration-[#2563EB] decoration-2 underline-offset-4"
              : "text-[#0C1B33]/85 group-hover:text-[#2563EB]"
          }`}
        >
          {card.name}
        </span>
        <span className="mt-1 block font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/50">
          {card.matches.toLocaleString("en-US")} matching {card.matches === 1 ? "record" : "records"}
        </span>
      </span>
    </Link>
  );
}

/** One stat tile in the active-case panel — serif numeral over a mono label. */
function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white px-4 py-4">
      <div className="font-editorial text-[40px] leading-none text-[#0C1B33]">
        {value.toLocaleString("en-US")}
      </div>
      <div className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/50">
        {label}
      </div>
    </div>
  );
}

export default async function CaseWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const [{ records, areas, recordsAsOf }, resolvedParams] = await Promise.all([
    Promise.resolve(buildCaseRecords(zip)),
    searchParams,
  ]);
  const activeKey: CaseKey = parseCaseParam(resolvedParams.case);
  const cards = deriveAllCases(records);
  const active = deriveCase(activeKey, records);
  const neighborhood = pilotEntry.primaryNeighborhood;
  const railAreas: VacancyCaseArea[] = areas.slice(0, 5);
  // Geography for the preview map — the SAME edition boundary/centroid the
  // property map page (/vacancy/[zip]/map) feeds VacancyReportMap. Records and
  // edition come from one cached load, so this costs nothing extra; a missing
  // edition renders the map without a boundary rather than failing.
  const edition = getVacancyIndexEdition(zip);

  // Honest empty state — the edition/export is not available for this ZIP.
  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
        <div className="mx-auto max-w-5xl">
          <VacancySubNav zip={zip} active="workbench" />
          <h1 className="font-editorial text-[44px] leading-none">Case Workbench</h1>
          <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-[#0C1B33]/50">
            The vacancy edition for {neighborhood} (ZIP {zip}) is not yet available, so no cases can
            be assembled. Read the{" "}
            <Link href={`/vacancy/${zip}/report`} className="text-[#2563EB] hover:underline">
              full vacancy report
            </Link>{" "}
            for what public records currently show.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <VacancySubNav zip={zip} active="workbench" />

        {/* Editorial header */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-editorial text-[46px] leading-[0.95] sm:text-[60px]">Case Workbench</h1>
            <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/60">
              Start with the decision you are trying to move forward. The same case can stay active
              across property records, nearby-site groups, and partner conversations.
            </p>
            {recordsAsOf && (
              <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
                Public records as of {recordsAsOf}
              </p>
            )}
          </div>
          <div className="sm:pt-2">
            <CaseAreaSwitcher zip={zip} neighborhood={neighborhood} />
          </div>
        </div>

        {/* Tab row — V1 ships Quick paths; "Build a case" is a link into the
            All Properties directory (no dead/stub tabs). */}
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[#0C1B33]/10 pb-3">
          <span className="border-b-2 border-[#2563EB] pb-2 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#2563EB]">
            Quick paths
          </span>
          <Link
            href={`/vacancy/${zip}/directory`}
            className="font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/45 transition-colors hover:text-[#0C1B33]/80"
          >
            Build a case in the directory →
          </Link>
        </div>

        {/* Choose a starting point */}
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
                Choose a starting point
              </span>
              <h2 className="mt-2 font-editorial text-[26px] leading-tight text-[#0C1B33]">
                What kind of work are you doing?
              </h2>
            </div>
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              One click creates a repeatable case.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {cards.map((card) => (
              <CaseCard key={card.key} zip={zip} card={card} selected={card.key === active.key} />
            ))}
          </div>
        </section>

        {/* Active case panel */}
        <section className="mt-8 border border-[#0C1B33]/10 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <span className="inline-block border border-[#0C1B33]/20 bg-[#0C1B33]/[0.03] px-2 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#0C1B33]/60">
                Active case
              </span>
              <h3 className="mt-3 font-editorial text-[32px] leading-tight text-[#0C1B33]">
                {active.name}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#0C1B33]/75">{active.definition}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">{active.caveat}</p>
            </div>
            <CopyCaseLink caseKey={active.key} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:max-w-md">
            <StatTile value={active.landCount} label="Land parcels" />
            <StatTile value={active.buildingCount} label="Building reports" />
          </div>
        </section>

        {/* Geographic preview + Opportunity-areas rail */}
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.55fr_1fr]">
          {/* Geographic preview */}
          <div className="border border-[#0C1B33]/10 bg-white">
            <div className="relative">
              <CasePreviewMapIsland
                zip={zip}
                points={active.points}
                boundary={edition?.boundary ?? null}
                centroid={edition?.centroid ?? null}
              />
              {/* Overlays sit ABOVE the map canvas (z-10) and stay
                  pointer-events-none so dragging the map still works. */}
              <div className="pointer-events-none absolute left-3 top-3 z-10 border border-[#0C1B33]/12 bg-white/90 px-2.5 py-1.5">
                <span className="block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#2563EB]">
                  Geographic preview
                </span>
                <span className="mt-0.5 block font-mono-bureau text-[10px] text-[#0C1B33]/60">
                  {active.mappedTotal.toLocaleString("en-US")} of {active.matches.toLocaleString("en-US")} mapped{" "}
                  {active.matches === 1 ? "match" : "matches"}
                  {/* The preview plots a CAPPED slice (CASE_POINT_CAP). The old
                      SVG hid that behind 400 identical dots; clustered dots
                      carry visible counts that sum to what is actually
                      plotted, so the cap has to be stated or the line is
                      falsifiable on its face. */}
                  {active.points.length < active.mappedTotal
                    ? ` · first ${active.points.length.toLocaleString("en-US")} plotted`
                    : " shown"}
                </span>
              </div>
              {/* bottom-7, not bottom-3: clears Mapbox's required attribution
                  strip in the bottom-right corner. */}
              <div className="pointer-events-none absolute bottom-7 right-3 z-10 border border-[#0C1B33]/12 bg-white/90 px-2.5 py-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/55">
                {neighborhood} · ZIP {zip}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[#0C1B33]/10 px-4 py-3">
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                Dots are matches that carry a coordinate
              </span>
              <Link
                href={`/vacancy/${zip}/map`}
                className="font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
              >
                Open the property map →
              </Link>
            </div>
          </div>

          {/* Opportunity-areas rail */}
          <aside>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
                  Nearby-site groups
                </span>
                <h2 className="mt-2 font-editorial text-[22px] leading-tight text-[#0C1B33]">
                  Opportunity areas
                </h2>
              </div>
              <Link
                href={`/vacancy/${zip}/areas`}
                className="flex-shrink-0 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
              >
                All areas →
              </Link>
            </div>

            {railAreas.length === 0 ? (
              <p className="mt-4 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                No opportunity areas yet
              </p>
            ) : (
              <ul className="mt-4 space-y-px border border-[#0C1B33]/10 bg-[#0C1B33]/10">
                {railAreas.map((area) => (
                  <li key={area.id} className="bg-white">
                    <Link
                      href={`/vacancy/${zip}/areas/${area.id}`}
                      className="group block px-4 py-3.5 transition-colors hover:bg-[#FAF9F6]"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-editorial text-[17px] leading-tight text-[#0C1B33] group-hover:text-[#2563EB]">
                          {area.name}
                        </span>
                        <span className="flex-shrink-0 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">
                          {area.siteCount} {area.siteCount === 1 ? "site" : "sites"}
                        </span>
                      </span>
                      <span className="mt-1 block font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">
                        {area.siteCount} nearby {area.siteCount === 1 ? "site" : "sites"}
                        {area.corridor ? ` · ${area.corridor} corridor` : ""}
                      </span>
                      <span className="mt-1.5 block text-[11px] leading-snug text-[#A45B00]">
                        {area.needsChecking}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </section>

        {/* Footer note — honest framing consistent with the rest of the section */}
        <footer className="mt-12 border-t border-[#0C1B33]/10 pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/45">
            Each case is a starting point built from public records — owner TYPE only, never owner
            names. Land parcels (the reconciled land universe) and reported vacant buildings (311
            service requests) are kept as separate counts and are never summed before parcel
            matching. Records indicate; verify current ownership, condition, and status with the
            county and the administering organization before relying.
          </p>
        </footer>
      </div>
    </div>
  );
}
