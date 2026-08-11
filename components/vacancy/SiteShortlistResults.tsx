"use client";

/**
 * The rendered half of the Site Shortlist: two tiers of numbered cards, one
 * request-time enrichment pass, and the CSV download.
 *
 * CLIENT ISLAND. It value-imports lib/site-shortlist.ts only — that module is
 * pure by contract. It must NEVER import lib/vacancy-index.ts or
 * lib/rail-stations.ts (both read `node:fs`, which breaks the client build);
 * the server page does that work and hands the finished candidates down.
 *
 * The enrichment fetch is fired ONCE per mount for every rendered card, and its
 * failure is a display state, not an error: the static half of each card (size,
 * ownership axes, overlays, rail, zoning screen) is already on screen and stays
 * there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics-events";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import {
  IMPLIED_VALUE_CAPTION,
  TIER_1_HEADING,
  TIER_2_HEADING,
  VIOLATION_FLAG,
  accessibilityNoteFor,
  activeLicenseFlag,
  shortlistCsv,
  shortlistCsvFilename,
  taxSaleFlag,
  type ShortlistCandidate,
  type ShortlistEnrichmentFacts,
  type ShortlistResult,
} from "@/lib/site-shortlist";
import type { SiteProjectUse } from "@/lib/site-matchmaker";

interface EnrichItem extends ShortlistEnrichmentFacts {
  key: string;
  enrichmentUnavailable: boolean;
}

type EnrichState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; byKey: Record<string, EnrichItem> };

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

function ZoneBadge({ candidate }: { candidate: ShortlistCandidate }) {
  const tone =
    candidate.zoningStatus === "by-right"
      ? "border-[#166534] bg-[#F0FDF4] text-[#166534]"
      : candidate.zoningStatus === "unverified"
        ? "border-[#0C1B33]/30 bg-[#0C1B33]/[0.04] text-[#0C1B33]/60"
        : "border-[#A45B00] bg-[#FFFBEB] text-[#A45B00]";
  return (
    <span
      className={`flex-shrink-0 border px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.08em] ${tone}`}
    >
      {candidate.zoning ?? "Zoning unverified"}
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

function ShortlistCard({
  candidate,
  number,
  zip,
  enrichment,
  enrichState,
}: {
  candidate: ShortlistCandidate;
  number: number;
  zip: string;
  enrichment: EnrichItem | null;
  enrichState: EnrichState["status"];
}) {
  const viewerUrl = cookViewerUrl(candidate.pin);
  const clerkUrl = clerkRecordsUrl(candidate.pin);
  const accessibility = candidate.showAccessibility
    ? accessibilityNoteFor(enrichment?.countyClass ?? null)
    : null;

  const flags: string[] = [];
  if (candidate.saleYear) flags.push(taxSaleFlag(candidate.saleYear));
  if (candidate.violation) flags.push(VIOLATION_FLAG);
  for (const license of enrichment?.activeLicenses ?? []) {
    flags.push(activeLicenseFlag(license.name));
  }

  return (
    <li className="border border-[#0C1B33]/12 bg-white p-5">
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
        <ZoneBadge candidate={candidate} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact
          label={candidate.propertyType === "vacant_building" ? "Building" : "Building (none)"}
          value={sqft(candidate.buildingSqft)}
        />
        <Fact label="Lot" value={sqft(candidate.lotSqft)} />
        <Fact label="Owner type" value={candidate.ownerLabel} />
        <Fact
          label="Nearest rail"
          value={
            candidate.nearestRail
              ? `${candidate.nearestRail.name} (${candidate.nearestRail.system}) · ${candidate.nearestRail.meters.toLocaleString("en-US")} m, ~${candidate.nearestRail.walkMinutes} min walk`
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

      <p className="mt-4 border-l-2 border-[#2563EB] bg-[#EFF3FB] px-3 py-2 text-[12px] leading-relaxed text-[#0C1B33]/80">
        {candidate.zoningNote}
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
        {candidate.overlays.length > 0
          ? candidate.overlays
              .map((overlay) => (overlay.name ? `${overlay.layer}: ${overlay.name}` : overlay.layer))
              .join(" · ")
          : "None mapped"}
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

      <div className="mt-4 flex flex-wrap gap-2">
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

function TierSection({
  heading,
  description,
  candidates,
  startNumber,
  total,
  cap,
  zip,
  byKey,
  enrichState,
}: {
  heading: string;
  description: string;
  candidates: ShortlistCandidate[];
  startNumber: number;
  total: number;
  cap: number;
  zip: string;
  byKey: Record<string, EnrichItem>;
  enrichState: EnrichState["status"];
}) {
  return (
    <section className="mt-10">
      <h2 className="font-editorial text-[26px] leading-tight text-[#0C1B33]">
        {heading} ({candidates.length})
      </h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/60">{description}</p>
      {total > cap && (
        <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
          {total.toLocaleString("en-US")} records passed the screens here; the {cap} highest-scoring
          are shown.
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="mt-4 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-6 text-center font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
          No records in this tier for these criteria
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {candidates.map((candidate, index) => (
            <ShortlistCard
              key={candidate.key}
              candidate={candidate}
              number={startNumber + index}
              zip={zip}
              enrichment={byKey[candidate.key] ?? null}
              enrichState={enrichState}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SiteShortlistResults({
  zip,
  projectUse,
  source,
  result,
}: {
  zip: string;
  projectUse: SiteProjectUse | null;
  source: string | null;
  result: ShortlistResult;
}) {
  const [enrich, setEnrich] = useState<EnrichState>({ status: "idle" });
  const rendered = useMemo(() => [...result.tier1, ...result.tier2], [result]);

  // Fire the generation event once per mount, mirroring the exactly-once
  // discipline of vacancy_web_report_viewed (VacancyReportMap).
  useEffect(() => {
    trackEvent("site_shortlist_generated", {
      source: source ?? "site-shortlist",
      metadata: {
        zip,
        tier1Count: result.tier1.length,
        tier2Count: result.tier2.length,
        projectUse: projectUse ?? "",
      },
    });
    // Once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One enrichment pass for every rendered card. Never throws: a failure is a
  // display state, and the static half of each card is already on screen.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current || rendered.length === 0) return;
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
            items: rendered.map((candidate) => ({
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
  }, [rendered]);

  const byKey = enrich.status === "loaded" ? enrich.byKey : {};
  const allUnavailable =
    enrich.status === "error" ||
    (enrich.status === "loaded" &&
      rendered.length > 0 &&
      rendered.every((candidate) => byKey[candidate.key]?.enrichmentUnavailable !== false));

  function downloadCsv() {
    const facts: Record<string, ShortlistEnrichmentFacts> = {};
    for (const [key, item] of Object.entries(byKey)) {
      const { key: _key, enrichmentUnavailable: _flag, ...rest } = item;
      facts[key] = rest;
    }
    const blob = new Blob([shortlistCsv(result, facts)], {
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

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={downloadCsv}
          disabled={rendered.length === 0}
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

      <TierSection
        heading={TIER_1_HEADING}
        description={`Districts whose family reads as permitting this use by right — the fastest paths to occupancy. A screening signal only; confirm with the Zoning Board of Appeals.`}
        candidates={result.tier1}
        startNumber={1}
        total={result.tier1Total}
        cap={12}
        zip={zip}
        byKey={byKey}
        enrichState={enrich.status}
      />

      <TierSection
        heading={TIER_2_HEADING}
        description={`Records worth keeping in view whose district family does not read as permitting this use by right. Expect a Special Use approval from the Zoning Board of Appeals, roughly 3 to 5 extra months. Records with no district code sit here too, as unverified.`}
        candidates={result.tier2}
        startNumber={result.tier1.length + 1}
        total={result.tier2Total}
        cap={8}
        zip={zip}
        byKey={byKey}
        enrichState={enrich.status}
      />

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
