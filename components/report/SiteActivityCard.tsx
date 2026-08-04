"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { SourceRef } from "@/lib/site-activity";
import {
  SITE_ACTIVITY_NOTE,
  absenceStatement,
  arterialVintage,
  catchmentVintage,
  formatCount,
  licenseCategoryPhrase,
  licenseOtherCount,
  sourceText,
} from "@/lib/site-activity-lines";
import {
  fetchSiteActivity,
  type SiteActivityState,
} from "@/lib/site-activity-client";

/**
 * Site Activity Context — five RAW public measurements around the report
 * address, every line carrying its own source, vintage, and disclosed radius.
 *
 * Deliberately absent: any combined "foot traffic" / "visitor volume" number.
 * The card's credibility IS the absence — each line is independently checkable
 * against the government dataset it names, and nothing here is modeled. A
 * measure with nothing in radius renders as an explicit absence, never zero.
 *
 * This card is report CONTENT (it prints), unlike the cross-link banners.
 *
 * The sentences themselves live in lib/site-activity-lines.ts, shared verbatim
 * with the COMPACT variant inside the Vacant Sites map card
 * (components/vacancy/vacancy-site-card.ts): the full card and the compact one
 * make the same claims about the same point, and a wording or provenance fix
 * can only be made in one place. Resolution goes through
 * lib/site-activity-client.ts, which turns a failed or malformed response into
 * an explicit error state rather than a set of empty measures.
 */

function SourceLine({ source, vintage }: { source: SourceRef; vintage?: string }) {
  return (
    <p className="mt-1 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
      {sourceText(source, vintage)}{" "}
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-[#2563EB]/80 underline-offset-2 hover:underline print:hidden"
      >
        verify
        <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
      </a>
    </p>
  );
}

function Row({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[#0C1B33]/8 px-5 py-3.5 first:border-t-0">
      <p className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
        {heading}
      </p>
      <div className="mt-1 text-[13.5px] leading-snug text-[#0C1B33]">{children}</div>
    </div>
  );
}

export function SiteActivityCard({
  lat,
  lon,
  zoningClass,
  zoningDescription,
}: {
  lat: number;
  lon: number;
  zoningClass?: string | null;
  zoningDescription?: string | null;
}) {
  // The resolved point travels WITH its state, so a report that re-points at a
  // new address can never show the previous address's measurements while the
  // new lookup is in flight.
  const [resolved, setResolved] = useState<{
    lat: number;
    lon: number;
    state: SiteActivityState;
  } | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSiteActivity(lat, lon).then((state) => {
      if (!cancelled) setResolved({ lat, lon, state });
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  // A fetch failure quietly renders nothing — the report must never show a
  // half-built context that could read as "nothing is near this address".
  if (!resolved || resolved.lat !== lat || resolved.lon !== lon) return null;
  if (resolved.state.status !== "loaded") return null;

  const { context, sources } = resolved.state;
  const { arterial, rail, catchment, licenses, radii } = context;
  const nearestRail = rail[0];
  const otherLicenses = licenses ? licenseOtherCount(licenses) : null;

  return (
    <section
      data-testid="site-activity-card"
      className="mx-auto mt-8 max-w-[850px] px-2 sm:px-6"
    >
      <div className="border border-[#0C1B33]/10 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-4">
          <h2 className="text-[15px] font-semibold text-[#0C1B33]">Site activity context</h2>
          <p className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
            {SITE_ACTIVITY_NOTE}
          </p>
        </div>

        <Row heading="Arterial vehicle flow">
          {arterial ? (
            <>
              <strong>{formatCount(arterial.aadt)}</strong> vehicles/day on {arterial.roadName} (
              {arterial.aadtYear} count, station {arterial.stationId}, {arterial.distanceMi} mi away)
              <SourceLine source={sources.aadt} vintage={arterialVintage(arterial)} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">{absenceStatement("arterial", radii)}</span>
          )}
        </Row>

        <Row heading="'L' station entries">
          {nearestRail ? (
            <>
              <strong>{formatCount(Math.round(nearestRail.avgWeekdayEntries))}</strong> avg weekday
              entries at {nearestRail.name} ({nearestRail.lines.join(", ")};{" "}
              {nearestRail.distanceMi} mi away, {nearestRail.month})
              {nearestRail.priorYearAvgWeekdayEntries != null && (
                <span className="text-[#0C1B33]/55">
                  {" "}
                  — prior year {formatCount(Math.round(nearestRail.priorYearAvgWeekdayEntries))}
                </span>
              )}
              {rail.length > 1 && (
                <span className="text-[#0C1B33]/55">
                  {" "}
                  (+{rail.length - 1} more station{rail.length > 2 ? "s" : ""} within{" "}
                  {radii.railMi} mi)
                </span>
              )}
              <SourceLine source={sources.rail} vintage={nearestRail.month} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">{absenceStatement("rail", radii)}</span>
          )}
        </Row>

        <Row heading={`Residents & jobs within ${radii.catchmentMi} mi`}>
          {catchment ? (
            <>
              <strong>{formatCount(catchment.population)}</strong> residents ·{" "}
              <strong>{formatCount(catchment.jobs)}</strong> jobs ({catchment.blockGroups} census
              block groups by centroid)
              <SourceLine source={sources.catchment} vintage={catchmentVintage(catchment)} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">{absenceStatement("catchment", radii)}</span>
          )}
        </Row>

        <Row heading={`Licensed businesses within ${radii.licenseMi} mi`}>
          {licenses ? (
            <>
              <strong>{formatCount(licenses.total)}</strong> active licenses —{" "}
              {licenseCategoryPhrase(licenses)}
              {otherLicenses != null && (
                <span className="text-[#0C1B33]/55"> (+{otherLicenses} other licensed)</span>
              )}
              <SourceLine source={sources.licenses} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">{absenceStatement("licenses", radii)}</span>
          )}
        </Row>

        {zoningClass && (
          <Row heading="Zoning">
            <strong>{zoningClass}</strong>
            {zoningDescription ? ` (${zoningDescription})` : null}
            <p className="mt-1 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
              City of Chicago zoning ordinance · from this report&apos;s zone lookup
            </p>
          </Row>
        )}

        <div className="border-t border-[#0C1B33]/8 px-5 py-3">
          <button
            type="button"
            onClick={() => setMethodOpen((v) => !v)}
            aria-expanded={methodOpen}
            className="flex items-center gap-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/70 hover:text-[#0C1B33] print:hidden"
          >
            How these numbers are measured
            <ChevronDown
              className={`h-3 w-3 transition-transform ${methodOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {methodOpen && (
            <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-[#0C1B33]/70">
              <p>
                Every line above is an un-manipulated figure from the public dataset it names,
                filtered only by distance from this address: nearest traffic-count station within{" "}
                {radii.arterialMi} mi, &apos;L&apos; stations within {radii.railMi} mi, census
                block groups whose centroid falls within {radii.catchmentMi} mi, and active
                business licenses within {radii.licenseMi} mi.
              </p>
              <p>
                Nothing is estimated, weighted, or combined — this platform does not publish
                modeled foot-traffic figures. Absences are stated as absences, never as zero.
                Each dataset can be inspected directly through its verify link.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
