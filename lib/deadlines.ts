/**
 * lib/deadlines.ts — pure deadline utility functions.
 *
 * Three concerns handled here, all stateless and testable without a DB:
 *
 *   1. collectUpcomingDeadlines(programs, today)
 *      Scans the program card array for any `deadline` field and returns those
 *      that fall within the next 90 days, sorted nearest-first.
 *
 *   2. deadlinesForAddress(opts)
 *      Given an address-level context (matched program IDs, TIF district key,
 *      loaded tif-financials, loaded sbif-rollout, and today's date), returns
 *      a merged DeadlineSummary that includes:
 *        - card-level deadlines for matching programs
 *        - the address's SBIF application window (from sbif-rollout.json)
 *        - TIF expiration urgency flag ("act soon" if ≤24 months)
 *
 *   3. TIF_EXPIRES_SOON_MONTHS constant (24) so callers can render the label
 *      consistently.
 *
 * No imports from Next.js, DB, or network-dependent modules — safe to use in
 * both server components and pure unit tests.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Districts expiring within this many months are flagged "act soon". */
export const TIF_EXPIRES_SOON_MONTHS = 24;

// ── Shared date helpers (local to this module) ────────────────────────────────

/**
 * Normalize a reference date to that calendar day in America/Chicago,
 * anchored at UTC midnight — matching how date-only deadline strings are
 * parsed. Prevents off-by-one "Today" labels when local evening crosses
 * the UTC date line.
 */
function chicagoDayUtc(d: Date): Date {
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return new Date(day + "T00:00:00Z");
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + (s.includes("T") ? "" : "T00:00:00Z"));
  return isNaN(d.getTime()) ? null : d;
}

/** Days between two dates (positive = b is later). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Add months to a date (calendar months). */
function addMonths(d: Date, months: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() + months);
  return result;
}

// ── Program shape — minimal interface required by this module ─────────────────

/**
 * Minimal program card shape this module needs.
 * The full Program type in lib/types.ts is a superset; callers may pass
 * Program[] directly since the extra fields are ignored here.
 */
export interface ProgramCardSlim {
  id: string;
  name: string;
  /** ISO date string (YYYY-MM-DD) or null/undefined. */
  deadline?: string | null;
  /** Optional human note about the deadline context. */
  deadlineNote?: string | null;
}

// ── TIF financials — minimal interface ───────────────────────────────────────

export interface TifFinancialsSlim {
  tifNumber: string;
  tifName: string | null;
  expirationDate: string | null;
  expirationYear: number | null;
  expiresWithin24Months: boolean;
}

// ── SBIF rollout — minimal interface ─────────────────────────────────────────

export interface SbifWindow {
  tifDistrict: string;
  windowStart: string;
  windowEnd: string;
}

/**
 * Find the SBIF rollout window for a TIF district.
 * Matches by normalized key equality or loose name containment in either
 * direction ("T-141" vs "Fullerton/Milwaukee" style keys both supported).
 * Shared by deadlinesForAddress and lib/program-gating so the district
 * matching logic lives in exactly one place.
 */
export function findSbifWindow(
  rollout: SbifWindow[],
  tifDistrict: string
): SbifWindow | null {
  const normalizedDistrict = tifDistrict.toUpperCase();
  return (
    rollout.find((w) => {
      const wName = w.tifDistrict.toUpperCase();
      // Exact key match (T-141) or name substring match.
      return (
        wName === normalizedDistrict ||
        wName.includes(normalizedDistrict) ||
        normalizedDistrict.includes(wName)
      );
    }) ?? null
  );
}

// ── Output types ──────────────────────────────────────────────────────────────

export type DeadlineKind =
  | "program_deadline"
  | "sbif_window"
  | "tif_expiration";

