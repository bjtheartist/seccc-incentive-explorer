import { ZONE_KEYS } from "./constants";
import type { ZoneLayerState, ZoneUnknownReason } from "./zones-check";

export interface NormalizedZoneCheck {
  zones: Record<string, boolean>;
  zoneNames: Record<string, string>;
  incentiveCount: number;
  /**
   * Zone-claims foundation (build-spec.md 1.3; audit F2): keys omitted from
   * the raw v1 payload — i.e. layers that were never actually confirmed
   * `false`, only silently absent. `zones[key]` still defaults these to
   * `false` for byte-for-byte backward compatibility with every current
   * PR1 consumer (report-engine, zone-check client fallback, MapView,
   * owner-file-letter-context, watchlist-digest) — this field is
   * strictly ADDITIVE so PR1 changes zero consumer behavior. PR2 rewires
   * consumers to check `unknownLayers` before rendering any negative claim
   * sourced from `zones[key] === false`, per the audit's minimal fix
   * ("never normalize an omitted/failed layer to false; suppress negative
   * summaries when any required layer is unknown").
   */
  unknownLayers: string[];
}

interface ZoneCheckItem {
  key?: unknown;
  name?: unknown;
}

function emptyZoneMap(): Record<string, boolean> {
  return Object.fromEntries(ZONE_KEYS.map((key) => [key, false]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeZoneNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(value)) {
    if (typeof name === "string") names[key] = name;
  }
  return names;
}

function countActiveZones(zones: Record<string, boolean>): number {
  return Object.values(zones).filter(Boolean).length;
}

/**
 * Every known zone key the raw payload did not actually mention. `zones[key]`
 * still defaults these to `false` (see NormalizedZoneCheck.unknownLayers doc
 * comment) — this list is what makes that default legible as "omitted", not
 * "confirmed not matched".
 */
function computeUnknownLayers(presentKeys: ReadonlySet<string>): string[] {
  return ZONE_KEYS.filter((key) => !presentKeys.has(key));
}

export function normalizeZoneCheckResponse(
  data: unknown
): NormalizedZoneCheck | null {
  const zones = emptyZoneMap();
  const zoneNames: Record<string, string> = {};

  if (Array.isArray(data)) {
    const presentKeys = new Set<string>();
    for (const item of data as ZoneCheckItem[]) {
      if (!isRecord(item) || typeof item.key !== "string") continue;
      zones[item.key] = true;
      presentKeys.add(item.key);
      if (typeof item.name === "string" && item.name) {
        zoneNames[item.key] = item.name;
      }
    }

    return {
      zones,
      zoneNames,
      incentiveCount: countActiveZones(zones),
      unknownLayers: computeUnknownLayers(presentKeys),
    };
  }

  if (!isRecord(data) || !isRecord(data.zones)) {
    return null;
  }

  const presentKeys = new Set(Object.keys(data.zones));
  for (const [key, value] of Object.entries(data.zones)) {
    zones[key] = Boolean(value);
  }

  return {
    zones,
    zoneNames: normalizeZoneNames(data.zoneNames),
    incentiveCount:
      typeof data.incentiveCount === "number"
        ? data.incentiveCount
        : countActiveZones(zones),
    unknownLayers: computeUnknownLayers(presentKeys),
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * Zone Evidence v2 normalizer (build-spec.md 1.3; review1 R4) — parses the
 * NEW schemaVersion: 2 response shape from /api/zones/check/v2.
 * Independent of normalizeZoneCheckResponse above; does not share its
 * "default to false" behavior because v2 has a real third state
 * (`unknown`) to represent.
 *
 * Two review1 R4 hardening rules over the original design:
 *   1. `dataRevision` and `checkedAt` are REQUIRED, non-empty strings.
 *      Absent or malformed, normalization fails outright (returns null) —
 *      never a silent "" substitution, which would make a downstream
 *      "checked <dataRevision/checkedAt>" claim silently blank instead of
 *      absent.
 *   2. No silent drops: every layer named in `requestedLayers` gets an
 *      entry in the output, even when it's missing or malformed in the
 *      raw `layers` payload — synthesized as `unknown/layer_missing`. A
 *      payload requesting `["tif","ssa"]` but only actually containing a
 *      valid `tif` entry must normalize with `hasUnknown: true`, not
 *      `false` — the whole point of "unknown, never false" is defeated if
 *      an omitted requested layer just vanishes from the normalized
 *      output instead of showing up as unknown.
 * ════════════════════════════════════════════════════════════════════════ */

export interface NormalizedZoneLayerEvidence {
  state: ZoneLayerState;
  name?: string;
  reason?: ZoneUnknownReason;
}

export interface NormalizedZoneEvidenceV2 {
  schemaVersion: 2;
  dataRevision: string;
  checkedAt: string;
  requestedLayers: string[];
  layers: Record<string, NormalizedZoneLayerEvidence>;
  /** Convenience derived view — keys whose state is "matched". */
  matchedKeys: string[];
  /** Convenience derived view — keys whose state is "unknown", in request order. */
  unknownKeys: string[];
  hasUnknown: boolean;
}

const VALID_ZONE_LAYER_STATES: ReadonlySet<string> = new Set([
  "matched",
  "not_matched",
  "unknown",
]);

/** A missing or malformed layer entry synthesizes to this — never silently dropped (review1 R4). */
const SYNTHESIZED_MISSING_LAYER: NormalizedZoneLayerEvidence = {
  state: "unknown",
  reason: "layer_missing",
};

function normalizeOneLayerEntry(value: unknown): NormalizedZoneLayerEvidence {
  if (!isRecord(value) || typeof value.state !== "string" || !VALID_ZONE_LAYER_STATES.has(value.state)) {
    return SYNTHESIZED_MISSING_LAYER;
  }
  const state = value.state as ZoneLayerState;
  const entry: NormalizedZoneLayerEvidence = { state };
  if (typeof value.name === "string" && value.name) entry.name = value.name;
  if (typeof value.reason === "string" && value.reason) {
    entry.reason = value.reason as ZoneUnknownReason;
  }
  return entry;
}

export function normalizeZoneEvidenceV2(data: unknown): NormalizedZoneEvidenceV2 | null {
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 2) return null;
  if (!isRecord(data.layers)) return null;

  // Required, non-empty — never silently substituted (review1 R4).
  if (typeof data.dataRevision !== "string" || data.dataRevision.length === 0) return null;
  if (typeof data.checkedAt !== "string" || data.checkedAt.length === 0) return null;

  const rawLayers = data.layers as Record<string, unknown>;
  const declaredRequestedLayers = Array.isArray(data.requestedLayers)
    ? data.requestedLayers.filter((k): k is string => typeof k === "string" && k.length > 0)
    : null;

  // Guarantee an entry for every layer the envelope claims it checked
  // (requestedLayers) UNION every key actually present in the raw
  // payload — an unexpected extra layer key is preserved too, not dropped.
  const keysToNormalize = new Set<string>([
    ...(declaredRequestedLayers ?? []),
    ...Object.keys(rawLayers),
  ]);

  const layers: Record<string, NormalizedZoneLayerEvidence> = {};
  const matchedKeys: string[] = [];
  const unknownKeys: string[] = [];

  for (const key of keysToNormalize) {
    const entry = normalizeOneLayerEntry(rawLayers[key]);
    layers[key] = entry;
    if (entry.state === "matched") matchedKeys.push(key);
    if (entry.state === "unknown") unknownKeys.push(key);
  }

  return {
    schemaVersion: 2,
    dataRevision: data.dataRevision,
    checkedAt: data.checkedAt,
    requestedLayers: declaredRequestedLayers ?? Object.keys(rawLayers),
    layers,
    matchedKeys,
    unknownKeys,
    hasUnknown: unknownKeys.length > 0,
  };
}
