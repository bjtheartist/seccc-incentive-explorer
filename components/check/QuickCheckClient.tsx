"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, MapPin, Search, Shield } from "lucide-react";
import { SiteActivityCard } from "@/components/report/SiteActivityCard";
import { fetchSiteActivity, type SiteActivityState } from "@/lib/site-activity-client";
import { SITE_ACTIVITY_ERROR_TEXT } from "@/lib/site-activity-lines";
import { decodeCheckState } from "@/lib/url-state";
import {
  cachedSiteZones,
  fetchSiteZones,
  siteZoneLine,
  siteZonesSummary,
  type SiteZoneState,
} from "@/lib/vacancy-site-zones";

/**
 * QUICK ADDRESS CHECK — the fast, zero-form answer for a single point.
 *
 * Deliberately thin. It runs exactly two public lookups, both of which the
 * address report already runs, and then hands off:
 *
 *   1. `GET /api/zones/check` — which mapped incentive geographies contain the
 *      point, resolved through lib/vacancy-site-zones.ts so this surface
 *      inherits the same honesty rails the Property Map's site card has:
 *      "not inside a mapped geography" is only ever claimed from a lookup that
 *      SUCCEEDED and came back empty, and coverage is never called eligibility.
 *   2. The Site Activity Context card, reused verbatim from the report — raw
 *      public measurements only, every line carrying its own source, vintage,
 *      and disclosed radius. Nothing on this page is modeled.
 *
 * What it deliberately does NOT do: run the confidence engine, rank programs,
 * or render a report. That is /report's job, and the primary CTA carries this
 * exact point straight into it. This page replaced a 506-line client report
 * (components/check/CheckResults.tsx and siblings, dead since ba46b24) that
 * had drifted out of parity with the report engine; a thin surface that defers
 * to /report cannot drift.
 *
 * `/check` with no resolvable lat/lon is an address entry state, never a
 * redirect and never a dead end — the global nav pins "Quick Address Check"
 * here and that link has to land somewhere useful.
 */

/** Shared shell width/rhythm with SiteActivityCard so the stack reads as one. */
const CARD_SHELL = "mx-auto mt-8 max-w-[850px] px-2 sm:px-6";

const SAMPLE_ADDRESSES = [
  "9133 S Stony Island Ave",
  "2404 E 79th St",
  "8100 S Stony Island Ave",
];

const GEOCODE_MISS = "Address not found. Try a street address in Chicago.";

/** EXACTLY the /api/site-activity coverage bounds — a wider client box would
 * let a point pass here and then 422 on the API, reading as a false absence. */
function isPlausibleChicagoPoint(lat: number, lon: number): boolean {
  return lat > 41.6 && lat < 42.1 && lon > -87.95 && lon < -87.5;
}

/** SiteActivityCard renders null on fetch failure (fine inside the report,
 * wrong here where the activity panel is half the page's promise). Probe via
 * the shared memoized client first; on error, say so explicitly. */