export interface DeadlineItem {
  kind: DeadlineKind;
  label: string;
  /** The anchor date for sorting (windowStart for sbif_window, deadline for programs). */
  date: string; // ISO YYYY-MM-DD
  /** Days from today until the date (negative = past). */
  daysFromToday: number;
  /** True when the date is in the past relative to today. */
  isPast: boolean;
  /** Program ID — set only for kind="program_deadline". */
  programId?: string;
  /** TIF district key — set for sbif_window and tif_expiration. */
  tifDistrict?: string;
  /** Optional supplemental note. */
  note?: string;
}

export interface TifExpirationAlert {
  tifNumber: string;
  tifName: string | null;
  expirationDate: string;
  expirationYear: number;
  /** Months remaining from today. */
  monthsRemaining: number;
  actSoon: boolean;
}

export interface DeadlineSummary {
  /** Card-level upcoming deadlines for matched programs (≤90 days, sorted). */
  upcomingProgramDeadlines: DeadlineItem[];
  /** The SBIF window for this address's TIF district, if any. */
  sbifWindow: DeadlineItem | null;
  /** TIF expiration urgency for the address's district, if applicable. */
  tifExpirationAlert: TifExpirationAlert | null;
  /** All items combined and sorted by date ascending. */
  allItems: DeadlineItem[];
}

// ── 1. collectUpcomingDeadlines ───────────────────────────────────────────────

/**
 * Scan a program array for card-level `deadline` fields and return those that
 * fall within the next `windowDays` days (default 90), sorted nearest-first.
 * Past deadlines are excluded.
 *
 * @param programs  Full program list (only `id`, `name`, `deadline` used).
 * @param today     Reference date. Pass `new Date()` in production; inject in tests.
 * @param windowDays  Only include deadlines within this many days (default 90).
 */
export function collectUpcomingDeadlines(
  programs: ProgramCardSlim[],
  today: Date,
  windowDays = 90
): DeadlineItem[] {
  today = chicagoDayUtc(today);
  const items: DeadlineItem[] = [];

  for (const p of programs) {
    if (!p.deadline) continue;
    const d = parseDate(p.deadline);
    if (!d) continue;
    const days = daysBetween(today, d);
    if (days < 0) continue; // past
    if (days > windowDays) continue; // too far out
    items.push({
      kind: "program_deadline",
      label: `${p.name} — application deadline`,
      date: p.deadline.slice(0, 10),
      daysFromToday: days,
      isPast: false,
      programId: p.id,
      note: p.deadlineNote ?? undefined,
    });
  }

  return items.sort((a, b) => a.daysFromToday - b.daysFromToday);
}

// ── 2. deadlinesForAddress ────────────────────────────────────────────────────

export interface DeadlinesForAddressOpts {
  /**
   * Program IDs matched to the address. Only programs in this list will have
   * their deadlines surfaced. Pass the full program list filtered to matched IDs.
   */
  matchedPrograms: ProgramCardSlim[];
  /**
   * Normalized TIF district key for the address (e.g. "T-141"), or null when
   * the address is not in a TIF district.
   */
  tifDistrict: string | null;
  /**
   * TIF financials keyed by tif_number (from public/data/tif-financials.json
   * or the DB). Pass null to skip TIF expiration logic.
   */
  tifFinancials: Record<string, TifFinancialsSlim> | null;
  /**
   * SBIF rollout windows (from public/data/sbif-rollout.json or the DB).
   * Pass null or empty array to skip SBIF window lookup.
   */
  sbifRollout: SbifWindow[] | null;
  /** Reference date. Pass `new Date()` in production; inject in tests. */
  today: Date;
  /** Days window for upcoming program deadlines (default 90). */
  deadlineWindowDays?: number;
}

/**
 * Merge card deadlines, SBIF window, and TIF expiration into one summary for
 * a specific address. Pure — no network or DB calls.
 */
