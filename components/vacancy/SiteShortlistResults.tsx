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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics-events";
import {
  assessorRecordUrl,
  clerkRecordsUrl,
  cookViewerUrl,
  formatPin14,
} from "@/lib/cook-viewer";
import {
  ZONING_BADGE_LABELS,
  type CandidateOverlays,
  type DecoratedShortlistCandidate,
  type ZoningBadge,
} from "@/lib/shortlist-engine";
import { shortlistCsv, shortlistCsvFilename } from "@/lib/shortlist-csv";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { classifyOwnerSector } from "@/lib/owner-sector";
import { normalizeOwnerStructure } from "@/lib/owner-taxonomy";
import {
  fetchCandidateParcelEnrichment,
} from "@/lib/site-matchmaker-parcel-client";
import {
  resolveCandidateParcelIdentity,
} from "@/lib/site-matchmaker-parcel-resolution-client";
import {
  resolvedParcelIdentityFromCandidate,
  type CandidateParcelResolution,
  type ParcelResolutionCandidate,
} from "@/lib/site-matchmaker-parcel-resolution";
import type { CandidateParcelEnrichmentState } from "@/lib/site-matchmaker-results";
import {
  IMPLIED_VALUE_CAPTION,
  VIOLATION_FLAG,
  assessedYearLabel,
  accessibilityNoteFor,
  activeLicenseFlag,
  parcelCheckedDateLabel,
  shortlistSnapshotHref,
  taxSaleFlag,
  type ShortlistEnrichmentFacts,
} from "@/lib/site-shortlist";
import { shortlistCardDomId } from "@/lib/shortlist-map-layers";
import { shortlistCriteriaAnalyticsMetadata } from "@/lib/shortlist-criteria";
import {
  candidateMatchesShortlistZoningFilters,
  shortlistDistrictTypeFilterOptions,
  shortlistExactZoningFilterOptions,
  shortlistFamilyFilterOptions,
} from "@/lib/shortlist-zoning-filter";
import { DISTRICT_FILTER_DISCLAIMER } from "@/lib/zoning-districts";
import type { SiteMatchCriteria } from "@/lib/site-matchmaker";
import SiteShortlistMap from "./SiteShortlistMap";
import {
  ParcelDossierDialog,
  type ParcelDossierRecord,
} from "./SiteMatchmakerParcelDossier";

interface EnrichItem extends ShortlistEnrichmentFacts {
  key: string;
  enrichmentUnavailable: boolean;
}

type EnrichState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; byKey: Record<string, EnrichItem> };

interface DossierOverlay {
  resolution: CandidateParcelResolution;
  enrichment: CandidateParcelEnrichmentState;
}

function factsFromEnrichItem(item: EnrichItem): CandidateParcelEnrichmentState {
  const { key: _key, enrichmentUnavailable, ...facts } = item;
  return { status: "checked", facts, sourceUnavailable: enrichmentUnavailable };
}

/** The card's candidate as the shared parcel-resolution vocabulary sees it —
 *  including WHERE its PIN came from, so a precomputed exact match is never
 *  reported as something the saved snapshot published. */
function parcelResolutionCandidate(
  candidate: DecoratedShortlistCandidate,
): ParcelResolutionCandidate {
  return {
    key: candidate.key,
    pin: candidate.pin,
    address: candidate.address,
    lat: candidate.lat,
    lon: candidate.lon,
    pinProvenance: candidate.pinProvenance,
  };
}

function dossierRecord(
  candidate: DecoratedShortlistCandidate,
  resolution: CandidateParcelResolution,
): ParcelDossierRecord {
  return {
    address: candidate.address,
    pin: resolution.status === "resolved" ? resolution.pin : candidate.pin,
    lat: candidate.lat,
    lon: candidate.lon,
    space: {
      lotAreaSqft: candidate.lotSqft ?? undefined,
      assessorBuildingSqft: candidate.buildingSqft ?? undefined,
    },
    ownerSector: candidate.ownerSector ?? classifyOwnerSector({ ownerStructure: candidate.ownerStructure }),
    ownerStructure: normalizeOwnerStructure(candidate.ownerStructure),
  };
}

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

