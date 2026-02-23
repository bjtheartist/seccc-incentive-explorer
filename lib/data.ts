import type {
  Business,
  Program,
  Stats,
  CensusData,
  ZoneCheckResult,
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
  try {
    const data = await fetchJSON<Program[]>(`${API_BASE}/api/programs`);
    return safeParseArray(ProgramSchema, data, "programs") as Program[];
  } catch {
    try {
      const data = await fetchJSON<Program[]>("/data/programs.json");
      return safeParseArray(ProgramSchema, data, "programs-static") as Program[];
    } catch {
      return [];
    }
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

export async function checkZonesAPI(
  lat: number,
  lon: number
): Promise<ZoneCheckResult[]> {
  try {
    return await fetchJSON<ZoneCheckResult[]>(
      `${API_BASE}/api/zones/check?lat=${lat}&lon=${lon}`
    );
  } catch {
    return [];
  }
}

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
