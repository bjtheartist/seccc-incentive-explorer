/**
 * lib/program-gating.ts — pure availability gating for program cards.
 *
 * Time-lapsed grants and incentives should stop showing automatically, but
 * "lapsed" is not one thing. resolveAvailability(program, today) returns one
 * of four states:
 *
 *   'active'         — no gating info on the card, or a future deadline /
 *                      application window exists (the next one is surfaced
 *                      via nextWindow). Safe default: absence of gating
 *                      fields never hides a program.
 *
 *   'window-closed'  — the program is real but not accepting applications:
 *                      either RECURRING and between windows (SBIF, NOF, CDG),
 *                      or explicitly suspended by its administering agency.
 *                      Still shown with the source-backed status note.
 *
 *   'lapsed-notice'  — no longer generally available by statute: a lapse with
 *                      realistic revival (status === "lapsed", e.g. WOTC) or a
 *                      statutory sunset already past (status === "sunset", e.g.
 *                      §179D). Still shown, with the card's existing warning
 *                      (sunsetWarning). Both statuses share this state because
 *                      report-engine only attaches a status note for
 *                      'window-closed' and 'lapsed-notice' — a state it does not
 *                      recognize is published as an ordinary open incentive.
 *
 *   'expired'        — hidden everywhere. Triggered by an explicit expiresOn
 *                      date in the past, OR oneTime === true with every dated
 *                      deadlines[] entry in the past (and no future expiresOn).
 *
 * No imports from Next.js, the DB, or the network — safe in server
 * components, client components, scripts, and pure unit tests. The SBIF
 * district-window matching is shared with lib/deadlines.ts (findSbifWindow)
 * so the rollout-matching logic lives in exactly one place.
 */

import type { Program, ProgramAvailabilityFields, ProgramDeadlineEntry } from "./types";
import { findSbifWindow, type SbifWindow } from "./deadlines";

// ── Output types ──────────────────────────────────────────────────────────────

export type AvailabilityState =
  | "active"
  | "window-closed"
  | "lapsed-notice"
  | "expired";

export interface NextWindow {
  /**
   * ISO date (YYYY-MM-DD) of the next relevant event — a window opening or a
   * deadline. Omitted when the program is known to recur but the next window
   * is not yet scheduled ("expected").
   */
  date?: string;
  /** ISO date the window closes, when known (SBIF district windows). */
  endDate?: string;
  /** Human label for the date (from the card's deadlines[] entry or the SBIF district). */
  label?: string;
}

export interface ProgramAvailability {
  state: AvailabilityState;
  /** The next (or currently open) application window / deadline, when known. */
  nextWindow?: NextWindow;
  /** Human-readable status note for 'window-closed' and 'lapsed-notice' (and expiry reason). */
  note?: string;
}

export interface ResolveAvailabilityOpts {
  /**
   * SBIF rollout windows (public/data/sbif-rollout.json — pass the loaded
   * windows, e.g. from report-engine's loadSbifRollout). Enables
   * district-aware gating for the sbif card.
   */
  sbifRollout?: SbifWindow[] | null;
  /** The address's TIF district key/name; paired with sbifRollout. */
  tifDistrict?: string | null;
}

// ── Date helpers (day granularity, mirrors lib/deadlines.ts semantics) ────────

function chicagoDayUtc(d: Date): Date {
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return new Date(day + "T00:00:00Z");
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + (s.includes("T") ? "" : "T00:00:00Z"));
  return isNaN(d.getTime()) ? null : d;
}

