/**
 * review5 S2 — resolves the four Site Shortlist overlay layers (ssa, ccsa,
 * tif, nof) for one candidate site's coordinates, distinguishing "checked
 * and absent" from "could not be checked" instead of collapsing both into
 * `present: false`.
 *
 * Replaces scripts/export-shortlist-universe.ts's prior direct use of
 * `checkStaticZoneKeys`, which silently swallowed every per-layer failure
 * (`.catch(() => null)`) and unconditionally defaulted ALL FOUR overlays
 * to `present: false` whenever a site had no lat/lon at all — both cases
 * indistinguishable from a genuine, confirmed non-match. Built on
 * `resolveZoneEvidenceV2` (the same tri-state resolver
 * /api/zones/check/v2 uses), forced to its static-file-only path
 * (`sql: null`) — this export script never queried the DB per-point for
 * these four layers even before this fix, so `sql: null` preserves that
 * exact behavior while gaining the tri-state distinction.
 */
import { resolveZoneEvidenceV2, type ZoneEvidenceOpts } from "./zones-check";
import type { CandidateOverlays, OverlayMembership } from "./shortlist-engine";

const OVERLAY_KEYS = ["ssa", "ccsa", "tif", "nof"] as const;

const UNCHECKABLE_OVERLAYS: CandidateOverlays = {
  ssa: { present: false, name: null, unknown: true },
  ccsa: { present: false, name: null, unknown: true },
  tif: { present: false, name: null, unknown: true },
  nof: { present: false, name: null, unknown: true },
};

/**
 * `lat`/`lon` null means the site has no coordinates to check against at
 * all — genuinely unknown for every layer, not a confirmed absence. Every
 * resolved layer's `state` maps: `matched` -> present, `not_matched` ->
 * absent (checked), `unknown` -> unknown (uncheckable, e.g. a missing or
 * malformed source file — resolveZoneEvidenceV2's own per-key try/catch
 * guarantees one bad layer never affects another).
 */
export async function resolveCandidateOverlays(
  lat: number | null,
  lon: number | null,
  /** Test-only injection point (Hard Rule: mock at the boundary, never a
   *  live DB or real broken fixture files) — e.g. a `loadZoneFile` that
   *  throws for one key to simulate a real per-layer failure. Production
   *  callers never pass this; it always forces `sql: null` regardless. */
  opts: Omit<ZoneEvidenceOpts, "sql"> = {},
): Promise<CandidateOverlays> {
  if (lat == null || lon == null) {
    return { ...UNCHECKABLE_OVERLAYS };
  }

  const evidence = await resolveZoneEvidenceV2(lat, lon, OVERLAY_KEYS, { ...opts, sql: null });

  const toMembership = (key: (typeof OVERLAY_KEYS)[number]): OverlayMembership => {
    const entry = evidence[key];
    if (!entry) return { present: false, name: null, unknown: true };
    return {
      present: entry.state === "matched",
      name: entry.name ?? null,
      unknown: entry.state === "unknown",
    };
  };

  return {
    ssa: toMembership("ssa"),
    ccsa: toMembership("ccsa"),
    tif: toMembership("tif"),
    nof: toMembership("nof"),
  };
}