function QuickCheckActivity({ lat, lon }: { lat: number; lon: number }) {
  // The probe is keyed to its coordinates instead of being reset inside the
  // effect: a stale probe for other coordinates simply reads as null.
  const key = `${lat},${lon}`;
  const [probeFor, setProbeFor] = useState<{ key: string; state: SiteActivityState } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSiteActivity(lat, lon).then((state) => {
      if (!cancelled) setProbeFor({ key: `${lat},${lon}`, state });
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);
  const probe = probeFor && probeFor.key === key ? probeFor.state : null;
  if (probe?.status === "error") {
    return (
      <section className="mx-auto mt-8 max-w-[850px] px-2 sm:px-6">
        <div className="border border-[#0C1B33]/10 bg-white px-5 py-4 text-[13px] text-[#0C1B33]/70">
          {SITE_ACTIVITY_ERROR_TEXT}
        </div>
      </section>
    );
  }
  if (probe?.status !== "loaded") return null;
  return <SiteActivityCard lat={lat} lon={lon} />;
}

// ── Address entry ────────────────────────────────────────────────────────────

/**
 * Minimal geocode input, consistent with the report wizard's address step
 * (same `/api/geocode?address=` call, same Warm Bureau treatment). Not the home
 * page's AddressSearch: that component is styled for the dark hero and
 * navigates straight to /report, which would defeat the point of this surface.
 */
function AddressEntry() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(
    async (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q || busy) return;

      setBusy(true);
      setError("");
      try {
        const res = await fetch(`/api/geocode?address=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setError(GEOCODE_MISS);
          return;
        }
        const geo = (await res.json()) as {
          lat?: number;
          lon?: number;
          displayName?: string;
        };
        if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) {
          setError(GEOCODE_MISS);
          return;
        }
        if (!isPlausibleChicagoPoint(geo.lat as number, geo.lon as number)) {
          // A weak query can geocode outside Chicago; without this the page
          // bounces back to the entry form with no message at all.
          setError(GEOCODE_MISS);
          return;
        }
        const params = new URLSearchParams({
          lat: (geo.lat as number).toFixed(5),
          lon: (geo.lon as number).toFixed(5),
          address: geo.displayName || q,
        });
        router.push(`/check?${params.toString()}`);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, query, router],
  );

  return (
    <div
      data-testid="quick-check-address-entry"
      className="mx-auto max-w-[640px] px-5 pb-20 pt-14 sm:pt-20"
    >
      <p className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
        Quick address check
      </p>
      <h1 className="mt-2 text-[26px] leading-tight font-semibold text-[#0C1B33] sm:text-[30px]">
        What covers this address?
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-[#0C1B33]/65">
        Enter a Chicago address for its mapped incentive geographies and the raw
        public activity measurements around it. No form, no login.
      </p>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="quick-check-address" className="sr-only">
            Chicago address
          </label>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0C1B33]/25"
            aria-hidden="true"
          />
          <input
            id="quick-check-address"
            type="text"
            autoComplete="street-address"
            placeholder="Enter a Chicago address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            disabled={busy}
            className="h-12 w-full border border-[#0C1B33]/10 bg-white pl-11 pr-4 text-[14px] text-[#0C1B33] placeholder:text-[#0C1B33]/30 focus:border-[#2563EB]/40 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !query.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#2563EB] px-6 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Checking…" : "Check"}
          {!busy && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 border border-[#B91C1C]/20 bg-[#B91C1C]/5 px-4 py-2.5 text-[13px] text-[#B91C1C]"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/30">
          Try
        </span>
        {SAMPLE_ADDRESSES.map((addr) => (
          <button
            key={addr}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuery(addr);
              void submit(addr);
            }}
            className="border border-[#0C1B33]/10 bg-white px-3 py-1.5 font-mono-bureau text-[10px] tracking-wide text-[#0C1B33]/55 transition-colors hover:border-[#0C1B33]/20 hover:text-[#0C1B33] disabled:opacity-40"
          >
            {addr}
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-start gap-2 border-t border-[#0C1B33]/10 pt-4">
        <Shield
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]/50"
          aria-hidden="true"
        />
        <p className="text-[12.5px] leading-relaxed text-[#0C1B33]/55">
          A quick check reports mapped coverage and public measurements only. For
          a program-by-program review and guidance on how published rules may
          interact, {" "}
          <Link
            href="/report"
            className="text-[#2563EB] underline-offset-2 hover:underline"
          >
            generate the full report
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * Mapped-geography coverage for the point. Every state is stated honestly: a
 * failed lookup says it failed rather than rendering as an absence of coverage.
 */
function ZonePanel({ zones }: { zones: SiteZoneState }) {
  return (
    <section data-testid="quick-check-zones" className={CARD_SHELL}>
      <div className="border border-[#0C1B33]/10 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-1 pt-4">
          <h2 className="text-[15px] font-semibold text-[#0C1B33]">
            Mapped incentive geographies
          </h2>
          <p className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
            Coverage — not eligibility
          </p>
        </div>

        <div className="border-t border-[#0C1B33]/8 px-5 py-3.5">
          {zones.status === "idle" || zones.status === "loading" ? (
            <p className="text-[13.5px] text-[#0C1B33]/55">
              Checking mapped geographies at this point…
            </p>
          ) : zones.status === "error" ? (
            <p className="text-[13.5px] leading-snug text-[#0C1B33]/55">
              The zone lookup could not be completed for this point. That is a
              failed check, not a finding that no geography covers this address.
            </p>
          ) : (
            <>
              <p className="text-[13.5px] leading-snug text-[#0C1B33]">
                {siteZonesSummary(zones.matches, zones.unknownKeys, zones.checkedAt)}
              </p>
              {zones.matches.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {zones.matches.map((match) => (
                    <li
                      key={match.key}
                      className="text-[13.5px] leading-snug text-[#0C1B33]"
                    >
                      {siteZoneLine(match)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2.5 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                Point-in-polygon against the mapped boundary layers · each
                program decides its own eligibility
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function QuickCheckResults({
  lat,
  lon,
  address,
  reportHref,
}: {
  lat: number;
  lon: number;
  address: string;
  reportHref: string;
}) {
  // The parent keys this component on the coordinate, so a new point remounts
  // rather than re-syncing — every initializer below is read once, for one site.
  const [zones, setZones] = useState<SiteZoneState>(
    () => cachedSiteZones(lat, lon) ?? { status: "loading" },
  );

  // Mapped coverage. fetchSiteZones never rejects — a failure resolves to
  // {status:"error"}, which the panel renders as a failed check.
  useEffect(() => {
    let cancelled = false;
    void fetchSiteZones(lat, lon).then((state) => {
      if (!cancelled) setZones(state);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  return (
    <div data-testid="quick-check-results" className="min-h-screen pb-4">
      <header className={`${CARD_SHELL} mt-8`}>
        <div className="border border-[#0C1B33]/10 bg-white px-5 py-5">
          <p className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
            Quick address check
          </p>
          <h1 className="mt-1.5 flex items-start gap-2 text-[19px] leading-snug font-semibold text-[#0C1B33]">
            <MapPin
              className="mt-1 h-4 w-4 shrink-0 text-[#2563EB]/70"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">
              {address || "Selected point"}
            </span>
          </h1>
          <p className="mt-1 pl-6 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
            {lat.toFixed(5)}, {lon.toFixed(5)}
          </p>

          <div className="mt-5 flex flex-col gap-2.5 border-t border-[#0C1B33]/10 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="text-[13px] leading-snug text-[#0C1B33]/65">
              Program details, published interactions, and requirements to verify
              are in the full report.
            </p>
            <Link
              href={reportHref}
              data-testid="quick-check-report-cta"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-[#2563EB] px-6 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#1D4ED8]"
            >
              Generate Full Report →
            </Link>
          </div>
        </div>
      </header>

      <ZonePanel zones={zones} />

      <QuickCheckActivity lat={lat} lon={lon} />
    </div>
  );
}

// ── Entry ────────────────────────────────────────────────────────────────────

export function QuickCheckClient() {
  const searchParams = useSearchParams();

  const state = useMemo(() => decodeCheckState(searchParams), [searchParams]);

  /**
   * The full-report deep link for this exact point — the same instant-report
   * shape ReportDisplay and the map panel build, plus any wizard context the
   * incoming /check URL already carried (`sector`, base64 `sa`), passed through
   * untouched rather than decoded and re-encoded. `src` attributes the report
   * back to this surface.
   */
  const reportHref = useMemo(() => {
    if (!state) return "/report";
    const params = new URLSearchParams();
    params.set("instant", "true");
    params.set("lat", state.lat.toFixed(5));
    params.set("lon", state.lon.toFixed(5));
    if (state.address) params.set("addr", state.address);
    const sector = searchParams.get("sector");
    if (sector) params.set("sector", sector);
    const surveyAnswers = searchParams.get("sa");
    if (surveyAnswers) params.set("sa", surveyAnswers);
    params.set("src", "/check");
    return `/report?${params.toString()}`;
  }, [searchParams, state]);

  // An unresolvable or off-map point falls back to address entry rather than
  // running lookups that can only answer "nothing here".
  if (!state || !isPlausibleChicagoPoint(state.lat, state.lon)) {
    return <AddressEntry />;
  }

  return (
    <QuickCheckResults
      key={`${state.lat},${state.lon}`}
      lat={state.lat}
      lon={state.lon}
      address={state.address}
      reportHref={reportHref}
    />
  );
}
