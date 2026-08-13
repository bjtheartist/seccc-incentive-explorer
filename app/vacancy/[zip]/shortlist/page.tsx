/**
 * SITE SHORTLIST — the back half of the /locate Site Matchmaker.
 *
 * The wizard collects criteria; this page turns those criteria plus PR1's
 * canonical, complete, zoning-resolved universe (data/exports/shortlist-
 * universe/<zip>.json — see lib/shortlist-universe.ts) into ONE globally
 * ranked list of candidate properties with zoning-screen badges.
 *
 * HARD CUTOVER (PR2): the capped `edition.sitePoints` path this page used to
 * screen against is REMOVED, not kept as a fallback — it produced a known
 * false-zero (60621: 1,541 tracked buildings, zero building sitePoints).
 * Every candidate now comes from the canonical universe loader, which is
 * fail-closed by contract: any missing/invalid/mismatched universe file
 * renders the honest "temporarily unavailable" state below, never a false
 * "zero sites match".
 *
 * NO REQUEST-TIME ZONING OR OVERLAY RESOLUTION runs in this file. PR1's
 * export-time zoning + overlay fields on every universe row are the ONLY
 * source for badge/membership — the old finalist-only `resolveZoneClasses` /
 * `checkStaticZoneKeys` calls this page used to make are gone entirely (see
 * the PR2 build spec's "no request-time zoning in the selection path" rule
 * and the consult's Q6.1).
 *
 * Server component, static-first: the universe, rail stations, and the
 * display-only amenity/expressway context are all read from committed files
 * here; the pure ranking runs in lib/shortlist-engine.ts; the only
 * request-time work anywhere in this feature is the finalist county/license
 * enrichment the client island fires for the ≤20 cards actually rendered.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { getVacancyIndexEdition, loadVacancyIndex } from "@/lib/vacancy-index";
import { railStations } from "@/lib/rail-stations";
import { loadShortlistUniverse } from "@/lib/shortlist-universe";
import { loadShortlistAmenityPoints, loadShortlistExpresswayContext } from "@/lib/shortlist-display-context";
import {
  RANKING_MODEL_VERSION,
  SHORTLIST_TOP_N,
  ZONING_SCREENING_NOTE,
  decorateShortlistDisplayFacts,
  runShortlistEngine,
  selectedTransitNetwork,
  type ShortlistFunnelStats,
} from "@/lib/shortlist-engine";
import {
  buildSiteMatchmakerHref,
  decodeSiteMatchCriteria,
  isSiteMatchCriteriaReady,
  shortlistRankingModelVersionSupported,
  siteMatchCriteriaVersionSupported,
  summarizeSiteMatchCriteria,
} from "@/lib/site-matchmaker";
import { selectedNonScoringCriteria } from "@/lib/shortlist-criteria";
import ShortlistFunnelEvent from "@/components/vacancy/ShortlistFunnelEvent";
import SiteShortlistResults from "@/components/vacancy/SiteShortlistResults";

export const dynamic = "force-dynamic";

/** The canonical `sm_*` criteria parameters, plus the ZIP from the route. */
const CRITERIA_PARAMS = [
  "sm_v",
  "sm_rv",
  "sm_use",
  "sm_property",
  "sm_min_sqft",
  "sm_max_sqft",
  "sm_context",
  "sm_transport",
  "sm_transport_distance",
  "sm_walkability",
  "sm_pedestrian_activity",
  "sm_amenities",
] as const;

type ShortlistSearchParams = Record<string, string | string[] | undefined>;

function criteriaParams(zip: string, raw: ShortlistSearchParams): URLSearchParams {
  const params = new URLSearchParams({ zip });
  for (const key of CRITERIA_PARAMS) {
    const value = raw[key];
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value != null) params.set(key, value);
  }
  return params;
}

function firstParam(value: string | string[] | undefined): string | null {
  const result = Array.isArray(value) ? value[0] : value;
  return result?.trim() || null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  const entry = getPilotZipEntry(zip);
  if (!entry) return { title: "Site Shortlist" };
  return {
    title: `Site shortlist — ${entry.primaryNeighborhood} (ZIP ${zip})`,
    description: `A ranked shortlist of candidate vacant records in ${entry.primaryNeighborhood} (ZIP ${zip}), screened against your project criteria. Early possibilities from public records, not availability listings.`,
  };
}

