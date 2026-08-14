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
    ? new Date(`${iso}T00:00:00Z`)
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
    (expiry.getTime() - today.getTime()) / 86_400_000
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

  // Every per-area lookup degrades to "no info for this facet" on failure —
  // one bad area (e.g. a point that trips malformed source geometry) must
  // never sink the user's whole digest email.
  const [boundary, zoneResponse] = await Promise.all([
    resolvers.findTifBoundary(point.lat, point.lon).catch(() => null),
    resolvers.checkZones(point.lat, point.lon).catch(() => null),
  ]);

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
  try {
    tif = assessTifExpiration(boundary, today);

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
        matchedPrograms: programDeadlineSlims(matched.map((r) => r.program)),
        tifDistrict: boundary?.districtId ?? null,
        tifFinancials: resolvers.tifFinancials,
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
    notable: Boolean(tif) || deadlines.length > 0 || zoneDataIncomplete,
    zoneDataIncomplete,
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

/**
 * Bureau-minimal, text-forward weekly digest email. One email covers all of a
 * user's watched areas; only notable areas are rendered.
 */
export function buildDigestEmailHtml(
  userName: string | null,
  areas: AreaAssessment[]
): { subject: string; html: string } {
  const notable = areas.filter((a) => a.notable);
  const itemCount = notable.reduce(
    (sum, a) => sum + (a.tif ? 1 : 0) + a.deadlines.length,
    0
  );
  const subject = `Watched areas: ${itemCount} upcoming deadline${itemCount === 1 ? "" : "s"} this week`;

  const areaBlocks = notable
    .map((area) => {
      const rows: string[] = [];
      if (area.tif) {
        const urgency = area.tif.urgent
          ? `<strong style="color:#B91C1C;">Urgent — expires ${formatDays(area.tif.daysRemaining)}</strong>`
          : `Expires ${formatDays(area.tif.daysRemaining)}`;
        rows.push(
          `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;font-size:13px;color:#0C1B33;">
              TIF district expiration — ${escapeHtml(area.tif.districtName)}
              <div style="font-size:12px;color:#6B7280;margin-top:2px;">${urgency} (${escapeHtml(area.tif.expirationDate)}). TIF-funded programs at this location close with the district.</div>
            </td>
          </tr>`
        );
      }
      for (const item of area.deadlines) {
        rows.push(
          `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;font-size:13px;color:#0C1B33;">
              ${escapeHtml(item.label)}
              <div style="font-size:12px;color:#6B7280;margin-top:2px;">${escapeHtml(item.date)} — ${formatDays(item.daysFromToday)}${item.note ? `. ${escapeHtml(item.note)}` : ""}</div>
            </td>
          </tr>`
        );
      }

      const mapLink = `${SITE_URL}/map?lat=${area.lat}&lon=${area.lon}&label=${encodeURIComponent(area.areaLabel)}`;
      // review7 S22 (HIGH, BLOCKING): a visible caveat wherever this
      // area's zone data may be incomplete — never an unqualified
      // "complete" digest for it. Rendered whether or not `rows` also
      // has confirmed findings (known positives above are never hidden
      // by this — S2/S3's "both must render" discipline, applied here):
      // an area with real deadlines AND incomplete zone data shows both;
      // an area with NO confirmed findings but incomplete zone data
      // still appears (via `notable` above) with ONLY this caveat,
      // rather than being silently dropped from the email.
      const caveat = area.zoneDataIncomplete
        ? `<p style="font-size:12px;color:#92400E;background:#FFFBEB;border-left:3px solid #D97706;padding:8px 10px;margin:${rows.length > 0 ? "8px" : "0"} 0 0;">
             Some incentive-geography data could not be verified for this location this week. ${rows.length > 0 ? "The items above may be incomplete" : "This area may have deadlines not shown here"} — check the map for current status.
           </p>`
        : "";
      const table = rows.length > 0
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E5E7EB;">${rows.join("")}</table>`
        : "";
      return `
        <div style="margin:0 0 28px;">
          <p style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#2563EB;margin:0 0 6px;">Watched area</p>
          <p style="font-size:15px;font-weight:600;color:#0C1B33;margin:0 0 4px;">${escapeHtml(area.areaLabel)}</p>
          ${table}
          ${caveat}
          <p style="margin:10px 0 0;"><a href="${mapLink}" style="font-size:12px;color:#2563EB;">View on map</a></p>
        </div>`;
    })
    .join("");

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0C1B33;">
      <div style="background: #0C1B33; padding: 32px 24px; text-align: center;">
        <h1 style="color: #fff; font-size: 20px; margin: 0 0 4px;">Weekly Watched-Area Digest</h1>
        <p style="color: rgba(255,255,255,0.6); font-size: 13px; margin: 0;">Chicago Incentive Explorer — Southeast Chicago Chamber of Commerce</p>
      </div>
      <div style="padding: 32px 24px;">
        <p style="font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          ${userName ? `Hi ${escapeHtml(userName)}, here` : "Here"} is what changed for the areas you watch: ${itemCount} deadline${itemCount === 1 ? "" : "s"} worth acting on.
        </p>
        ${areaBlocks}
        <div style="background: #F8FAFC; border-left: 3px solid #2563EB; padding: 16px; margin: 24px 0 0;">
          <p style="font-size: 12px; color: #6B7280; margin: 0; line-height: 1.5;">
            Deadline data comes from City of Chicago public sources and program listings. Confirm timing with the administering agency before relying on it.
          </p>
        </div>
      </div>
      <div style="background: #F8FAFC; padding: 16px 24px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="font-size: 11px; color: #9CA3AF; margin: 0;">
          <a href="${SITE_URL}/workspace" style="color: #2563EB;">Manage watched areas in your workspace</a>
        </p>
      </div>
    </div>`;

  return { subject, html };
}
