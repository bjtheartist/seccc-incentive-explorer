/**
 * Server-side, read-only access to the public program dataset for the
 * concierge tools. Reads public/data/programs.json directly from disk (the
 * same file the client fetches) — no DB, no network, no writes.
 *
 * Every fact the concierge states about a program must come from here, and
 * every program claim must cite the program's official URL (design note §2).
 */
import { readFile } from "fs/promises";
import path from "path";
import type { Program } from "@/lib/types";
import { programSlug } from "@/lib/programs-data";

let _cache: Program[] | null = null;

async function loadPrograms(): Promise<Program[]> {
  if (_cache) return _cache;
  const filePath = path.join(process.cwd(), "public", "data", "programs.json");
  const raw = await readFile(filePath, "utf8");
  _cache = JSON.parse(raw) as Program[];
  return _cache;
}

/** A trimmed, citation-carrying summary of a program for search results. */
export interface ConciergeProgramSummary {
  id: string;
  name: string;
  level: Program["level"];
  status?: Program["status"];
  summary: string;
  /** The official/source URL the concierge MUST cite for this program. */
  officialUrl: string;
  /** Canonical in-app detail route. Safe to pass to navigateTo. */
  detailRoute: string;
}

/** Full program detail returned by getProgram — sourced facts only. */
export interface ConciergeProgramDetail extends ConciergeProgramSummary {
  whoQualifies: string;
  benefits: string[];
  howToApply: string[];
  requiredDocs: string[];
  benefitRange?: string;
  /** Descriptive next-step links — NOT eligibility determinations. */
  verificationSteps: Program["verificationSteps"];
  /** Where to actually apply, if the dataset carries it. */
  applicationPortals: Program["applicationPortals"];
  /** The program's own boundary disclaimer, if present. */
  boundaryDisclaimer?: string;
  /** Contact string for the administering agency. */
  contact: string;
}

function officialUrlOf(p: Program): string {
  return p.url || p.sourceUrl || "";
}

export function toSummary(p: Program): ConciergeProgramSummary {
  return {
    id: p.id,
    name: p.name,
    level: p.level,
    status: p.status,
    summary: p.summary,
    officialUrl: officialUrlOf(p),
    detailRoute: `/programs/${programSlug(p)}`,
  };
}

export function toDetail(p: Program): ConciergeProgramDetail {
  return {
    ...toSummary(p),
    whoQualifies: p.whoQualifies,
    benefits: p.benefits ?? [],
    howToApply: p.howToApply ?? [],
    requiredDocs: p.requiredDocs ?? [],
    benefitRange: p.benefitRange,
    verificationSteps: p.verificationSteps ?? [],
    applicationPortals: p.applicationPortals ?? [],
    boundaryDisclaimer: p.boundaryDisclaimer,
    contact: p.contact,
  };
}

const SEARCHABLE_LEVELS = new Set(["Federal", "State", "County", "City", "Utility"]);

/**
 * Keyword search over name / summary / whoQualifies / benefits / zoneKey.
 * `level` is treated as an optional category-style facet. Deterministic
 * substring scoring — no fuzzy magic, no model calls.
 */
export async function searchPrograms(
  query: string,
  opts: { level?: string; limit?: number } = {}
): Promise<ConciergeProgramSummary[]> {
  const programs = await loadPrograms();
  const q = query.trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const levelFilter =
    opts.level && SEARCHABLE_LEVELS.has(opts.level) ? opts.level : null;

  const scored = programs
    .filter((p) => (levelFilter ? p.level === levelFilter : true))
    .map((p) => {
      const name = p.name.toLowerCase();
      const haystack = [
        p.name,
        p.summary,
        p.whoQualifies,
        p.zoneKey,
        ...(p.benefits ?? []),
      ]
        .filter(Boolean)
        .join(" • ")
        .toLowerCase();

      let score = 0;
      if (!q) {
        score = 1; // empty query → return all (level-filtered) by natural order
      } else {
        if (name === q) score += 100;
        if (name.includes(q)) score += 40;
        if (haystack.includes(q)) score += 10;
        // token overlap
        for (const token of q.split(/\s+/).filter((t) => t.length > 2)) {
          if (name.includes(token)) score += 6;
          else if (haystack.includes(token)) score += 2;
        }
      }
      return { p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => toSummary(r.p));

  return scored;
}

export async function getProgram(
  idOrName: string
): Promise<ConciergeProgramDetail | null> {
  const programs = await loadPrograms();
  const needle = idOrName.trim().toLowerCase();
  const match =
    programs.find((p) => p.id.toLowerCase() === needle) ??
    programs.find((p) => p.name.toLowerCase() === needle) ??
    programs.find((p) => p.name.toLowerCase().includes(needle));
  return match ? toDetail(match) : null;
}
