"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import {
  LICENSE_CATEGORY_LABELS,
  type SiteActivityContext,
  type SourceRef,
} from "@/lib/site-activity";

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
 */

interface Payload {
  context: SiteActivityContext;
  sources: Record<"aadt" | "rail" | "catchment" | "licenses", SourceRef>;
}

const nf = new Intl.NumberFormat("en-US");

function SourceLine({ source, vintage }: { source: SourceRef; vintage?: string }) {
  return (
    <p className="mt-1 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
      {source.label} · {vintage ?? source.vintage}{" "}
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
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/site-activity?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Payload) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  // A fetch failure quietly renders nothing — the report must never show a
  // half-built context that could read as "nothing is near this address".
  if (failed) return null;
  if (!payload) return null;

  const { context, sources } = payload;
  const { arterial, rail, catchment, licenses, radii } = context;
  const nearestRail = rail[0];

  return (
    <section
      data-testid="site-activity-card"
      className="mx-auto mt-8 max-w-[850px] px-2 sm:px-6"
    >
      <div className="border border-[#0C1B33]/10 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-4">
          <h2 className="text-[15px] font-semibold text-[#0C1B33]">Site activity context</h2>
          <p className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
            Raw public measurements — nothing modeled
          </p>
        </div>

        <Row heading="Arterial vehicle flow">
          {arterial ? (
            <>
              <strong>{nf.format(arterial.aadt)}</strong> vehicles/day on {arterial.roadName} (
              {arterial.aadtYear} count, station {arterial.stationId}, {arterial.distanceMi} mi away)
              <SourceLine source={sources.aadt} vintage={`${arterial.aadtYear} count year`} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">
              No IDOT count station within {radii.arterialMi} mi of this address.
            </span>
          )}
        </Row>

        <Row heading="'L' station entries">
          {nearestRail ? (
            <>
              <strong>{nf.format(Math.round(nearestRail.avgWeekdayEntries))}</strong> avg weekday
              entries at {nearestRail.name} ({nearestRail.lines.join(", ")};{" "}
              {nearestRail.distanceMi} mi away, {nearestRail.month})
              {nearestRail.priorYearAvgWeekdayEntries != null && (
                <span className="text-[#0C1B33]/55">
                  {" "}
                  — prior year {nf.format(Math.round(nearestRail.priorYearAvgWeekdayEntries))}
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
            <span className="text-[#0C1B33]/55">
              No &apos;L&apos; station within {radii.railMi} mi of this address.
            </span>
          )}
        </Row>

        <Row heading={`Residents & jobs within ${radii.catchmentMi} mi`}>
          {catchment ? (
            <>
              <strong>{nf.format(catchment.population)}</strong> residents ·{" "}
              <strong>{nf.format(catchment.jobs)}</strong> jobs ({catchment.blockGroups} census
              block groups by centroid)
              <SourceLine
                source={sources.catchment}
                vintage={`${catchment.acsVintage} · ${catchment.lodesVintage}`}
              />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">
              No census block-group centroid within {radii.catchmentMi} mi.
            </span>
          )}
        </Row>

        <Row heading={`Licensed businesses within ${radii.licenseMi} mi`}>
          {licenses ? (
            <>
              <strong>{nf.format(licenses.total)}</strong> active licenses —{" "}
              {licenses.byCategory
                .filter((c) => c.category !== "other")
                .slice(0, 4)
                .map((c) => `${c.count} ${(LICENSE_CATEGORY_LABELS[c.category] ?? c.category).toLowerCase()}`)
                .join(", ")}
              {licenses.byCategory.some((c) => c.category === "other") && (
                <span className="text-[#0C1B33]/55">
                  {" "}
                  (+{licenses.byCategory.find((c) => c.category === "other")?.count} other licensed)
                </span>
              )}
              <SourceLine source={sources.licenses} />
            </>
          ) : (
            <span className="text-[#0C1B33]/55">
              No active business license on record within {radii.licenseMi} mi.
            </span>
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