export function deadlinesForAddress(
  opts: DeadlinesForAddressOpts
): DeadlineSummary {
  const {
    matchedPrograms,
    tifDistrict,
    tifFinancials,
    sbifRollout,
    deadlineWindowDays = 90,
  } = opts;
  const today = chicagoDayUtc(opts.today);

  // ── Program card deadlines ────────────────────────────────────────────────
  const upcomingProgramDeadlines = collectUpcomingDeadlines(
    matchedPrograms,
    today,
    deadlineWindowDays
  );

  // ── SBIF window for the address's TIF district ────────────────────────────
  let sbifWindow: DeadlineItem | null = null;
  if (tifDistrict && sbifRollout && sbifRollout.length > 0) {
    const match = findSbifWindow(sbifRollout, tifDistrict);

    if (match) {
      const startDate = parseDate(match.windowStart);
      const endDate = parseDate(match.windowEnd);
      if (startDate && endDate) {
        const daysToStart = daysBetween(today, startDate);
        const daysToEnd = daysBetween(today, endDate);
        const inWindow = daysToStart <= 0 && daysToEnd >= 0;
        const isPast = daysToEnd < 0;

        sbifWindow = {
          kind: "sbif_window",
          label: `SBIF application window — ${match.tifDistrict}`,
          date: match.windowStart,
          daysFromToday: inWindow ? 0 : daysToStart > 0 ? daysToStart : daysToEnd,
          isPast,
          tifDistrict: tifDistrict,
          note: inWindow
            ? `Window open through ${match.windowEnd}`
            : isPast
            ? `Window closed ${match.windowEnd}`
            : `Window opens ${match.windowStart}, runs through ${match.windowEnd}`,
        };
      }
    }
  }

  // ── TIF expiration urgency ────────────────────────────────────────────────
  let tifExpirationAlert: TifExpirationAlert | null = null;
  if (tifDistrict && tifFinancials) {
    const fin = tifFinancials[tifDistrict];
    if (fin?.expirationDate && fin.expirationYear != null) {
      const expiry = parseDate(fin.expirationDate);
      if (expiry) {
        const cutoff = addMonths(today, TIF_EXPIRES_SOON_MONTHS);
        const actSoon = expiry <= cutoff;
        const monthsRemaining = Math.round(
          (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        );
        if (monthsRemaining > -12) {
          // Surface expirations up to 1 year past (for "already expired" notices).
          tifExpirationAlert = {
            tifNumber: fin.tifNumber,
            tifName: fin.tifName,
            expirationDate: fin.expirationDate,
            expirationYear: fin.expirationYear,
            monthsRemaining,
            actSoon,
          };
        }
      }
    }
  }

  // ── Combine all items ─────────────────────────────────────────────────────
  const allItems: DeadlineItem[] = [...upcomingProgramDeadlines];

  if (sbifWindow) allItems.push(sbifWindow);

  if (tifExpirationAlert && tifExpirationAlert.expirationDate) {
    const expiry = parseDate(tifExpirationAlert.expirationDate);
    if (expiry) {
      const days = daysBetween(today, expiry);
      allItems.push({
        kind: "tif_expiration",
        label: `TIF district expiration — ${tifExpirationAlert.tifName ?? tifExpirationAlert.tifNumber}`,
        date: tifExpirationAlert.expirationDate.slice(0, 10),
        daysFromToday: days,
        isPast: days < 0,
        tifDistrict: tifExpirationAlert.tifNumber,
        note: tifExpirationAlert.actSoon
          ? `This TIF district expires ${tifExpirationAlert.expirationDate.slice(0, 10)} (${tifExpirationAlert.monthsRemaining} months). Apply for TIF-funded programs before the window closes.`
          : days < 0
          ? `This TIF district expired ${tifExpirationAlert.expirationDate.slice(0, 10)}.`
          : undefined,
      });
    }
  }

  allItems.sort((a, b) => a.daysFromToday - b.daysFromToday);

  return {
    upcomingProgramDeadlines,
    sbifWindow,
    tifExpirationAlert,
    allItems,
  };
}
