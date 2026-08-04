/**
 * MATCHED PERMIT RECORDS — CLIENT RESOLUTION for one vacant parcel.
 *
 * The single client-side path to `GET /api/permit-match?id=`, modeled on
 * lib/site-activity-client.ts: a four-state union, a per-id memo so re-clicking
 * the same dot never re-queries, and a promise that NEVER rejects.
 *
 * Honesty rails, and the reason parsing lives here rather than in an `as` cast:
 *
 *  • A lookup that did not complete resolves to `{status:"error"}`, which every
 *    surface renders as "could not check" — never as "no matched permit
 *    record". A failed request is a fact about the server; an absence is a fact
 *    about the parcel, and the card must not confuse them.
 *  • A body that does not parse cleanly is an ERROR, not an empty match list.
 *    A truncated response must not be able to print "No matched permit record"
 *    over a parcel that has one.
 *  • `{ matches: [] }` IS a valid, parseable answer and resolves to `loaded`
 *    with an empty list — that is the genuine absence, and it is the ONLY way
 *    the absence sentence can be reached.
 *  • Only successful lookups are memoized; a failure is retried on the next
 *    click.
 */

import type { MatchedPermit, PermitMatchConfidence, PermitMatchMethod } from "./permit-match";

/** What a surface knows about this parcel's matched permits right now. */
export type PermitMatchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; matches: MatchedPermit[] };

const METHODS: readonly string[] = ["pin_exact", "address_normalized", "spatial_proximity"];
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("not a string");
  return value;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("not a number");
  return value;
}

/**
 * The route's answer, or null when the body is not a payload this UI may
 * render. Never throws. A single malformed entry rejects the WHOLE payload
 * rather than being dropped, because a silently shortened list is
 * indistinguishable from a genuinely shorter one.
 */
export function normalizePermitMatchPayload(raw: unknown): MatchedPermit[] | null {
  try {
    if (!isRecord(raw)) return null;
    const list = raw.matches;
    if (!Array.isArray(list)) return null;
    return list.map((item) => {
      if (!isRecord(item)) throw new Error("not a record");
      const permitId = item.permitId;
      if (typeof permitId !== "string" || permitId === "") throw new Error("permitId");
      const method = String(item.matchMethod);
      const confidence = String(item.matchConfidence);
      if (!METHODS.includes(method)) throw new Error("matchMethod");
      if (!CONFIDENCES.includes(confidence)) throw new Error("matchConfidence");
      return {
        permitId,
        permitType: nullableStr(item.permitType),
        workType: nullableStr(item.workType),
        workDescription: nullableStr(item.workDescription),
        issueDate: nullableStr(item.issueDate),
        reportedCost: nullableNum(item.reportedCost),
        permitStatus: nullableStr(item.permitStatus),
        permitMilestone: nullableStr(item.permitMilestone),
        permitCondition: nullableStr(item.permitCondition),
        matchMethod: method as PermitMatchMethod,
        matchConfidence: confidence as PermitMatchConfidence,
      };
    });
  } catch {
    return null;
  }
}

const inFlight = new Map<string, Promise<PermitMatchState>>();
const resolved = new Map<string, PermitMatchState>();

/** Test seam — drops the memo so a suite can assert the fetch path twice. */
export function resetPermitMatchCache(): void {
  inFlight.clear();
  resolved.clear();
}

/** Already-resolved matches for a parcel PIN, or null when it must be fetched. */
export function cachedPermitMatch(pin: string): PermitMatchState | null {
  return resolved.get(pin) ?? null;
}

/**
 * Resolve the matched permit records for one vacant parcel, keyed by its
 * 14-digit digits-only PIN (what the map's features carry). Never rejects: a
 * non-OK response (including the route's 503 when the database or the match
 * table is unavailable), a network failure, an abort, or an unparseable body
 * all resolve to `{status:"error"}` — rendered as "could not check", never as
 * an absence of permits.
 */
export async function fetchPermitMatch(
  pin: string,
  signal?: AbortSignal,
): Promise<PermitMatchState> {
  const done = resolved.get(pin);
  if (done) return done;
  const pending = inFlight.get(pin);
  if (pending) return pending;

  const request = (async (): Promise<PermitMatchState> => {
    try {
      const res = await fetch(`/api/permit-match?pin=${encodeURIComponent(pin)}`, {
        signal,
      });
      if (!res.ok) return { status: "error" };
      const matches = normalizePermitMatchPayload(await res.json());
      if (!matches) return { status: "error" };
      const state: PermitMatchState = { status: "loaded", matches };
      resolved.set(pin, state);
      return state;
    } catch {
      return { status: "error" };
    } finally {
      inFlight.delete(pin);
    }
  })();

  inFlight.set(pin, request);
  return request;
}
