import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { buildCaseRecords } from "@/lib/vacancy-cases-data";
import { getVacancyIndexEdition } from "@/lib/vacancy-index";
import {
  caseMatches,
  deriveAllCases,
  deriveCase,
  isLandUniverseTruncated,
  parseCaseParam,
  type CaseKey,
  type DerivedCase,
} from "@/lib/vacancy-cases";
import {
  buildVacancyCaseHref,
  parseWorkspaceBounds,
  parseWorkspaceQuery,
  parseWorkspaceUniverse,
  parseWorkspaceView,
} from "@/lib/vacancy-workspace";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { CopyCaseLink } from "@/components/vacancy/CopyCaseLink";
import { CaseCardLink } from "@/components/vacancy/CaseCardLink";
import CaseWorkspace from "@/components/vacancy/CaseWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Find Vacant Sites" };
  return {
    title: `Find Vacant Sites — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `Choose what you need to do, then review matching public vacancy records in ${entry.primaryNeighborhood} (ZIP ${zip}). Early possibilities from public records, not availability listings.`,
  };
}

/** One selectable case-type card. Its server href is shareable without JS; the
 * client wrapper keeps it synchronized with live workspace filters. */
function CaseCard({
  zip,
  card,
  selected,
  workspaceParams,
}: {
  zip: string;
  card: DerivedCase;
  selected: boolean;
  workspaceParams: URLSearchParams;
}) {
  return (
    <CaseCardLink
      zip={zip}
      caseKey={card.key}
      initialHref={`${buildVacancyCaseHref(zip, card.key, workspaceParams)}#case-results`}
      selected={selected}
      className={`group flex min-h-[72px] flex-col justify-center border bg-white px-4 py-3 transition-colors ${
        selected
          ? "border-[#0C1B33] bg-[#EAF1FF]/45"
          : "border-[#0C1B33]/12 hover:border-[#2563EB]/45"
      }`}
    >
      <span>
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
    </CaseCardLink>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Convert the server request into the same shareable workspace posture used by
 * the live case links after hydration. */
function workspaceSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["view", "q", "universe", "bounds"] as const) {
    const value = firstParam(params[key]);
    if (value) query.set(key, value);
  }
  return query;
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

  const [{ records, recordsAsOf, universe }, resolvedParams] = await Promise.all([
    Promise.resolve(buildCaseRecords(zip)),
    searchParams,
  ]);
  const activeKey: CaseKey = parseCaseParam(resolvedParams.case);
  const initialView = parseWorkspaceView(resolvedParams.view);
  const initialUniverse = parseWorkspaceUniverse(resolvedParams.universe);
  const initialQuery = parseWorkspaceQuery(resolvedParams.q);
  const initialBounds = parseWorkspaceBounds(resolvedParams.bounds);
  const workspaceParams = workspaceSearchParams(resolvedParams);
  const landTruncated = isLandUniverseTruncated(universe);
  const cards = deriveAllCases(records);
  const active = deriveCase(activeKey, records);
  const activeRecords = records.filter((record) => caseMatches(activeKey, record));
  const neighborhood = pilotEntry.primaryNeighborhood;
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
          <h1 className="font-editorial text-[44px] leading-none">Find vacant sites</h1>
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
        <div className="max-w-2xl">
          <h1 className="font-editorial text-[46px] leading-[0.95] sm:text-[60px]">
            Find vacant sites
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/60">
            Choose what you need to do, then review the matching public records in one list or map.
          </p>
          {recordsAsOf && (
            <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
              Public records as of {recordsAsOf}
            </p>
          )}
        </div>

        {/* Choose a starting point */}
        <section className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
                Start here
              </span>
              <h2 className="mt-2 font-editorial text-[26px] leading-tight text-[#0C1B33]">
                What do you need to do?
              </h2>
            </div>
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              Choose one pathway.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {cards.map((card) => (
              <CaseCard
                key={card.key}
                zip={zip}
                card={card}
                selected={card.key === active.key}
                workspaceParams={workspaceParams}
              />
            ))}
          </div>
        </section>

        {/* Compact selected-path summary. Methodology remains available on
            demand without competing with the records workspace. */}
        <section
          id="case-results"
          className="mt-6 scroll-mt-6 border border-[#0C1B33]/10 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <span className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.14em] text-[#2563EB]">
                Selected pathway
              </span>
              <h2 className="mt-2 font-editorial text-[28px] leading-tight text-[#0C1B33]">
                {active.name}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[#0C1B33]/70">
                {active.definition}
              </p>
            </div>
            <CopyCaseLink caseKey={active.key} />
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-y border-[#0C1B33]/10 py-3">
            <p className="text-[12px] text-[#0C1B33]/70">
              <strong className="font-semibold text-[#0C1B33]">
                {active.landCount.toLocaleString("en-US")}
              </strong>{" "}
              land {active.landCount === 1 ? "parcel" : "parcels"}
            </p>
            <p className="text-[12px] text-[#0C1B33]/70">
              <strong className="font-semibold text-[#0C1B33]">
                {active.buildingCount.toLocaleString("en-US")}
              </strong>{" "}
              building {active.buildingCount === 1 ? "report" : "reports"}
            </p>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/50">{active.caveat}</p>

          <details className="mt-3 border-t border-[#0C1B33]/10 pt-3">
            <summary className="cursor-pointer font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
              How these counts work
            </summary>
            <div className="mt-3 max-w-2xl space-y-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
              <p>
                This pathway is measured against {universe.land.toLocaleString("en-US")} land{" "}
                {universe.land === 1 ? "parcel" : "parcels"} and{" "}
                {universe.building.toLocaleString("en-US")} reported{" "}
                {universe.building === 1 ? "building" : "buildings"} tracked in this ZIP.
              </p>
              <p>
                Land is the reconciled land universe: City land inventory and Assessor vacant-land
                parcels, deduplicated. It is wider than the{" "}
                <Link href={`/vacancy/${zip}/directory`} className="text-[#2563EB] hover:underline">
                  All Properties directory
                </Link>
                , which lists tracked City-inventory and 311 records address by address.
              </p>
              {landTruncated && universe.landTotal != null && (
                <p className="border-l-2 border-[#A45B00]/40 pl-3 text-[#A45B00]">
                  This edition publishes {universe.land.toLocaleString("en-US")} of the ZIP&rsquo;s{" "}
                  {universe.landTotal.toLocaleString("en-US")} reconciled land parcels, so the land
                  counts are a floor, not a total. The{" "}
                  <Link href={`/vacancy/${zip}/report`} className="underline">
                    full vacancy report
                  </Link>{" "}
                  carries the complete land-universe table.
                </p>
              )}
            </div>
          </details>
        </section>

        <CaseWorkspace
          key={`${zip}:${active.key}`}
          zip={zip}
          neighborhood={neighborhood}
          caseKey={active.key}
          records={activeRecords}
          boundary={edition?.boundary ?? null}
          centroid={edition?.centroid ?? null}
          initialView={initialView}
          initialUniverse={initialUniverse}
          initialQuery={initialQuery}
          initialBounds={initialBounds}
        />

        {/* Permit activity remains a distinct, community-area analysis. A
            single entry link keeps this page focused on property records. */}
        <section className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-[#0C1B33]/10 bg-white px-5 py-4">
          <div>
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#2563EB]">
              Development signals
            </span>
            <h2 className="mt-1 font-editorial text-[21px] leading-tight text-[#0C1B33]">
              Permit activity analysis
            </h2>
            <p className="mt-1 text-[11px] text-[#0C1B33]/50">
              See recorded permit volume, project mix, and recent activity by community area.
            </p>
          </div>
          <Link
            href="/permit-activity"
            className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
          >
            Choose a neighborhood →
          </Link>
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
