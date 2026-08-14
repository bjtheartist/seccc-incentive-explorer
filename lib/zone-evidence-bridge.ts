/**
 * review5 S2/S3 — a shared bridge from Zone Evidence v2 tri-state evidence
 * (`matched` | `not_matched` | `unknown`) to the boolean `Record<string,
 * boolean>` shape `lib/confidence-engine.ts`'s `runConfidenceEngine()` and
 * `lib/location-context.ts`'s `buildLocationContext()` still require.
 *
 * That engine has no third state to represent "we don't know" — it can
 * only match or not-match a zone key. Rewriting its full signature (and
 * every one of its many callers) to natively carry tri-state evidence is a
 * larger architectural change than this pass's scope. Instead, every
 * caller of this bridge gets BOTH the boolean map the engine needs to keep
 * running unchanged, AND the list of keys that were actually `unknown` —
 * so the caller can (and, per S2/S3, MUST) suppress or caveat any negative
 * claim ("not mapped here", "0 geographies") that would otherwise be
 * silently derived from an unknown layer being folded into `false`.
 *
 * `unknown` bridges to `false` in the boolean map (the engine needs SOME
 * value, and treating an unresolved layer as "does not match" is the
 * conservative direction — it can only cause an eligible program to be
 * under-shown, never falsely claimed present). What changes is that every
 * consumer using this bridge now has `unknownKeys` available and is
 * expected to check it before rendering a negative/absence claim, per the
 * S2 test requirement: "no negative for that [unknown] layer, known
 * positives preserved."
 */
import type { NormalizedZoneEvidenceV2 } from "./zone-response";

export interface ZoneEvidenceBridgeResult {
  /** matched -> true, not_matched -> false, unknown -> false (see doc comment above). */
  zones: Record<string, boolean>;
  zoneNames: Record<string, string>;
  /** Keys whose v2 state is "unknown" — never render a negative claim for these. */
  unknownKeys: string[];
  hasUnknown: boolean;
}

export function bridgeZoneEvidenceV2ToBooleanMap(
  evidence: NormalizedZoneEvidenceV2,
): ZoneEvidenceBridgeResult {
  const zones: Record<string, boolean> = {};
  const zoneNames: Record<string, string> = {};

  for (const [key, entry] of Object.entries(evidence.layers)) {
    zones[key] = entry.state === "matched";
    if (entry.name) zoneNames[key] = entry.name;
  }

  return {
    zones,
    zoneNames,
    unknownKeys: evidence.unknownKeys,
    hasUnknown: evidence.hasUnknown,
  };
}

/**
 * A short, honest caveat sentence for when one or more zone layers could
 * not be resolved — meant to sit ALONGSIDE whatever known positives did
 * resolve (S3: "known positives AND an unavailable-layer notice must BOTH
 * render regardless of match count"), never to replace them and never to
 * be silently omitted just because some other layer did produce a match.
 */
export function zoneCoverageCaveat(unknownKeys: readonly string[]): string | null {
  if (unknownKeys.length === 0) return null;
  const n = unknownKeys.length;
  return `${n} incentive-geography layer${n === 1 ? "" : "s"} could not be verified for this location; results here may be incomplete.`;
}
