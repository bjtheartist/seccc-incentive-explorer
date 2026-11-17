import {
  deadlinesForAddress,
  type DeadlineItem,
  type ProgramCardSlim,
  type SbifWindow,
  type TifFinancialsSlim,
} from "@/lib/deadlines";
import type { TifBoundaryContext } from "@/lib/tif-boundary";
import type { Program } from "@/lib/types";
import { runConfidenceEngine } from "@/lib/confidence-engine";
import { normalizeZoneEvidenceV2 } from "@/lib/zone-response";
import { bridgeZoneEvidenceV2ToBooleanMap } from "@/lib/zone-evidence-bridge";
import { loadSbifRollout } from "@/lib/report-engine";

/**
 * Weekly watched-area digest logic.
 *
 * Pure/assessment functions live here so the cron route stays thin and the
 * logic is unit-testable with injected resolvers. Deadline windowing and
 * act-soon logic is reused from lib/deadlines — not re-implemented.
 */

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Flag a watched area's TIF district when it expires within this many days. */
export const TIF_EXPIRING_WITHIN_DAYS = 365; // ~12 months
/** Escalate the flag to "urgent" within this many days of expiration. */
export const TIF_URGENT_WITHIN_DAYS = 120;
/** Program/zone sunsets within this many days are included. */
export const PROGRAM_DEADLINE_WINDOW_DAYS = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WatchedAreaRow {
  areaType: string;
  areaId: string;
  areaLabel: string | null;
  createdAt?: string;
}

export interface TifExpirationFinding {
  districtId: string;
  districtName: string;
  expirationDate: string;
  daysRemaining: number;
  urgent: boolean;
}

export interface AreaAssessment {
  areaId: string;
  areaLabel: string;
  lat: number;
  lon: number;
  tif: TifExpirationFinding | null;
  deadlines: DeadlineItem[];
  /** True when this area contributes at least one item worth emailing about. */
  notable: boolean;
  /**
   * review7 S22 (HIGH, BLOCKING — not a separable UX enhancement): true
   * when this area's zone evidence for the week was incomplete — either
   * `checkZones` failed/returned an unparseable response entirely, one
   * or more layers came back v2 `unknown` (bridged to `false` for the
   * boolean map `runConfidenceEngine` requires, per
   * `bridgeZoneEvidenceV2ToBooleanMap`'s own documented behavior), or the
   * whole per-area assessment threw. `deadlines`/`tif` above are still
   * whatever COULD be resolved (known positives are never discarded just
   * because something else was incomplete) — this flag exists so the
   * digest email can render a visible caveat instead of silently
   * presenting a thin or empty result as a confirmed "nothing due,"
   * which is the exact false-negative class this whole zone-evidence
   * migration exists to close. `notable` below is TRUE whenever this is
   * true, even with zero findings otherwise — an area where zone data
   * could not be verified is always worth surfacing, specifically so the
   * caveat has somewhere to render.
   */
  zoneDataIncomplete: boolean;
  /** A matched TIF district could not be checked against the rollout calendar. */
  sbifDataIncomplete?: boolean;
}

