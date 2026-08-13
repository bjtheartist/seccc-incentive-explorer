"use client";

/**
 * The rendered half of the Site Shortlist: ONE ranked list of numbered
 * cards with zoning-screen badges, a client-side badge filter, one
 * request-time enrichment pass, and the CSV download.
 *
 * PR2 replaced the old 12/8 tier-quota split with a single globally ranked
 * top-20 list — see lib/shortlist-engine.ts. The filter below narrows what
 * is SHOWN; it never re-ranks or re-fetches, so the numbering a reader sees
 * always matches the numbering on the map and in the CSV for the full set.
 *
 * CLIENT ISLAND. It value-imports lib/shortlist-engine.ts, lib/shortlist-csv.ts,
 * and lib/site-shortlist.ts only — all three are pure by contract. It must
 * NEVER import lib/shortlist-universe.ts, lib/vacancy-index.ts, or
 * lib/rail-stations.ts (all read `node:fs`, which breaks the client build);
 * the server page does that work and hands the finished ranked list down.
 *
 * The enrichment fetch is fired ONCE per mount for every rendered card, and
 * its failure is a display state, not an error: the static half of each
 * card (size, ownership axes, overlays, rail, zoning badge) is already on
 * screen and stays there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics-events";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import {
  ZONING_BADGE_LABELS,
  type RankedShortlistCandidate,
  type ZoningBadge,
} from "@/lib/shortlist-engine";
import { shortlistCsv, shortlistCsvFilename } from "@/lib/shortlist-csv";
import {
  IMPLIED_VALUE_CAPTION,
  VIOLATION_FLAG,
  accessibilityNoteFor,
  activeLicenseFlag,
  shortlistSnapshotHref,
  taxSaleFlag,
  type ShortlistEnrichmentFacts,
} from "@/lib/site-shortlist";
import { shortlistCardDomId } from "@/lib/shortlist-map-layers";
import type { SiteProjectUse } from "@/lib/site-matchmaker";
import SiteShortlistMap from "./SiteShortlistMap";

interface EnrichItem extends ShortlistEnrichmentFacts {
  key: string;
  enrichmentUnavailable: boolean;
}

type EnrichState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; byKey: Record<string, EnrichItem> };

const BADGE_FILTER_ORDER: readonly ZoningBadge[] = [
  "aligned",
  "planned-development",
  "not-aligned",
  "unresolved",
];

const BADGE_TONE: Record<ZoningBadge, string> = {
  aligned: "border-[#166534] bg-[#F0FDF4] text-[#166534]",
  "not-aligned": "border-[#A45B00] bg-[#FFFBEB] text-[#A45B00]",
  "planned-development": "border-[#7C3AED] bg-[#F5F3FF] text-[#7C3AED]",
  unresolved: "border-[#0C1B33]/30 bg-[#0C1B33]/[0.04] text-[#0C1B33]/60",
};

/** "8000 S COTTAGE GROVE AVE" -> "8000 S Cottage Grove Ave". */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\b(N|S|E|W|Ne|Nw|Se|Sw)\b/g, (match) => match.toUpperCase());
}

function assessorPinUrl(pin: string): string {
  return `https://www.cookcountyassessoril.gov/pin/${encodeURIComponent(pin)}`;
}

function sqft(value: number | null): string {
  return value == null ? "Not published" : `${value.toLocaleString("en-US")} sq ft`;
}

function usd(value: number | null): string {
  return value == null ? "—" : `$${value.toLocaleString("en-US")}`;
}

function miles(value: number | null): string {
  return value == null ? "" : `${value.toFixed(2)} mi`;
}

function metersAndWalk(meters: number, walkMinutes?: number): string {
  return walkMinutes != null
    ? `${meters.toLocaleString("en-US")} m, ~${walkMinutes} min walk`
    : `${meters.toLocaleString("en-US")} m`;
}

function ZoneBadge({ badge }: { badge: ZoningBadge }) {
  return (
    <span
      className={`flex-shrink-0 border px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.08em] ${BADGE_TONE[badge]}`}
    >
      {ZONING_BADGE_LABELS[badge]}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
        {label}
      </div>
      <div className="mt-1 text-[13px] leading-snug text-[#0C1B33]/85">{value}</div>
    </div>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block border border-[#FDBA74] bg-[#FFF7ED] px-2 py-1 text-[11px] leading-snug text-[#9A3412]">
      {children}
    </span>
  );
}

const OVERLAY_LABELS: { key: keyof RankedShortlistCandidate["overlays"]; label: string }[] = [
  { key: "ssa", label: "SSA" },
  { key: "ccsa", label: "CCSA" },
  { key: "tif", label: "TIF" },
  { key: "nof", label: "NOF" },
];

function overlaysText(overlays: RankedShortlistCandidate["overlays"]): string {
  const active = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key]).map((overlay) => overlay.label);
  return active.length > 0 ? active.join(" · ") : "None mapped";
}

