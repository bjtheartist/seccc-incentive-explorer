import type {
  Business,
  Program,
  Stats,
  CensusData,
  CommunityAsset,
  StackingRule,
} from "./types";
import { ProgramSchema, StackingRuleSchema, safeParseArray } from "./schemas";

/**
 * Data access layer — DB-first with static file fallback.
 *
 * Each function tries the database via API routes first.
 * On failure, falls back to static files in /data/.
 * This ensures zero-downtime during the migration from static → DB.
 */

const API_BASE = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_SITE_URL || "");

/** Canonical pair key for deduplicating bidirectional stacking rules. */
function canonicalPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ── Businesses ─────────────────────────────── */

export async function getBusinesses(search?: string): Promise<Business[]> {
  try {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    return await fetchJSON<Business[]>(`${API_BASE}/api/businesses?${params}`);
  } catch {
    // Fallback to static file
    const all = await fetchJSON<Business[]>("/data/businesses.json");
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.address.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
    );
  }
}

/* ── Programs ───────────────────────────────── */

export async function getPrograms(): Promise<Program[]> {
  // build-spec.md 2.2 (hard cutover): public/data/programs.json is deleted.
  // /api/programs already falls back to data/programs-internal.json
  // server-side if the DB is unreachable, so no second client-side fallback
  // to a static public file is needed.
  try {
    const data = await fetchJSON<Program[]>(`${API_BASE}/api/programs`);
    return safeParseArray(ProgramSchema, data, "programs") as Program[];
  } catch {
    return [];
  }
}

/* ── Stacking Rules ────────────────────────── */

export async function getStackingRules(
  programId?: string
): Promise<StackingRule[]> {
  let rules: StackingRule[];
  try {
    const params = new URLSearchParams();
    if (programId) params.set("program", programId);
    const data = await fetchJSON<StackingRule[]>(
      `${API_BASE}/api/stacking?${params}`
    );
    rules = safeParseArray(StackingRuleSchema, data, "stacking") as StackingRule[];
  } catch {
    try {
      const all = await fetchJSON<StackingRule[]>("/data/stacking-rules.json");
      const validated = safeParseArray(StackingRuleSchema, all, "stacking-static") as StackingRule[];
      if (!programId) return deduplicateRules(validated);
      rules = validated.filter(
        (r) => r.programId === programId || r.otherProgramId === programId
      );
    } catch {
      return [];
    }
  }
  return deduplicateRules(rules);
}

/** Deduplicate stacking rules: keep the first occurrence per canonical pair+scope. */
function deduplicateRules(rules: StackingRule[]): StackingRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = `${canonicalPairKey(r.programId, r.otherProgramId)}:${r.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Stats ──────────────────────────────────── */

export async function getStats(): Promise<Stats> {
  try {
    return await fetchJSON<Stats>(`${API_BASE}/api/stats`);
  } catch {
    return await fetchJSON<Stats>("/data/stats.json");
  }
}

/* ── Zone Check ─────────────────────────────── */
// review7 S21 (MEDIUM): `checkZonesAPI` removed outright, not migrated.
// It called the v1 `/api/zones/check` endpoint (v1 silently defaults an
// unresolved layer to a confirmed non-match — the exact S1-S3 anti-
// pattern this whole engagement exists to remove) via a template
// literal with the endpoint text in a SPAN, not the head
// (`${API_BASE}/api/zones/check?...`) — the exact shape
// `lib/public-claim-surfaces-verify.ts`'s v1-endpoint scanner missed
// until this finding (it only inspected a template's head). A
// repo-wide grep confirmed `checkZonesAPI` had ZERO callers anywhere in
// the codebase — genuinely dead code, so migrating it to v2 would have
// preserved a v1-shaped dead function nobody calls; removing it
// entirely closes the anti-pattern instead of relocating it. Also
// removed the now-fully-unused `ZoneCheckResult` type import above and
// its declaration in lib/types.ts (confirmed via repo-wide grep: this
// function was its only consumer).

/* ── Census Data ────────────────────────────── */

export async function getCensusData(
  lat: number,
  lon: number
): Promise<CensusData | null> {
  try {
    return await fetchJSON<CensusData>(
      `${API_BASE}/api/census?lat=${lat}&lon=${lon}`
    );
  } catch {
    return null;
  }
}

/* ── Community Assets ───────────────────────── */

export async function getAssets(
  type?: string
): Promise<CommunityAsset[]> {
  try {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    return await fetchJSON<CommunityAsset[]>(
      `${API_BASE}/api/assets?${params}`
    );
  } catch {
    return [];
  }
}

/* ── Zone GeoJSON ───────────────────────────── */

export async function getZoneGeoJSON(
  key: string
): Promise<GeoJSON.FeatureCollection | null> {
  try {
    return await fetchJSON<GeoJSON.FeatureCollection>(
      `${API_BASE}/api/zones/geojson/${key}`
    );
  } catch {
    return null;
  }
}