export interface AreaResolvers {
  findTifBoundary: (lat: number, lon: number) => Promise<TifBoundaryContext | null>;
  /** Zone evidence at the point, in /api/zones/check/v2 response shape
   *  (review6 S16 — was v1's /api/zones/check response shape). */
  checkZones: (lat: number, lon: number) => Promise<unknown>;
  programs: Program[];
  tifFinancials: Record<string, TifFinancialsSlim> | null;
  sbifRollout: SbifWindow[] | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a point-type watched area id ("lat,lon", 4-decimal rounded by the UI)
 * back into coordinates. Returns null for malformed or non-point ids.
 */
export function parsePointAreaId(
  areaId: string
): { lat: number; lon: number } | null {
  const parts = areaId.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2) return null;
  const [lat, lon] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function parseDateOnly(s: string): Date | null {
  const match = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const iso = match ? match[0] : null;
  const d = iso
    ? new Date(dateNumber(iso))
    : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Flag a TIF district whose expiration falls within the digest window.
 * Returns null when the district has no parseable expiration, already
 * expired, or expires further out than TIF_EXPIRING_WITHIN_DAYS.
 */
export function assessTifExpiration(
  boundary: TifBoundaryContext | null,
  today: Date
): TifExpirationFinding | null {
  if (!boundary?.expirationDate) return null;
  const expiry = parseDateOnly(boundary.expirationDate);
  if (!expiry) return null;

  const daysRemaining = Math.round(
    (dateNumber(expiry.toISOString().slice(0, 10)) - chicagoDateNumber(today)) / 86_400_000
  );
  if (daysRemaining < 0 || daysRemaining > TIF_EXPIRING_WITHIN_DAYS) return null;

  return {
    districtId: boundary.districtId,
    districtName: boundary.districtName,
    expirationDate: boundary.expirationDate,
    daysRemaining,
    urgent: daysRemaining <= TIF_URGENT_WITHIN_DAYS,
  };
}

/**
 * Flatten a program's deadline fields into ProgramCardSlim entries.
 * Mirrors how the report engine reads both the newer deadlines[] array and
 * the legacy flat `deadline` string.
 */
export function programDeadlineSlims(programs: Program[]): ProgramCardSlim[] {
  return programs.flatMap((p) => {
    const deadlineArr: Array<{ label?: string; date: string }> =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p as any).deadlines ?? [];
    if (deadlineArr.length > 0) {
      return deadlineArr.map((d) => ({
        id: p.id,
        name: d.label ? `${p.name} — ${d.label}` : p.name,
        deadline: d.date ?? null,
        deadlineNote: ["economicEmpowermentCenters", "nsfSeedFund"].includes(p.id)
          ? `Applicant requirements: ${p.whoQualifies}` : undefined,
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatDeadline = (p as any).deadline as string | null | undefined;
    if (flatDeadline) {
      return [{ id: p.id, name: p.name, deadline: flatDeadline }];
    }
    return [];
  });
}

// ── Assessment ────────────────────────────────────────────────────────────────

/**
 * Assess one watched point: TIF expiration at the point plus program/zone
 * deadlines (90-day window) for programs matched at the point.
 */
export async function assessWatchedArea(
  area: WatchedAreaRow,
  resolvers: AreaResolvers,
  today: Date = new Date()
): Promise<AreaAssessment | null> {
  const point = parsePointAreaId(area.areaId);
  if (!point) return null;

  let tif: TifExpirationFinding | null = null;
  let deadlines: DeadlineItem[] = [];
  // review7 S22 (HIGH, BLOCKING): was tracked nowhere — S16 migrated the
  // zone lookup to v2 but discarded `unknownKeys`/`hasUnknown`
  // immediately after bridging to the boolean map, so an area whose zone
  // data was genuinely incomplete that week looked IDENTICAL to an area
  // with a confirmed, fully-resolved zero findings. Sol's review ruled
  // this the exact false-negative class the v1->v2 migration exists to
  // close, not a separable UX nicety: a real deadline could be silently
  // omitted while the email still reads as a complete, confirmed digest.
  let zoneDataIncomplete = false;
  let sbifDataIncomplete = false;
  try {
    // review8 S27 (HIGH, BLOCKING): this try block used to start AFTER
    // `boundary`/`zoneResponse` were already resolved below — each
    // resolver call had its own `.catch(() => null)`, but that only
    // catches a REJECTED promise. A resolver that throws SYNCHRONOUSLY
    // (before it ever returns a promise to attach `.catch()` to) isn't
    // caught by that per-call `.catch()` at all — the throw propagates
    // out of `assessWatchedArea` itself, rejecting the promise this
    // function returns. The route's own outer `.catch(() => null)`
    // (app/api/cron/watchlist-digest/route.ts) then converts that
    // rejection to `null`, and the area is silently dropped from the
    // digest with no caveat — even though this docstring's own
    // `zoneDataIncomplete` comment already claimed "or the whole
    // per-area assessment threw" as a covered case. It wasn't. Moving
    // the resolver-invocation step INSIDE this try (rather than adding a
    // second, separate try) means any failure anywhere in a valid
    // point's assessment — a synchronous throw, a resolver's own
    // rejected promise (the per-call `.catch(() => null)` below still
    // absorbs those independently, so a single resolver failing doesn't
    // discard the OTHER resolver's real result), or an internal
    // computation error — lands in the SAME catch below and produces a
    // valid, notable, `zoneDataIncomplete: true` result instead of ever
    // rejecting this function's own promise.
    const [boundary, zoneResponse] = await Promise.all([
      resolvers.findTifBoundary(point.lat, point.lon).catch(() => null),
      resolvers.checkZones(point.lat, point.lon).catch(() => null),
    ]);

    tif = assessTifExpiration(boundary, today);
    sbifDataIncomplete = Boolean(boundary && (!resolvers.sbifRollout?.length ||
      (!resolvers.tifFinancials?.[boundary.districtId]?.tifName && !boundary.districtName)));

    const evidence = normalizeZoneEvidenceV2(zoneResponse);
    if (evidence) {
      const { zones, zoneNames, unknownKeys } = bridgeZoneEvidenceV2ToBooleanMap(evidence);
      zoneDataIncomplete = unknownKeys.length > 0;
      const matched = runConfidenceEngine(
        resolvers.programs,
        zones,
        zoneNames
      ).filter((r) => r.relevance !== "not_mapped_at_location");

      const summary = deadlinesForAddress({
        // SBIF catalog dates describe several districts, not this location.
        // Only the separately matched district rollout may produce its deadline.
        matchedPrograms: programDeadlineSlims(matched.map((r) => r.program).filter((p) => p.id !== "sbif")),
        tifDistrict: boundary?.districtId ?? null,
        // Boundary resolution already supplies the district name. Do not lose
        // a valid rollout match just because the optional financial file is absent.
        tifFinancials: boundary?.districtName && !resolvers.tifFinancials?.[boundary.districtId]?.tifName
          ? { ...resolvers.tifFinancials, [boundary.districtId]: {
              tifNumber: boundary.districtId, tifName: boundary.districtName,
              expirationDate: null, expirationYear: null, expiresWithin24Months: false,
            } }
          : resolvers.tifFinancials,
        sbifRollout: resolvers.sbifRollout,
        today,
        deadlineWindowDays: PROGRAM_DEADLINE_WINDOW_DAYS,
      });
      deadlines = summary.allItems.filter(
        (item) =>
          !item.isPast &&
          // TIF expiration is reported via the boundary-based finding above
          // (12-month/120-day thresholds); avoid double-counting it here.
          item.kind !== "tif_expiration" &&
          item.daysFromToday <= PROGRAM_DEADLINE_WINDOW_DAYS
      );
    } else {
      // checkZones failed outright, or returned a response
      // normalizeZoneEvidenceV2 couldn't parse — MORE incomplete than a
      // partial unknown-layers case, not less: zero zone evidence at
      // all for this point this week.
      zoneDataIncomplete = true;
    }
  } catch (err) {
    console.error("watchlist digest: area assessment degraded", area.areaId, err);
    deadlines = [];
    zoneDataIncomplete = true;
  }

  return {
    areaId: area.areaId,
    areaLabel: area.areaLabel || area.areaId,
    lat: point.lat,
    lon: point.lon,
    tif,
    deadlines,
    // review7 S22: `zoneDataIncomplete` added to the "worth including"
    // condition — an area whose zone data couldn't be verified this week
    // is always notable, even with zero other findings, specifically so
    // the digest email has somewhere to render the caveat. Without this,
    // the worst case (checkZones failed entirely) produced tif=null,
    // deadlines=[], notable=false — silently DROPPED from the email
    // altogether, the exact false-negative this finding is about.
    notable: Boolean(tif) || deadlines.length > 0 || zoneDataIncomplete || sbifDataIncomplete,
    zoneDataIncomplete,
    sbifDataIncomplete,
  };
}

// ── Static data loaders (server-only) ────────────────────────────────────────

/** Load tif-financials.json districts map; null when missing/empty. */
export function loadTifFinancialsMap(): Record<string, TifFinancialsSlim> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/tif-financials.json") as {
      districts?: Record<string, TifFinancialsSlim>;
    };
    if (!raw?.districts || Object.keys(raw.districts).length === 0) return null;
    return raw.districts;
  } catch {
    return null;
  }
}

export { loadSbifRollout };

// ── Email rendering ───────────────────────────────────────────────────────────

const SITE_URL = "https://chicagoincentiveexplorer.com";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 60) return `in ${days} days`;
  return `in about ${Math.round(days / 30.44)} months`;
}