function sqft(value: number | null): string {
  return value == null || !Number.isFinite(value) || value <= 0
    ? "Not published"
    : `${value.toLocaleString("en-US")} sq ft`;
}

function countyAreaText(
  snapshotValue: number | null,
  enrichment: ShortlistEnrichmentFacts | null,
  enrichState: EnrichState["status"],
  field: "lotAreaSqft" | "assessorBuildingSqft",
): string {
  const status =
    field === "lotAreaSqft"
      ? enrichment?.lotAreaStatus
      : enrichment?.assessorBuildingAreaStatus;
  const liveValue = enrichment?.[field] ?? null;
  if (status === "available" && liveValue != null) return sqft(liveValue);
  if (snapshotValue != null) {
    if (status === "unavailable" || enrichState === "error") {
      return `${sqft(snapshotValue)} · saved snapshot; current check unavailable`;
    }
    if (status === "not_published") {
      return `${sqft(snapshotValue)} · saved snapshot; current record did not publish an area`;
    }
    return sqft(snapshotValue);
  }
  if (enrichState === "loading") return "Checking…";
  if (status === "unavailable" || enrichState === "error") return "Unavailable";
  if (status === "not_requested") return "Not requested — PIN needs verification";
  return "Not published";
}

function usd(value: number | null): string {
  return value == null ? "—" : `$${value.toLocaleString("en-US")}`;
}

export function assessedValueCardText(
  facts: ShortlistEnrichmentFacts | null,
  enrichState: EnrichState["status"],
): string {
  if (enrichState === "loading") return "Checking…";
  if (facts?.assessedValueStatus === "not_requested") {
    return "Not requested — PIN needs verification";
  }
  if (
    facts?.assessedValueStatus === "unavailable" ||
    enrichState === "error" ||
    (enrichState === "loaded" && facts === null)
  ) {
    return "Unavailable";
  }
  if (facts?.assessedValue != null) {
    const year = assessedYearLabel(facts.assessedYear);
    return `${usd(facts.assessedValue)}${year ? ` (${year}${facts.assessedStage ? ` · ${facts.assessedStage}` : ""})` : ""}`;
  }
  if (enrichState === "idle") return "Not checked";
  return "Not published";
}

export function impliedMarketValueCardText(
  facts: ShortlistEnrichmentFacts | null,
  enrichState: EnrichState["status"],
): string {
  if (enrichState === "loading") return "Checking…";
  if (facts?.assessedValueStatus === "not_requested") {
    return "Not requested — PIN needs verification";
  }
  if (
    facts?.assessedValueStatus === "unavailable" ||
    enrichState === "error" ||
    (enrichState === "loaded" && facts === null)
  ) {
    return "Unavailable";
  }
  if (facts?.impliedMarketValue != null) return `~${usd(facts.impliedMarketValue)}`;
  if (enrichState === "idle") return "Not checked";
  if (facts?.assessedValueStatus === "available") {
    return "Not available for this County class";
  }
  return "Not published";
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

const OVERLAY_LABELS: { key: keyof CandidateOverlays; label: string }[] = [
  { key: "ssa", label: "SSA" },
  { key: "ccsa", label: "CCSA" },
  { key: "tif", label: "TIF" },
  { key: "nof", label: "NOF" },
];

/** Each active overlay's own feature name where the source published one
 *  (Finding 12) — "SSA: Greater Chatham", not just "SSA".
 *
 * review5 S2: "None mapped" is a confirmed-absence claim — it must never
 * be the string shown when a layer simply couldn't be checked
 * (overlays[key].unknown === true). Known positives (`present`) always
 * render, regardless of how many other layers are unknown; an unknown
 * layer is disclosed, never silently folded into "none". */
export function overlaysText(overlays: CandidateOverlays): string {
  const active = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key].present).map((overlay) => {
    const name = overlays[overlay.key].name;
    return name ? `${overlay.label}: ${name}` : overlay.label;
  });
  const unknown = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key].unknown).map(
    (overlay) => overlay.label,
  );

  if (active.length === 0 && unknown.length === OVERLAY_LABELS.length) {
    return "Not checked";
  }
  if (unknown.length > 0) {
    const base = active.length > 0 ? active.join(" · ") : "None confirmed";
    return `${base} (${unknown.join(", ")} not checked)`;
  }
  return active.length > 0 ? active.join(" · ") : "None mapped";
}