function ShortlistCard({
  candidate,
  number,
  zip,
  enrichment,
  enrichState,
  onSnapshotClick,
}: {
  candidate: RankedShortlistCandidate;
  number: number;
  zip: string;
  enrichment: EnrichItem | null;
  enrichState: EnrichState["status"];
  onSnapshotClick: (candidate: RankedShortlistCandidate) => void;
}) {
  const viewerUrl = cookViewerUrl(candidate.pin);
  const clerkUrl = clerkRecordsUrl(candidate.pin);
  const showAccessibility = candidate.propertyType === "vacant_building";
  const accessibility = showAccessibility ? accessibilityNoteFor(enrichment?.countyClass ?? null) : null;

  const flags: string[] = [];
  if (candidate.saleYear) flags.push(taxSaleFlag(candidate.saleYear));
  if (candidate.violation) flags.push(VIOLATION_FLAG);
  for (const license of enrichment?.activeLicenses ?? []) {
    flags.push(activeLicenseFlag(license.name));
  }

  return (
    <li
      // Stable scroll target for the map panel's "Jump to details" link. The id
      // is derived from the same candidate key the pin carries, so the two can
      // never drift apart.
      id={shortlistCardDomId(candidate.key)}
      className="scroll-mt-6 border border-[#0C1B33]/12 bg-white p-5 data-[shortlist-focused]:border-[#2563EB] data-[shortlist-focused]:ring-2 data-[shortlist-focused]:ring-[#2563EB]/30"
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 font-mono-bureau text-[12px] text-[#2563EB]">
          {String(number).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-editorial text-[20px] leading-tight text-[#0C1B33]">
            {titleCase(candidate.address)}
          </h3>
          <p className="mt-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">
            {candidate.pin ? `PIN ${candidate.pin}` : "No PIN on this record"}
            {enrichment?.classGloss ? ` · ${enrichment.classGloss}` : ""}
          </p>
        </div>
        <ZoneBadge badge={candidate.badge} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact
          label={candidate.propertyType === "vacant_building" ? "Building" : "Building (none)"}
          value={sqft(candidate.buildingSqft)}
        />
        <Fact label="Lot" value={sqft(candidate.lotSqft)} />
        <Fact label="Owner type" value={candidate.ownerLabel} />
        <Fact
          label={candidate.transitScore ? "Scored transit" : "Nearest rail (display only)"}
          value={
            candidate.transitScore
              ? `${candidate.transitScore.stationName} (${candidate.transitScore.stationSystem}) · ${metersAndWalk(candidate.transitScore.meters, candidate.transitScore.walkMinutes)}`
              : candidate.nearestRailDisplay
                ? `${candidate.nearestRailDisplay.name} (${candidate.nearestRailDisplay.system}) · ${metersAndWalk(candidate.nearestRailDisplay.meters, candidate.nearestRailDisplay.walkMinutes)}`
                : "No station data"
          }
        />
        <Fact
          label="Assessed value"
          value={
            enrichState === "loading"
              ? "Checking…"
              : enrichment?.assessedValue != null
                ? `${usd(enrichment.assessedValue)}${enrichment.assessedYear ? ` (${String(enrichment.assessedYear).slice(0, 4)})` : ""}`
                : enrichState === "error" || enrichment?.enrichmentUnavailable
                  ? "Unavailable"
                  : "Not published"
          }
        />
        <Fact
          label="Assessor-implied market"
          value={
            enrichState === "loading"
              ? "Checking…"
              : enrichment?.impliedMarketValue != null
                ? `~${usd(enrichment.impliedMarketValue)}`
                : "—"
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-relaxed text-[#0C1B33]/55">
        {candidate.expresswayDisplay?.miles != null && (
          <span>
            Expressway proximity (display only): {candidate.expresswayDisplay.name ?? "Nearest expressway"} ·{" "}
            {miles(candidate.expresswayDisplay.miles)}
          </span>
        )}
        {candidate.nearestSchool && (
          <span>
            Nearest school (display only): {candidate.nearestSchool.name} ·{" "}
            {candidate.nearestSchool.meters.toLocaleString("en-US")} m
          </span>
        )}
        {candidate.nearestLibrary && (
          <span>
            Nearest library (display only): {candidate.nearestLibrary.name} ·{" "}
            {candidate.nearestLibrary.meters.toLocaleString("en-US")} m
          </span>
        )}
      </div>

      <p className="mt-4 border-l-2 border-[#2563EB] bg-[#EFF3FB] px-3 py-2 text-[12px] leading-relaxed text-[#0C1B33]/80">
        {candidate.badgeNote}
      </p>

      {accessibility && (
        <p
          className={`mt-2 border-l-2 px-3 py-2 text-[12px] leading-relaxed ${
            accessibility.level === "at-grade"
              ? "border-[#166534] bg-[#F0FDF4] text-[#166534]"
              : accessibility.level === "stairs"
                ? "border-[#A45B00] bg-[#FFFBEB] text-[#A45B00]"
                : "border-[#0891B2] bg-[#ECFEFF] text-[#0E7490]"
          }`}
        >
          <span className="font-semibold">Step-free access: </span>
          {accessibility.text}
        </p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/60">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
          Mapped overlays:{" "}
        </span>
        {overlaysText(candidate.overlays)}
        {" · "}
        {candidate.incentiveCount} incentive{" "}
        {candidate.incentiveCount === 1 ? "geography" : "geographies"} mapped at this point
      </p>

      {flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {flags.map((flag) => (
            <Flag key={flag}>{flag}</Flag>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* PRIMARY action, first in the row: everything else on this card sends
            the reader to a county or City record, while this one is the product
            answering the question the shortlist raised — what does this specific
            point qualify for? Same tab, because it is a continuation, not a
            reference lookup. */}
        <Link
          href={candidate.lat != null && candidate.lon != null ? shortlistSnapshotHref({ lat: candidate.lat, lon: candidate.lon, address: candidate.address }) : "/report"}
          onClick={() => onSnapshotClick(candidate)}
          className="border border-[#2563EB] bg-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#1D4ED8]"
        >
          Incentive snapshot
        </Link>
        {viewerUrl && (
          <a
            href={viewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white"
          >
            CookViewer parcel
          </a>
        )}
        {candidate.pin && (
          <a
            href={assessorPinUrl(candidate.pin)}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white"
          >
            Assessor record
          </a>
        )}
        {clerkUrl && (
          <a
            href={clerkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-[#0C1B33]/25 px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/60 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33]"
          >
            Clerk recordings
          </a>
        )}
        <Link
          href={`/vacancy/${zip}/map`}
          className="border border-[#0C1B33]/25 px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/60 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33]"
        >
          Property map
        </Link>
      </div>
    </li>
  );
}

export default function SiteShortlistResults({
  zip,
  projectUse,
  source,
  ranked,
  boundary,
  centroid,
}: {
  zip: string;
  projectUse: SiteProjectUse | null;
  source: string | null;
  /** The full ranked, screened list — ALREADY sliced to the rendered top N
   *  by the server page. Badges replace the old tier split; this component
   *  never re-ranks, it only filters what is shown. */
  ranked: RankedShortlistCandidate[];
  /** Simplified ZIP ring + bbox from the vacancy edition, for the map panel's
   *  boundary line. `null` renders the panel without an outline. */
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  centroid: { lat: number; lon: number };
}) {
  const [enrich, setEnrich] = useState<EnrichState>({ status: "idle" });
  const [badgeFilter, setBadgeFilter] = useState<ZoningBadge | "all">("all");

  const badgeCounts = useMemo(() => {
    const counts: Record<ZoningBadge, number> = {
      aligned: 0,
      "not-aligned": 0,
      "planned-development": 0,
      unresolved: 0,
    };
    for (const candidate of ranked) counts[candidate.badge] += 1;
    return counts;
  }, [ranked]);

  const visible = useMemo(
    () => (badgeFilter === "all" ? ranked : ranked.filter((candidate) => candidate.badge === badgeFilter)),
    [ranked, badgeFilter],
  );

  // Fire the generation event once per mount, mirroring the exactly-once
  // discipline of vacancy_web_report_viewed (VacancyReportMap).
  useEffect(() => {
    trackEvent("site_shortlist_generated", {
      source: source ?? "site-shortlist",
      metadata: {
        zip,
        resultCount: ranked.length,
        alignedCount: badgeCounts.aligned,
        notAlignedCount: badgeCounts["not-aligned"],
        plannedDevelopmentCount: badgeCounts["planned-development"],
        unresolvedCount: badgeCounts.unresolved,
        projectUse: projectUse ?? "",
      },
    });
    // Once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One enrichment pass for every rendered card (the full ranked set, not
  // just the currently-filtered view — so switching the badge filter never
  // triggers a re-fetch). Never throws: a failure is a display state, and
  // the static half of each card is already on screen.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current || ranked.length === 0) return;
    requestedRef.current = true;
    const controller = new AbortController();
    setEnrich({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch("/api/shortlist/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            items: ranked.map((candidate) => ({
              key: candidate.key,
              pin: candidate.pin,
              address: candidate.address,
            })),
          }),
        });
        if (!res.ok) {
          setEnrich({ status: "error" });
          return;
        }
        const body = (await res.json()) as { items?: EnrichItem[] };
        const byKey: Record<string, EnrichItem> = {};
        for (const item of body.items ?? []) {
          if (item && typeof item.key === "string") byKey[item.key] = item;
        }
        setEnrich({ status: "loaded", byKey });
      } catch {
        if (!controller.signal.aborted) setEnrich({ status: "error" });
      }
    })();

    return () => controller.abort();
  }, [ranked]);

  const byKey = enrich.status === "loaded" ? enrich.byKey : {};
  const allUnavailable =
    enrich.status === "error" ||
    (enrich.status === "loaded" &&
      ranked.length > 0 &&
      ranked.every((candidate) => byKey[candidate.key]?.enrichmentUnavailable !== false));

  function downloadCsv() {
    const facts: Record<string, ShortlistEnrichmentFacts> = {};
    for (const [key, item] of Object.entries(byKey)) {
      const { key: _key, enrichmentUnavailable: _flag, ...rest } = item;
      facts[key] = rest;
    }
    const blob = new Blob([shortlistCsv(ranked, facts)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = shortlistCsvFilename(zip);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    trackEvent("site_shortlist_csv_downloaded", {
      source: source ?? "site-shortlist",
      metadata: { zip },
    });
  }

  /** One event per snapshot launch, carrying the PIN so a downstream report can
   *  be tied back to the exact record that sent it. Fires alongside navigation;
   *  the link is never blocked on it. */
  function handleSnapshotClick(candidate: RankedShortlistCandidate) {
    trackEvent("site_shortlist_snapshot_clicked", {
      source: source ?? "site-shortlist",
      metadata: { zip, pin: candidate.pin ?? "" },
    });
  }

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={downloadCsv}
          disabled={ranked.length === 0}
          className="min-h-10 border border-[#2563EB] px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Download the shortlist (CSV)
        </button>
        {allUnavailable && (
          <span className="text-[11px] leading-relaxed text-[#A45B00]">
            County valuation lookup unavailable right now — the county and licensing columns are
            blank. Everything else on these cards is from the committed snapshot.
          </span>
        )}
      </div>

      <SiteShortlistMap zip={zip} ranked={ranked} boundary={boundary} centroid={centroid} />

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-editorial text-[26px] leading-tight text-[#0C1B33]">
            {visible.length} candidate {visible.length === 1 ? "record" : "records"}
            {badgeFilter !== "all" ? ` · ${ZONING_BADGE_LABELS[badgeFilter]}` : ""}
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/60">
          One ranked list, screened against your brief. The badge on every card is a broad
          district-family screen only — filter by it below, but it never removes a record from the
          list above.
        </p>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by zoning badge">
          <button
            type="button"
            onClick={() => setBadgeFilter("all")}
            className={`border px-2.5 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] transition-colors ${
              badgeFilter === "all"
                ? "border-[#0C1B33] bg-[#0C1B33] text-white"
                : "border-[#0C1B33]/25 text-[#0C1B33]/60 hover:border-[#0C1B33]/50"
            }`}
          >
            All ({ranked.length})
          </button>
          {BADGE_FILTER_ORDER.map((badge) => (
            <button
              key={badge}
              type="button"
              onClick={() => setBadgeFilter(badge)}
              disabled={badgeCounts[badge] === 0}
              className={`border px-2.5 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                badgeFilter === badge
                  ? "border-[#0C1B33] bg-[#0C1B33] text-white"
                  : "border-[#0C1B33]/25 text-[#0C1B33]/60 hover:border-[#0C1B33]/50"
              }`}
            >
              {ZONING_BADGE_LABELS[badge]} ({badgeCounts[badge]})
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
            No records match this filter
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {visible.map((candidate) => (
              <ShortlistCard
                key={candidate.key}
                candidate={candidate}
                number={ranked.indexOf(candidate) + 1}
                zip={zip}
                enrichment={byKey[candidate.key] ?? null}
                enrichState={enrich.status}
                onSnapshotClick={handleSnapshotClick}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 border border-[#0C1B33]/12 bg-white px-4 py-4 text-[12px] leading-relaxed text-[#0C1B33]/70">
        <span className="font-semibold">How to read the value figures. </span>
        &ldquo;Assessed value&rdquo; is the Cook County Assessor&rsquo;s most recent published
        assessment for the PIN. &ldquo;Assessor-implied market&rdquo; converts it at the county&rsquo;s
        assessment level (10% residential and mixed use, 25% commercial) — a {IMPLIED_VALUE_CAPTION}.
        Long-vacant and distressed buildings frequently trade well below these figures, and exempt
        parcels carry no convertible assessment at all.
      </p>
    </div>
  );
}