/** One dated event, with its matching watched locations retained. */
export interface DigestDeadlineEvent {
  item: DeadlineItem;
  areas: AreaAssessment[];
}

function chicagoDateNumber(date: Date): number {
  const iso = date.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return Date.parse(`${iso}T00:00:00Z`);
}

function dateNumber(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
  const value = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === iso
    ? value : NaN;
}

/** A snapshot, not a change detector. Calendar dates use America/Chicago. */
export function buildDigestSummary(areas: AreaAssessment[], today: Date = new Date()) {
  const events = new Map<string, DigestDeadlineEvent>();
  const tifs = new Map<string, { finding: TifExpirationFinding; areas: AreaAssessment[] }>();
  const incompleteAreas = [...new Map(areas.filter((area) => area.zoneDataIncomplete || area.sbifDataIncomplete).map((area) => [area.areaId, area])).values()];
  const invalidDates = new Map<string, AreaAssessment>();
  const day = chicagoDateNumber(today);
  for (const area of areas) {
    if (area.tif) {
      const daysRemaining = Math.round((dateNumber(area.tif.expirationDate.slice(0, 10)) - day) / 86_400_000);
      if (!Number.isFinite(daysRemaining)) invalidDates.set(area.areaId, area);
      if (daysRemaining >= 0 && daysRemaining <= TIF_EXPIRING_WITHIN_DAYS) {
        const key = JSON.stringify([area.tif.districtId, area.tif.expirationDate]);
        const entry = tifs.get(key) ?? {
          finding: { ...area.tif, daysRemaining, urgent: daysRemaining <= TIF_URGENT_WITHIN_DAYS }, areas: [],
        };
        if (!entry.areas.some((a) => a.areaId === area.areaId)) entry.areas.push(area);
        tifs.set(key, entry);
      }
    }
    for (const original of area.deadlines) {
      if (original.kind === "tif_expiration") continue;
      // An application window's closing date is the actionable deadline;
      // its opening date must not make an already-open window look overdue.
      const date = original.kind === "sbif_window" ? original.windowEnd ?? original.date : original.date;
      const daysFromToday = Math.round((dateNumber(date) - day) / 86_400_000);
      if (!Number.isFinite(daysFromToday)) invalidDates.set(area.areaId, area);
      if (!(daysFromToday >= 0 && daysFromToday <= PROGRAM_DEADLINE_WINDOW_DAYS)) continue;
      const item = { ...original, date, daysFromToday, isPast: false };
      const key = JSON.stringify([item.kind, item.programId ?? item.tifDistrict ?? item.label, item.date, item.label]);
      const entry = events.get(key) ?? { item, areas: [] };
      if (!entry.areas.some((a) => a.areaId === area.areaId)) entry.areas.push(area);
      events.set(key, entry);
    }
  }
  const deadlines = [...events.values()].sort((a, b) => a.item.daysFromToday - b.item.daysFromToday || a.item.label.localeCompare(b.item.label));
  return {
    dueThisWeek: deadlines.filter((event) => event.item.daysFromToday < 7),
    planAhead: deadlines.filter((event) => event.item.daysFromToday >= 7),
    tifExpirations: [...tifs.values()].sort((a, b) => a.finding.daysRemaining - b.finding.daysRemaining),
    incompleteAreas,
    invalidDateAreas: [...invalidDates.values()],
    uniqueDeadlineCount: deadlines.length,
    areaMatchCount: deadlines.reduce((sum, event) => sum + event.areas.length, 0),
  };
}