/**
 * review6 S12 (CRITICAL): 12,216 of the committed universe's 31,296 rows
 * carry `incentiveCount: null` — the count was never resolved for that
 * row. `candidate.incentiveCount ?? 0` used to coerce every one of those
 * into a trusted `0`, rendered as "0 incentive geographies mapped at this
 * point" — a confirmed-absence claim for a fact nobody ever checked, the
 * exact same false-zero anti-pattern S1-S3/S12's overlay fix all exist to
 * prevent, just for a count instead of a boolean.
 *
 * Directive from review6 S12 verbatim: "counts stay number|null and null
 * OR zero renders 'Not checked' ... do NOT trust legacy zeros." A literal
 * `0` is treated the same as `null` here — not because a genuine zero is
 * impossible, but because THIS export pipeline has never yet produced a
 * distinguishable, audited zero (every committed row is either `null` or
 * a positive count; see docs/eligibility-claims-acceptance.md's S12
 * entry), so there is no way today to tell an audited zero from an
 * unresolved one that happened to compute to the same number. Only a
 * genuinely positive count is a fact worth stating.
 */
export function incentiveCountText(incentiveCount: number | null): string {
  if (incentiveCount == null || incentiveCount <= 0) {
    return "Incentive geography count not checked";
  }
  return `${incentiveCount} incentive ${incentiveCount === 1 ? "geography" : "geographies"} mapped at this point`;
}