/** Whole days from `today` until `dateStr` (negative = past), or null if unparseable. */
function daysUntil(dateStr: string, today: Date): number | null {
  const d = parseDate(dateStr);
  if (!d) return null;
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** True when `dateStr` is strictly before today (a deadline dated today still counts). */
function isPastDay(dateStr: string, today: Date): boolean {
  const days = daysUntil(dateStr, today);
  return days != null && days < 0;
}

/** Exact cutoffs compare as instants; entries without one retain Chicago-day semantics. */
function isPastDeadline(
  deadline: ProgramDeadlineEntry,
  now: Date,
  chicagoToday: Date
): boolean {
  const cutoff = parseDate(deadline.cutoffAt);
  return cutoff
    ? now.getTime() >= cutoff.getTime()
    : isPastDay(deadline.date, chicagoToday);
}

// ── Resolver ──────────────────────────────────────────────────────────────────

const WINDOW_OPEN_LABEL = /\bopen(s|ed|ing)?\b/i;

/**
 * Resolve a program card's availability as of `today`.
 * Pure — inject `new Date()` in production and fixed dates in tests.
 *
 * review6 S17: typed to `ProgramAvailabilityFields` (the exact 7 fields
 * this function reads), not `Program` — a full `Program` structurally
 * satisfies the narrower type for free, so every existing caller keeps
 * compiling unchanged, while a client-safe `ProgramApplicationView`
 * (lib/types.ts) can also be passed without a cast. See that type's own
 * doc comment for the full rationale (the RSC-boundary leak this closes).
 */
export function resolveAvailability(
  program: ProgramAvailabilityFields,
  today: Date,
  opts: ResolveAvailabilityOpts = {}
): ProgramAvailability {
  const now = today;
  const chicagoToday = chicagoDayUtc(now);
  const dated = (program.deadlines ?? []).filter(
    (d) => daysUntil(d.date, chicagoToday) != null
  );
  const expiresOnPast = program.expiresOn
    ? isPastDay(program.expiresOn, chicagoToday)
    : false;
  const expiresOnFuture = !!program.expiresOn && !expiresOnPast && parseDate(program.expiresOn) != null;

  // 1) Explicit expiry date in the past — hidden everywhere.
  if (expiresOnPast) {
    return {
      state: "expired",
      note: `Program availability ended ${program.expiresOn}.`,
    };
  }

  // 2) Published application suspension — keep the program visible, but never
  //    present new intake as active. This is distinct from expiration/lapse:
  //    Data Center certifications already issued remain in force even while
  //    DCEO is not processing new applications.
  if (program.suspensionNote) {
    return {
      state: "window-closed",
      note: program.suspensionNote,
    };
  }

  // 3) Statutory lapse or sunset — shown with the existing warning.
  //    "sunset" must be matched here alongside "lapsed": both are ProgramStatus
  //    values (lib/schemas.ts) meaning the program is no longer generally
  //    available, but only "lapsed" was checked, so sunset cards fell through
  //    to the 'active' default at the bottom and reports presented them as
  //    ordinary open incentives — deadline copy and all.
  if (program.status === "lapsed" || program.status === "sunset") {
    return {
      state: "lapsed-notice",
      note:
        program.sunsetWarning ||
        (program.status === "sunset"
          ? // A sunset is a termination, not a lapse — do not imply reauthorization.
            "This program has sunset under its authorizing statute. Verify current status with the administering agency before relying on it."
          : "This program's statutory authority has lapsed. Reauthorization is possible — verify current status with the administering agency before relying on it."),
    };
  }

  // 4) One-time program whose every dated deadline has passed — expired.
  //    A future expiresOn is an explicit "valid through" and overrides this
  //    inference. Requires at least one dated entry (an empty deadlines[]
  //    never expires a card — safe default).
  if (
    program.oneTime === true &&
    !expiresOnFuture &&
    dated.length > 0 &&
    dated.every((d) => isPastDeadline(d, now, chicagoToday))
  ) {
    const last = dated.map((d) => d.date).sort().at(-1);
    return {
      state: "expired",
      note: `One-time program; final deadline (${last}) has passed.`,
    };
  }

  // 5) SBIF district-aware gating: rollout windows are authoritative for the
  //    address's own TIF district (the card-level deadlines describe other
  //    districts' months).
  if (program.id === "sbif" && opts.sbifRollout?.length && opts.tifDistrict) {
    const win = findSbifWindow(opts.sbifRollout, opts.tifDistrict);
    if (win) {
      const daysToStart = daysUntil(win.windowStart, chicagoToday);
      const daysToEnd = daysUntil(win.windowEnd, chicagoToday);
      if (daysToStart != null && daysToEnd != null) {
        const nextWindow: NextWindow = {
          date: win.windowStart,
          endDate: win.windowEnd,
          label: `SBIF application window — ${win.tifDistrict}`,
        };
        if (daysToStart <= 0 && daysToEnd >= 0) {
          // Window currently open for this district.
          return {
            state: "active",
            nextWindow,
            note: `Applications open through ${win.windowEnd} for the ${win.tifDistrict} TIF district.`,
          };
        }
        if (daysToStart > 0) {
          // Between windows, next one already scheduled.
          return {
            state: "window-closed",
            nextWindow,
            note: `Applications currently closed for the ${win.tifDistrict} TIF district; next window opens ${win.windowStart}.`,
          };
        }
        // This district's window has ended; the next rollout is not yet published.
        return {
          state: "window-closed",
          note: `Applications currently closed for the ${win.tifDistrict} TIF district; next window expected when the next SBIF rollout calendar is published.`,
        };
      }
    }
    // District not in the rollout — fall through to the generic date logic.
  }

  // 6) A future deadline / window exists — active; surface the next one.
  const futureDates = dated
    .filter((d) => !isPastDeadline(d, now, chicagoToday))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (expiresOnFuture) {
    futureDates.push({ label: "Final availability date", date: program.expiresOn! });
    futureDates.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (futureDates.length > 0) {
    const next = futureDates[0];
    return {
      state: "active",
      nextWindow: { date: next.date, label: next.label },
    };
  }

  // 7) Recurring program with only past dates — between windows.
  if (program.recurring === true && dated.length > 0) {
    const latest = [...dated].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    // If the most recent dated event was a window OPENING (with no dated
    // close), the window is likely still open — do not mislabel it closed.
    if (WINDOW_OPEN_LABEL.test(latest.label ?? "")) {
      return { state: "active" };
    }
    return {
      state: "window-closed",
      note:
        "Applications currently closed; next window expected — confirm timing with the administering agency.",
    };
  }

  // 8) Default: no gating info (or past dates without oneTime/recurring flags) — active.
  return { state: "active" };
}

/** Convenience: true when the program should be hidden everywhere. */
export function isExpired(
  program: ProgramAvailabilityFields,
  today: Date,
  opts?: ResolveAvailabilityOpts
): boolean {
  return resolveAvailability(program, today, opts).state === "expired";
}

/** Convenience: drop expired programs from a list. */
export function excludeExpiredPrograms<T extends Program>(
  programs: T[],
  today: Date,
  opts?: ResolveAvailabilityOpts
): T[] {
  return programs.filter((p) => !isExpired(p, today, opts));
}