/** The shared page chrome, so every state (unavailable, empty, uncovered,
 *  results) reads as the same document rather than four different pages. */
function Shell({ zip, children }: { zip: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex flex-wrap items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/locate" className="hover:text-[#2563EB]">
            Site Matchmaker
          </Link>
          <span>/</span>
          <Link href={`/vacancy/${zip}`} className="hover:text-[#2563EB]">
            ZIP {zip}
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">Shortlist</span>
        </nav>
        {children}
      </div>
    </div>
  );
}

/** The fail-closed state: missing/invalid universe file, buildId mismatch,
 *  unknown criteriaVersion, or a ranking-model version this build does not
 *  speak. NEVER a false "zero sites match" — a reader who hits this always
 *  gets a working link to the raw map instead. */
function UnavailableState({ zip }: { zip: string }) {
  return (
    <Shell zip={zip}>
      <h1 className="font-editorial text-[42px] leading-[0.96] sm:text-[52px]">Site shortlist</h1>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
        Ranked shortlist temporarily unavailable. The screened, ranked shortlist for this area could
        not be built right now.
      </p>
      <Link
        href={`/vacancy/${zip}/map`}
        className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
      >
        Open the full vacancy map instead →
      </Link>
    </Shell>
  );
}

const FUNNEL_STAGES: { key: keyof ShortlistFunnelStats; label: string; note?: string }[] = [
  { key: "trackedEvidence", label: "Tracked evidence in this ZIP matching your property type" },
  { key: "canonicalSites", label: "Canonical sites (deduped)" },
  {
    key: "withResolvedPin",
    label: "With a resolved PIN",
    note: "reference only — a missing PIN does not remove a record",
  },
  {
    key: "withMeasuredArea",
    label: "With a published measurement",
    note: "reference only unless you set a size band",
  },
  { key: "insideBand", label: "Inside your size band (or no band set)" },
  { key: "survivingTransitScreen", label: "Surviving the transit screen (or none configured)" },
];

/** The zero-result funnel (PR2 spec, consult Q6.5). Renders the REAL
 *  successive counts from the loaded universe — never "zero buildings
 *  matched" when buildings exist but lack PIN/measurement coverage; the
 *  funnel names exactly which stage filtered them. 60621's building search
 *  is the canonical case this exists for (1,541 tracked buildings; most
 *  lack a resolved PIN or a published measurement, not zero coverage). */
function FunnelSection({
  zip,
  funnel,
  adjustHref,
}: {
  zip: string;
  funnel: ShortlistFunnelStats;
  adjustHref: string;
}) {
  return (
    <section className="mt-8 border border-[#0C1B33]/12 bg-white p-6">
      <ShortlistFunnelEvent zip={zip} funnel={funnel} />
      <h2 className="font-editorial text-[22px] leading-tight">
        {funnel.trackedEvidence === 0 ? "No tracked evidence for this property type" : "Nothing cleared the screens"}
      </h2>
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[#0C1B33]/65">
        {funnel.trackedEvidence > 0
          ? "Records exist for this area and property type — here is exactly which screen narrowed the field, so this is never reported as a bare zero."
          : "This area's canonical universe carries no tracked evidence for the property type you selected."}
      </p>
      {funnel.trackedEvidence > 0 && (
        <ol className="mt-4 grid gap-1.5 font-mono-bureau text-[11px] text-[#0C1B33]/70">
          {FUNNEL_STAGES.map((stage) => (
            <li key={stage.key} className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#0C1B33]/10 py-1">
              <span>
                {stage.label}
                {stage.note ? <span className="text-[#0C1B33]/40"> ({stage.note})</span> : null}
              </span>
              <span className="tabular-nums text-[#0C1B33]">
                {funnel[stage.key].toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <Link
        href={adjustHref}
        className="mt-5 inline-flex min-h-11 items-center bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
      >
        Adjust the criteria →
      </Link>
    </section>
  );
}

export default async function SiteShortlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<ShortlistSearchParams>;
}) {
  const { zip } = await params;
  const pilotEntry = getPilotZipEntry(zip);
  if (!pilotEntry) notFound();

  const raw = await searchParams;
  const rawParams = criteriaParams(zip, raw);
  const source = firstParam(raw.source);
  const neighborhood = pilotEntry.primaryNeighborhood;

  // ── Unknown criteriaVersion or ranking-model version: fail closed, never a
  //    silent decode (Finding 5: `sm_rv` is a SEPARATE, request-level check
  //    from `sm_v` — an old bookmarked shortlist URL that predates a ranking
  //    semantics change must not silently receive the new ranking). ────────
  if (!siteMatchCriteriaVersionSupported(rawParams) || !shortlistRankingModelVersionSupported(rawParams)) {
    return <UnavailableState zip={zip} />;
  }

  const criteria = decodeSiteMatchCriteria(rawParams);

  // ── No usable criteria: send the reader back to build a brief ─────────────
  if (!isSiteMatchCriteriaReady(criteria)) {
    return (
      <Shell zip={zip}>
        <h1 className="font-editorial text-[42px] leading-[0.96] sm:text-[52px]">
          Site shortlist
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          A shortlist needs a project brief to screen against — at minimum an area, a project use,
          and a property type. Build one in the Site Matchmaker and the ranked shortlist for{" "}
          {neighborhood} will open from there.
        </p>
        <Link
          href={buildSiteMatchmakerHref({ ...criteria, zip })}
          className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          Describe your project in the Site Matchmaker →
        </Link>
      </Shell>
    );
  }

  const summary = summarizeSiteMatchCriteria(criteria);
  const adjustHref = buildSiteMatchmakerHref(criteria);

  // ── Fail-closed: missing/invalid universe, buildId mismatch ───────────────
  const universe = loadShortlistUniverse(zip);
  if (!universe.ok) {
    return <UnavailableState zip={zip} />;
  }
  // ── Fail-closed: a ranking-inputs version this build's engine does not
  //    speak. The schema already rejects any file whose literal
  //    rankingInputsVersion !== RANKING_INPUTS_VERSION at load time; this is
  //    a second, explicit, testable check tying the loaded data to the
  //    ENGINE's own version constant rather than relying only on the schema.
  if (universe.data.rankingInputsVersion !== RANKING_MODEL_VERSION) {
    return <UnavailableState zip={zip} />;
  }

  const edition = getVacancyIndexEdition(zip);

  // ── ZIP without a published vacancy edition: the same honest state as its
  //    siblings (needed for the map panel's boundary/centroid). ──────────────
  if (!edition) {
    return (
      <Shell zip={zip}>
        <h1 className="font-editorial text-[42px] leading-[0.96] sm:text-[52px]">
          Site shortlist
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          The vacancy edition for {neighborhood} (ZIP {zip}) is not yet available, so no candidate
          records can be screened. Read the{" "}
          <Link href={`/vacancy/${zip}/report`} className="text-[#2563EB] hover:underline">
            full vacancy report
          </Link>{" "}
          for what public records currently show, or{" "}
          <Link href={adjustHref} className="text-[#2563EB] hover:underline">
            choose another area
          </Link>
          .
        </p>
      </Shell>
    );
  }

  // ── Run the full-universe, criteria-relative engine (core pass only — no
  //    display-only geometry here, see Finding 11) ───────────────────────────
  const stations = railStations();
  const { ranked: allRanked, funnel, railDataUnavailable } = runShortlistEngine({
    rows: universe.data.rows,
    criteria,
    stations,
    sourceRecordsByEvidenceType: universe.data.counts.sourceRecordsByEvidenceType,
  });

  // ── Fail-closed: a selected CTA/Metra criterion whose station SOURCE is
  //    unavailable (Finding 8) — never silently rank as if it were unselected.
  if (railDataUnavailable) {
    return <UnavailableState zip={zip} />;
  }

  // ── Slice to the rendered top N, THEN decorate with display-only geometry
  //    (Finding 11) — nearest school/library/expressway/rail-when-unscored
  //    are computed for these ≤20 candidates only, never the full screened
  //    universe (up to 6,000+ rows for the largest committed ZIP). ──────────
  const ranked = decorateShortlistDisplayFacts(allRanked.slice(0, SHORTLIST_TOP_N), {
    stations,
    network: selectedTransitNetwork(criteria, stations),
    expresswayContextByKey: loadShortlistExpresswayContext(zip),
    schoolPoints: loadShortlistAmenityPoints("school-points.json"),
    libraryPoints: loadShortlistAmenityPoints("library-points.json"),
  });

  const generatedAt = universe.data.generatedAt ?? loadVacancyIndex()?.generatedAt ?? null;
  const chips = [
    summary.projectUse,
    summary.propertyType,
    summary.footprint,
    summary.transportation,
    summary.transportationDistance,
  ].filter((chip) => chip && !/not selected$|^Flexible /.test(chip));

  // REGISTRY-UI BINDING: every selected criterion the engine cannot screen
  // or score on gets its own honest label here, in the registry's own words
  // (lib/shortlist-criteria.ts) — never silence, never a generic "no
  // effect". Screen/score criteria are already visible in the results
  // themselves (badges, the transit fact on scored cards) and are not
  // repeated here.
  const nonScoringCriteria = selectedNonScoringCriteria({
    projectUse: criteria.projectUse,
    propertyType: criteria.propertyType != null,
    squareFootage: criteria.minSquareFeet != null || criteria.maxSquareFeet != null,
    transportation: criteria.transportation,
    transportationDistance: criteria.transportationDistance != null,
    context: criteria.context != null,
    walkability: criteria.walkability != null,
    pedestrianActivity: criteria.pedestrianActivity != null,
    amenities: criteria.amenities,
  });

  return (
    <Shell zip={zip}>
      <header>
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Site shortlist · {summary.location}
        </span>
        <h1 className="mt-3 font-editorial text-[42px] leading-[0.96] sm:text-[54px]">
          {ranked.length > 0
            ? `${ranked.length} candidate ${ranked.length === 1 ? "record" : "records"} in ${neighborhood}`
            : `No records match this brief in ${neighborhood}`}
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/60">
          Screened from this area&rsquo;s complete tracked vacant-property universe against your
          brief, then ranked. These are early possibilities from public records, not availability
          listings — no record here is offered for sale or lease.
          {allRanked.length > ranked.length && (
            <>
              {" "}
              {allRanked.length.toLocaleString("en-US")} records cleared the screens; the{" "}
              {ranked.length} highest-ranked are shown.
            </>
          )}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="border border-[#0C1B33]/15 bg-white px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/60"
            >
              {chip}
            </span>
          ))}
          <Link
            href={adjustHref}
            className="border border-[#2563EB] px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white"
          >
            Adjust criteria
          </Link>
        </div>

        <p className="mt-4 max-w-2xl border-l-2 border-[#A45B00]/40 pl-3 text-[12px] leading-relaxed text-[#A45B00]">
          {ZONING_SCREENING_NOTE}
        </p>

        {nonScoringCriteria.length > 0 && (
          <div className="mt-3 max-w-2xl border-l-2 border-[#0C1B33]/15 pl-3">
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              Selected criteria with no ranking effect
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {nonScoringCriteria.map((entry) => (
                <li key={entry.id} className="text-[12px] leading-relaxed text-[#0C1B33]/55">
                  <span className="font-semibold text-[#0C1B33]/70">
                    {entry.label}
                    {entry.behavior === "display-only" ? " (shown, not scored)" : " (not supported)"}:
                  </span>{" "}
                  {entry.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {ranked.length === 0 ? (
        <FunnelSection zip={zip} funnel={funnel} adjustHref={adjustHref} />
      ) : (
        <SiteShortlistResults
          zip={zip}
          projectUse={criteria.projectUse}
          source={source}
          buildId={universe.data.buildId}
          ranked={ranked}
          // The map panel draws the same simplified ZIP ring the vacancy web
          // report uses; both read it from the committed edition, so the two
          // maps can never outline different geographies for the same ZIP.
          boundary={edition.boundary}
          centroid={edition.centroid}
        />
      )}

      <footer className="mt-12 border-t border-[#0C1B33]/10 pt-6">
        <p className="max-w-3xl text-[11px] leading-relaxed text-[#0C1B33]/45">
          Screened from the complete canonical vacant-property universe published for this area
          {generatedAt ? ` (snapshot ${String(generatedAt).slice(0, 10)})` : ""}. Sources: City of
          Chicago vacant-building and City-owned land records, Cook County Assessor parcel,
          valuation, and tax-sale data, the City of Chicago zoning boundary layer resolved locally
          against this snapshot, CTA and Metra station locations, Chicago Public Schools and Chicago
          Public Library locations, and the Special Service Area, CCSA corridor, TIF, and
          Neighborhood Opportunity Fund geographies mapped in this repository. Ownership is a
          taxpayer-record classification and is unverified — owner TYPE only, never owner names.
          The zoning badge on every card is a broad district-family screen only. Records indicate;
          verify current ownership, zoning, condition, and status with the county and the
          responsible City department before relying on any of it.
        </p>
      </footer>
    </Shell>
  );
}