function ShortlistCard({
  candidate,
  number,
  zip,
  enrichment,
  enrichState,
  onSnapshotClick,
  dossierOverlay,
  onParcelDetails,
}: {
  candidate: DecoratedShortlistCandidate;
  number: number;
  zip: string;
  enrichment: EnrichItem | null;
  enrichState: EnrichState["status"];
  onSnapshotClick: (candidate: DecoratedShortlistCandidate) => void;
  dossierOverlay: DossierOverlay | null;
  onParcelDetails: (
    candidate: DecoratedShortlistCandidate,
    opener: HTMLButtonElement,
  ) => void;
}) {
  // The card's PIN identity: whatever the opened dossier resolved, else
  // whatever was already known at LOAD — which now includes precomputed
  // exact-intersection PINs, so those cards carry County links and the
  // exact-match label without the reader having to open anything.
  const pinResolution =
    dossierOverlay?.resolution.status === "resolved"
      ? dossierOverlay.resolution
      : resolvedParcelIdentityFromCandidate(parcelResolutionCandidate(candidate));
  const effectivePin = pinResolution?.pin ?? candidate.pin;
  const checkedLabel =
    pinResolution?.pinSource === "coordinate_exact"
      ? parcelCheckedDateLabel(pinResolution.checkedAt)
      : null;
  const exactMatchLabel =
    pinResolution?.pinSource === "coordinate_exact"
      ? ` · resolved from current County parcel${checkedLabel ? ` · checked ${checkedLabel}` : ""}`
      : "";
  const viewerUrl = cookViewerUrl(effectivePin);
  const assessorUrl = assessorRecordUrl(effectivePin);
  const clerkUrl = clerkRecordsUrl(effectivePin);
  const mapsUrl = googleMapsSearchUrl({
    address: candidate.address,
    lat: candidate.lat,
    lon: candidate.lon,
    zip,
  });
  const currentFacts = dossierOverlay?.enrichment.status === "checked"
    ? dossierOverlay.enrichment.facts
    : enrichment;
  const currentEnrichState: EnrichState["status"] = dossierOverlay?.enrichment.status === "loading"
    ? "loading"
    : dossierOverlay?.enrichment.status === "unavailable"
      ? "error"
      : enrichState;
  const showAccessibility = candidate.propertyType === "vacant_building";
  const accessibility = showAccessibility ? accessibilityNoteFor(currentFacts?.countyClass ?? null) : null;

  const flags: string[] = [];
  if (candidate.saleYear) flags.push(taxSaleFlag(candidate.saleYear));
  if (candidate.violation) flags.push(VIOLATION_FLAG);
  if (candidate.conflictingPropertyTypes) {
    // Re-review Finding 3: report the REQUESTED screening type
    // (`screenedPropertyType`, resolved by the engine from the search's own
    // property-type request), never the row's single resolved
    // `propertyType` — building evidence always wins that resolution when a
    // site carries both, so a card describing a LAND search's own screening
    // logic must not read the building-wins field or it will claim the
    // wrong type for a land search that admitted this row via land
    // evidence.
    flags.push(
      `This record carries both vacant-land and vacant-building evidence — screened as a ${
        candidate.screenedPropertyType === "vacant_building" ? "building" : "land"
      } record for this search`,
    );
  }
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
            {formatPin14(effectivePin)
              ? `PIN ${formatPin14(effectivePin)}${exactMatchLabel}`
              : "PIN not published in saved shortlist snapshot"}
            {" · "}
            {candidate.zoningDistrict ? `Zoned ${candidate.zoningDistrict}` : "Zoning unresolved"}
            {currentFacts?.classGloss ? ` · ${currentFacts.classGloss}` : ""}
          </p>
        </div>
        <ZoneBadge badge={candidate.badge} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact
          label={candidate.propertyType === "vacant_building" ? "Building" : "Building (none)"}
          value={countyAreaText(candidate.buildingSqft, currentFacts, currentEnrichState, "assessorBuildingSqft")}
        />
        <Fact
          label="Lot"
          value={countyAreaText(candidate.lotSqft, currentFacts, currentEnrichState, "lotAreaSqft")}
        />
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
          value={assessedValueCardText(currentFacts, currentEnrichState)}
        />
        <Fact
          label="Assessor-implied market"
          value={impliedMarketValueCardText(currentFacts, currentEnrichState)}
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
        {incentiveCountText(candidate.incentiveCount)}
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
        <button
          type="button"
          data-parcel-details
          onClick={(event) => onParcelDetails(candidate, event.currentTarget)}
          className="inline-flex min-h-11 items-center border border-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
        >
          Parcel details
        </button>
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${titleCase(candidate.address)} in Google Maps (opens in a new tab)`}
            className="inline-flex min-h-11 items-center border border-[#0C1B33]/25 px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/70 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            Google Maps
          </a>
        ) : null}
        {viewerUrl && (
          <a
            href={viewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center border border-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            CookViewer parcel
          </a>
        )}
        {assessorUrl && (
          <a
            href={assessorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center border border-[#2563EB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] transition-colors hover:bg-[#2563EB] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            Assessor record
          </a>
        )}
        {clerkUrl && (
          <a
            href={clerkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center border border-[#0C1B33]/25 px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/60 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
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
  criteria,
  scored,
  source,
  buildId,
  ranked,
  boundary,
  centroid,
}: {
  zip: string;
  /** The full decoded brief — used to derive the analytics event's
   *  registry-backed criteria metadata (Finding 2), not just `projectUse`
   *  as before. */
  criteria: SiteMatchCriteria;
  /** True when a real transit score is active for this run
   *  (`ShortlistEngineResult.scored`, Finding 13) — when false, `ranked`'s
   *  order is the fixed-weight record-completeness order (round 3), NOT a
   *  fit/quality ranking, and the copy below must say so rather than
   *  calling it "highest-ranked." */
  scored: boolean;
  source: string | null;
  /** The loaded universe file's own buildId (PR1) — sent with every
   *  enrichment request so the server-side cache can key on it (Finding 4:
   *  an enrichment cache keyed only on PIN/address can serve a stale value
   *  across a universe regeneration with no signal anything changed). */
  buildId: string;
  /** The full ranked, screened list — ALREADY sliced to the rendered top N
   *  AND already decorated with display-only facts
   *  (`decorateShortlistDisplayFacts`) by the server page. Badges replace
   *  the old tier split; this component never re-ranks, it only filters
   *  what is shown. */
  ranked: DecoratedShortlistCandidate[];
  /** Simplified ZIP ring + bbox from the vacancy edition, for the map panel's
   *  boundary line. `null` renders the panel without an outline. */
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  centroid: { lat: number; lon: number };
}) {
  const [enrich, setEnrich] = useState<EnrichState>({ status: "idle" });
  const [badgeFilter, setBadgeFilter] = useState<ZoningBadge | "all">("all");
  const [familyFilter, setFamilyFilter] = useState("");
  const [districtTypeFilter, setDistrictTypeFilter] = useState("");
  const [exactZoningFilter, setExactZoningFilter] = useState("");
  const [dossierByKey, setDossierByKey] = useState<Record<string, DossierOverlay>>({});
  const [selectedDossierKey, setSelectedDossierKey] = useState<string | null>(null);
  const dossierOpenerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const latestRequestByKeyRef = useRef(new Map<string, number>());

  const familyOptions = useMemo(() => shortlistFamilyFilterOptions(ranked), [ranked]);
  const districtTypeOptions = useMemo(
    () => shortlistDistrictTypeFilterOptions(ranked, familyFilter),
    [ranked, familyFilter],
  );
  const exactZoningOptions = useMemo(
    () => shortlistExactZoningFilterOptions(ranked, familyFilter, districtTypeFilter),
    [ranked, familyFilter, districtTypeFilter],
  );
  const exactZoningPublishedCount = useMemo(
    () => exactZoningOptions.reduce((sum, option) => sum + option.count, 0),
    [exactZoningOptions],
  );

  const zoningFiltered = useMemo(
    () =>
      ranked.filter((candidate) =>
        candidateMatchesShortlistZoningFilters(
          candidate,
          familyFilter,
          districtTypeFilter,
          exactZoningFilter,
        ),
      ),
    [ranked, familyFilter, districtTypeFilter, exactZoningFilter],
  );

  const badgeCounts = useMemo(() => {
    const counts: Record<ZoningBadge, number> = {
      aligned: 0,
      "not-aligned": 0,
      "planned-development": 0,
      unresolved: 0,
    };
    for (const candidate of zoningFiltered) counts[candidate.badge] += 1;
    return counts;
  }, [zoningFiltered]);

  const visible = useMemo(
    () =>
      badgeFilter === "all"
        ? zoningFiltered
        : zoningFiltered.filter((candidate) => candidate.badge === badgeFilter),
    [zoningFiltered, badgeFilter],
  );
  const visibleCandidateKeys = useMemo(
    () => visible.map((candidate) => candidate.key),
    [visible],
  );
  const anyDisplayFilterActive =
    badgeFilter !== "all" ||
    familyFilter !== "" ||
    districtTypeFilter !== "" ||
    exactZoningFilter !== "";

  // Fire the generation event once per mount, mirroring the exactly-once
  // discipline of vacancy_web_report_viewed (VacancyReportMap). Metadata is
  // DERIVED FROM THE REGISTRY (re-review Finding 2) — criteriaIds/
  // criteriaBehaviors come straight from
  // shortlistCriteriaAnalyticsMetadata(...), which reads
  // lib/shortlist-criteria.ts's SHORTLIST_CRITERION_REGISTRY, not a
  // hand-rolled per-badge count invented in this component.
  useEffect(() => {
    const registryMetadata = shortlistCriteriaAnalyticsMetadata({
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
    trackEvent("site_shortlist_generated", {
      source: source ?? "site-shortlist",
      metadata: {
        zip,
        resultCount: ranked.length,
        scored,
        alignedCount: badgeCounts.aligned,
        notAlignedCount: badgeCounts["not-aligned"],
        plannedDevelopmentCount: badgeCounts["planned-development"],
        unresolvedCount: badgeCounts.unresolved,
        projectUse: criteria.projectUse ?? "",
        criteriaIds: registryMetadata.criteriaIds,
        criteriaBehaviors: registryMetadata.criteriaBehaviors,
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
            buildId,
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
  }, [ranked, buildId]);

  const byKey = useMemo(
    () => enrich.status === "loaded" ? enrich.byKey : {},
    [enrich],
  );
  const allUnavailable =
    enrich.status === "error" ||
    (enrich.status === "loaded" &&
      ranked.length > 0 &&
      ranked.every((candidate) => byKey[candidate.key]?.enrichmentUnavailable !== false));

  const runParcelDossier = useCallback(
    async (
      candidate: DecoratedShortlistCandidate,
      options: { retryResolution?: boolean; retryEnrichment?: boolean } = {},
    ) => {
      const requestId = ++requestSequenceRef.current;
      latestRequestByKeyRef.current.set(candidate.key, requestId);
      const isCurrent = () => latestRequestByKeyRef.current.get(candidate.key) === requestId;
      const existing = dossierByKey[candidate.key];
      // Any PIN known at LOAD — published by the snapshot OR precomputed by
      // exact map-point intersection — resolves without a network call, and
      // carries its own provenance (never "saved_snapshot" for a precomputed
      // match).
      const knownResolution = resolvedParcelIdentityFromCandidate(
        parcelResolutionCandidate(candidate),
      );
      if (
        !options.retryResolution &&
        !options.retryEnrichment &&
        existing?.resolution.status === "resolved" &&
        existing.enrichment.status === "checked" &&
        !existing.enrichment.sourceUnavailable
      ) {
        return;
      }

      const startingResolution: CandidateParcelResolution = options.retryResolution
        ? { status: "resolving" }
        : existing?.resolution.status === "resolved"
          ? existing.resolution
          : (knownResolution ?? { status: "resolving" });

      setDossierByKey((current) => ({
        ...current,
        [candidate.key]: {
          resolution: startingResolution,
          enrichment:
            startingResolution.status === "resolved"
              ? { status: "loading" }
              : { status: "not_requested" },
        },
      }));

      const resolution =
        startingResolution.status === "resolved"
          ? startingResolution
          : await resolveCandidateParcelIdentity(buildId, parcelResolutionCandidate(candidate));
      if (!isCurrent()) return;
      if (resolution.status !== "resolved") {
        setDossierByKey((current) => ({
          ...current,
          [candidate.key]: { resolution, enrichment: { status: "not_requested" } },
        }));
        return;
      }

      const batchItem = byKey[candidate.key];
      // Reuse the load-time batch for ANY pin that was already known when the
      // batch was sent — the batch keys off `candidate.pin`, which now
      // includes precomputed PINs, so those facts are already on the card
      // face and re-fetching them on open would be a wasted County round trip
      // for an identical answer. A PIN discovered LATER (on-demand
      // resolution) was not in the batch and still needs its own fetch.
      if (
        !options.retryEnrichment &&
        knownResolution?.pin === resolution.pin &&
        batchItem &&
        batchItem.countyClassStatus !== "not_requested"
      ) {
        setDossierByKey((current) => ({
          ...current,
          [candidate.key]: { resolution, enrichment: factsFromEnrichItem(batchItem) },
        }));
        return;
      }

      setDossierByKey((current) => ({
        ...current,
        [candidate.key]: { resolution, enrichment: { status: "loading" } },
      }));
      const enrichmentResult = await fetchCandidateParcelEnrichment(buildId, resolution.pin);
      if (!isCurrent()) return;
      setDossierByKey((current) => ({
        ...current,
        [candidate.key]: { resolution, enrichment: enrichmentResult },
      }));
    },
    [buildId, byKey, dossierByKey],
  );

  const openParcelDossier = useCallback(
    (candidate: DecoratedShortlistCandidate, opener: HTMLButtonElement) => {
      dossierOpenerRef.current = opener;
      setSelectedDossierKey(candidate.key);
      void runParcelDossier(candidate);
    },
    [runParcelDossier],
  );

  const closeParcelDossier = useCallback(() => {
    const key = selectedDossierKey;
    setSelectedDossierKey(null);
    requestAnimationFrame(() => {
      const opener = dossierOpenerRef.current;
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      if (!key) return;
      document
        .getElementById(shortlistCardDomId(key))
        ?.querySelector<HTMLButtonElement>("[data-parcel-details]")
        ?.focus();
    });
  }, [selectedDossierKey]);

  const selectedDossierCandidate = selectedDossierKey
    ? ranked.find((candidate) => candidate.key === selectedDossierKey) ?? null
    : null;
  const selectedDossierOverlay = selectedDossierCandidate
    ? dossierByKey[selectedDossierCandidate.key] ?? {
        resolution: { status: "not_checked" as const },
        enrichment: { status: "not_checked" as const },
      }
    : null;

  function downloadCsv() {
    const facts: Record<string, ShortlistEnrichmentFacts> = {};
    for (const [key, item] of Object.entries(byKey)) {
      const { key: _key, enrichmentUnavailable: _flag, ...rest } = item;
      facts[key] = rest;
    }
    for (const [key, overlay] of Object.entries(dossierByKey)) {
      if (overlay.enrichment.status === "checked") facts[key] = overlay.enrichment.facts;
    }
    const resolutionStates = Object.fromEntries(
      ranked.map((candidate) => [candidate.key, dossierByKey[candidate.key]?.resolution ?? { status: "not_checked" }]),
    );
    const blob = new Blob([shortlistCsv(ranked, facts, resolutionStates, zip)], {
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
  function handleSnapshotClick(candidate: DecoratedShortlistCandidate) {
    trackEvent("site_shortlist_snapshot_clicked", {
      source: source ?? "site-shortlist",
      metadata: { zip, pin: candidate.pin ?? "" },
    });
  }

  function resetDisplayFilters() {
    setBadgeFilter("all");
    setFamilyFilter("");
    setDistrictTypeFilter("");
    setExactZoningFilter("");
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
          Download the full shortlist (CSV)
        </button>
        {allUnavailable && (
          <span className="text-[11px] leading-relaxed text-[#A45B00]">
            County valuation lookup unavailable right now — the county and licensing columns are
            blank. Everything else on these cards is from the committed snapshot.
          </span>
        )}
      </div>

      <section className="mt-8 border border-[#0C1B33]/12 bg-white p-4 sm:p-5" aria-labelledby="shortlist-zoning-filter-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="shortlist-zoning-filter-heading"
              className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/70"
            >
              Filter map and cards by zoning
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#0C1B33]/50">
              Start with a zoning family, choose a district type, then narrow to an exact published
              code. Filters change this display only; rank numbers and the full CSV stay unchanged.
            </p>
          </div>
          {anyDisplayFilterActive ? (
            <button
              type="button"
              onClick={resetDisplayFilters}
              className="border border-[#0C1B33]/25 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/60 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33]"
            >
              Reset all filters
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label htmlFor="shortlist-zoning-family" className="min-w-0">
            <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
              Zoning family
            </span>
            <select
              id="shortlist-zoning-family"
              aria-describedby="shortlist-zoning-disclaimer"
              value={familyFilter}
              onChange={(event) => {
                setFamilyFilter(event.target.value);
                setDistrictTypeFilter("");
                setExactZoningFilter("");
              }}
              className="w-full min-w-0 border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[12px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
            >
              <option value="">All candidates ({ranked.length})</option>
              {familyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="shortlist-zoning-district-type" className="min-w-0">
            <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
              District type
            </span>
            <select
              id="shortlist-zoning-district-type"
              aria-describedby="shortlist-zoning-disclaimer"
              value={districtTypeFilter}
              disabled={districtTypeOptions.length === 0}
              onChange={(event) => {
                setDistrictTypeFilter(event.target.value);
                setExactZoningFilter("");
              }}
              className="w-full min-w-0 border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[12px] text-[#0C1B33] outline-none focus:border-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#F7F8FA] disabled:text-[#0C1B33]/40"
            >
              <option value="">All district types</option>
              {districtTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="shortlist-zoning-code" className="min-w-0">
            <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
              Exact published code
            </span>
            <select
              id="shortlist-zoning-code"
              aria-describedby="shortlist-zoning-disclaimer"
              value={exactZoningFilter}
              disabled={exactZoningOptions.length === 0}
              onChange={(event) => setExactZoningFilter(event.target.value)}
              className="w-full min-w-0 border border-[#0C1B33]/15 bg-white px-2.5 py-2.5 text-[12px] text-[#0C1B33] outline-none focus:border-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#F7F8FA] disabled:text-[#0C1B33]/40"
            >
              <option value="">All published codes ({exactZoningPublishedCount})</option>
              {exactZoningOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-[#0C1B33]/8 pt-3">
          <p aria-live="polite" className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/55">
            Showing {visible.length} of {ranked.length} ranked candidates
          </p>
          <p
            id="shortlist-zoning-disclaimer"
            className="max-w-2xl text-[10px] leading-relaxed text-[#0C1B33]/45"
          >
            {DISTRICT_FILTER_DISCLAIMER}
          </p>
        </div>
      </section>

      <SiteShortlistMap
        zip={zip}
        ranked={ranked}
        visibleCandidateKeys={visibleCandidateKeys}
        boundary={boundary}
        centroid={centroid}
        onParcelDetails={(candidateKey, opener) => {
          const candidate = ranked.find((row) => row.key === candidateKey);
          if (candidate) openParcelDossier(candidate, opener);
        }}
      />

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-editorial text-[26px] leading-tight text-[#0C1B33]">
            {visible.length} candidate {visible.length === 1 ? "record" : "records"}
            {badgeFilter !== "all" ? ` · ${ZONING_BADGE_LABELS[badgeFilter]}` : ""}
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/60">
          {scored
            ? "One ranked list, screened against your brief."
            : "One list, screened against your brief, ordered by record completeness — add a transit criterion to rank by fit."}{" "}
          The badge on every card is a broad project-to-district-family screen only. The zoning
          selects narrow by the City&rsquo;s published designation; neither control reranks the list or
          determines whether a specific use is permitted.
        </p>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by zoning badge">
          <button
            type="button"
            onClick={() => setBadgeFilter("all")}
            aria-pressed={badgeFilter === "all"}
            className={`border px-2.5 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] transition-colors ${
              badgeFilter === "all"
                ? "border-[#0C1B33] bg-[#0C1B33] text-white"
                : "border-[#0C1B33]/25 text-[#0C1B33]/60 hover:border-[#0C1B33]/50"
            }`}
          >
            All ({zoningFiltered.length})
          </button>
          {BADGE_FILTER_ORDER.map((badge) => (
            <button
              key={badge}
              type="button"
              onClick={() => setBadgeFilter(badge)}
              aria-pressed={badgeFilter === badge}
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
          <div
            role="status"
            className="mt-4 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center"
          >
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
              No records match these filters
            </p>
            <button
              type="button"
              onClick={resetDisplayFilters}
              className="mt-3 border border-[#0C1B33]/25 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/65 transition-colors hover:border-[#0C1B33]/60 hover:text-[#0C1B33]"
            >
              Reset all filters
            </button>
          </div>
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
                dossierOverlay={dossierByKey[candidate.key] ?? null}
                onParcelDetails={openParcelDossier}
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
      {selectedDossierCandidate && selectedDossierOverlay ? (
        <ParcelDossierDialog
          row={dossierRecord(selectedDossierCandidate, selectedDossierOverlay.resolution)}
          zip={zip}
          resolution={selectedDossierOverlay.resolution}
          enrichment={selectedDossierOverlay.enrichment}
          onClose={closeParcelDossier}
          onRetry={() => {
            void runParcelDossier(selectedDossierCandidate, { retryEnrichment: true });
          }}
          onRetryResolution={() => {
            void runParcelDossier(selectedDossierCandidate, { retryResolution: true });
          }}
        />
      ) : null}
    </div>
  );
}