/** Group deadlines once, label the horizon honestly, and preserve data caveats. */
export function buildDigestEmailHtml(
  userName: string | null,
  areas: AreaAssessment[],
  today: Date = new Date()
): { subject: string; html: string } {
  const summary = buildDigestSummary(areas, today);
  const incomplete = summary.incompleteAreas.length > 0 || summary.invalidDateAreas.length > 0;
  const subject = `Watched areas: ${summary.dueThisWeek.length} due in the next 7 days; ${summary.planAhead.length} later deadline${summary.planAhead.length === 1 ? "" : "s"}${summary.tifExpirations.length ? `; ${summary.tifExpirations.length} TIF expiration${summary.tifExpirations.length === 1 ? "" : "s"}` : ""}${incomplete ? " — data incomplete" : ""}`;
  const areaLinks = (matches: AreaAssessment[]) => matches.map((area) => {
    const href = `${SITE_URL}/map?lat=${area.lat}&lon=${area.lon}&label=${encodeURIComponent(area.areaLabel)}`;
    return `<a href="${escapeHtml(href)}" style="color:#2563EB;">${escapeHtml(area.areaLabel)}</a>`;
  }).join(", ");
  const renderEvents = (events: DigestDeadlineEvent[]) => events.map(({ item, areas: matches }) => `
    <li style="margin:0 0 18px;">
      <strong>${escapeHtml(item.label)}</strong>
      <div>${escapeHtml(item.date)} — ${formatDays(item.daysFromToday)}${item.note ? `. ${escapeHtml(item.note)}` : ""}</div>
      <div style="font-size:12px;color:#6B7280;">Matched areas: ${areaLinks(matches)}</div>
    </li>`).join("");
  const empty = incomplete ? "No confirmed deadlines shown in this window. Some data could not be verified." : "No deadlines found in the current catalog for this window.";
  const tifs = summary.tifExpirations.map(({ finding, areas: matches }) => `
    <li style="margin-bottom:18px;">TIF district expiration — ${escapeHtml(finding.districtName)}
      <div>${finding.urgent ? "<strong>Urgent — </strong>" : ""}Expires ${formatDays(finding.daysRemaining)} (${escapeHtml(finding.expirationDate)}).</div>
      <div>Matched areas: ${areaLinks(matches)}</div>
    </li>`).join("");
  const caveats = summary.incompleteAreas.map((area) => `
    <p style="background:#FFFBEB;border-left:3px solid #D97706;padding:10px;">
      ${areaLinks([area])}: ${area.zoneDataIncomplete ? "Some incentive-geography data could not be verified for this location this week." : "The SBIF rollout calendar could not be verified for this location."}
      This area may have deadlines not shown here — check the map for current status.
    </p>`).join("");
  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;color:#0C1B33;">
      <div style="background:#0C1B33;padding:32px 24px;">
        <h1 style="color:#fff;font-size:20px;">Weekly Watched-Area Digest</h1>
        <p style="color:#fff;font-size:13px;">Chicago Incentive Explorer — Southeast Chicago Chamber of Commerce</p>
      </div>
      <div style="padding:24px;">
        <p>${userName ? `Hi ${escapeHtml(userName)}, here` : "Here"} is your current watched-area snapshot:
          ${summary.uniqueDeadlineCount} unique deadline event${summary.uniqueDeadlineCount === 1 ? "" : "s"} across ${summary.areaMatchCount} area match${summary.areaMatchCount === 1 ? "" : "es"}.
          Location matches are discovery signals, not eligibility determinations.</p>
        <p>As of ${escapeHtml(today.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }))} (America/Chicago).
          Program and application-window deadlines: today through 90 days ahead. Confirm exact cutoff times with the administering agency.</p>
        ${caveats}
        ${summary.invalidDateAreas.length ? `<p>Some deadline dates could not be verified for ${areaLinks(summary.invalidDateAreas)}. These areas may have deadlines not shown here; confirm timing with the administering agency.</p>` : ""}
        <h2 style="font-size:17px;">Next 7 days — including today</h2>
        ${summary.dueThisWeek.length ? `<ul>${renderEvents(summary.dueThisWeek)}</ul>` : `<p>${empty}</p>`}
        <h2 style="font-size:17px;">Plan ahead — 7 to 90 days away</h2>
        ${summary.planAhead.length ? `<ul>${renderEvents(summary.planAhead)}</ul>` : `<p>${empty}</p>`}
        ${tifs ? `<h2 style="font-size:17px;">TIF district expirations — next 12 months (365 days)</h2><p>Separate from application deadlines. Confirm program timing with the administering agency.</p><ul>${tifs}</ul>` : ""}
        <p style="font-size:12px;color:#6B7280;">Deadline data comes from public sources and program listings. This snapshot may not include every opportunity. Confirm timing and applicant requirements with the administering agency before relying on it.</p>
        <a href="${SITE_URL}/workspace" style="color:#2563EB;">Manage watched areas in your workspace</a>
      </div>
    </div>`;
  return { subject, html };
}
