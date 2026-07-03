#!/usr/bin/env npx tsx
/**
 * Demo script: resolve deadlines for a sample address context.
 *
 * Loads public/data/tif-financials.json and public/data/sbif-rollout.json
 * from the repo's static exports, then runs deadlinesForAddress() for a few
 * hypothetical address contexts to show the merged output.
 *
 * This is a runnable demo/smoke test — not a DB tool. No DATABASE_URL needed.
 *
 * Usage:
 *   npx tsx scripts/check-deadlines.ts
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  collectUpcomingDeadlines,
  deadlinesForAddress,
  type ProgramCardSlim,
  type SbifWindow,
  type TifFinancialsSlim,
} from "../lib/deadlines";

const REPO_ROOT = join(import.meta.dirname ?? __dirname, "..");

// ── Load static exports ───────────────────────────────────────────────────────

function loadJSON<T>(path: string, label: string): T | null {
  if (!existsSync(path)) {
    console.warn(`[WARN] ${label} not found at ${path}. Run sync scripts first.`);
    return null;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as T;
  return raw;
}

interface TifFinancialsFile {
  exportedAt: string;
  rowCount: number;
  districts: Record<string, TifFinancialsSlim>;
}

interface SbifRolloutFile {
  exportedAt: string;
  windows: SbifWindow[];
  fetchError?: string;
}

const tifFile = loadJSON<TifFinancialsFile>(
  join(REPO_ROOT, "public", "data", "tif-financials.json"),
  "tif-financials.json"
);

const sbifFile = loadJSON<SbifRolloutFile>(
  join(REPO_ROOT, "public", "data", "sbif-rollout.json"),
  "sbif-rollout.json"
);

// ── Sample program cards (using gap-verified deadlines for 2026-07-02) ────────
// In production these come from programs.json. We inline a few here for the demo.
const samplePrograms: ProgramCardSlim[] = [
  {
    id: "dcase-cityarts",
    name: "DCASE CityArts Grants",
    deadline: "2026-07-08",
    deadlineNote: "Application closes July 8, 2026 at noon CT",
  },
  {
    id: "dcase-nap",
    name: "DCASE Neighborhood Access Program",
    deadline: "2026-07-08",
    deadlineNote: "Application closes July 8, 2026",
  },
  {
    id: "dcase-next-stage",
    name: "DCASE Next Stage Chicago",
    deadline: "2026-07-08",
  },
  {
    id: "cdg-small",
    name: "Community Development Grant — Small",
    deadline: "2026-08-14",
    deadlineNote: "Apply by August 14, 2026 at 11:59 p.m.",
  },
  {
    id: "cdg-medium",
    name: "Community Development Grant — Medium",
    deadline: "2026-08-14",
    deadlineNote:
      "Aug 14 deadline. South/Southwest/West Side preference factor.",
  },
  {
    id: "nof-q3",
    name: "Neighborhood Opportunity Fund Q3",
    deadline: "2026-08-14",
    deadlineNote: "Q3 cycle — Aug 14, 2026 at 11:59 p.m.",
  },
  {
    id: "workforce-solutions",
    name: "Workforce Solutions Program",
    deadline: null, // rolling; no hard deadline
  },
  {
    id: "sbif",
    name: "Small Business Improvement Fund (SBIF)",
    deadline: null, // handled via rollout calendar, not a flat date
  },
];

// ── Demo contexts ─────────────────────────────────────────────────────────────

const today = new Date("2026-07-02T00:00:00Z");

interface DemoContext {
  label: string;
  matchedProgramIds: string[];
  tifDistrict: string | null;
}

const demoContexts: DemoContext[] = [
  {
    label: "2100 E 71st St, Chicago (South Chicago corridor)",
    matchedProgramIds: ["cdg-small", "sbif", "workforce-solutions", "nof-q3"],
    tifDistrict: "T-141", // Commercial Avenue TIF
  },
  {
    label: "9201 S Commercial Ave, Chicago (East Side/SE corner)",
    matchedProgramIds: [
      "cdg-small",
      "cdg-medium",
      "sbif",
      "dcase-cityarts",
      "dcase-nap",
    ],
    tifDistrict: "T-158", // Stony Island Arts Bank TIF (example)
  },
  {
    label: "Non-TIF address, citywide programs only",
    matchedProgramIds: [
      "workforce-solutions",
      "cdg-small",
      "dcase-cityarts",
      "dcase-next-stage",
      "dcase-nap",
    ],
    tifDistrict: null,
  },
];

// ── Run demos ─────────────────────────────────────────────────────────────────

console.log("=== Deadline Check Demo ===\n");
console.log(`Reference date: ${today.toISOString().slice(0, 10)}\n`);

if (tifFile) {
  console.log(
    `TIF financials loaded: ${tifFile.rowCount} districts (exported ${tifFile.exportedAt})`
  );
}
if (sbifFile) {
  console.log(
    `SBIF rollout loaded: ${sbifFile.windows.length} windows (exported ${sbifFile.exportedAt})`
  );
  if (sbifFile.fetchError) {
    console.warn(`  [WARN] SBIF calendar was blocked at export time — windows may be empty.`);
  }
}
console.log();

// ── Global: programs with imminent deadlines (any address) ───────────────────
console.log("── Upcoming deadlines across ALL programs (next 90 days) ──");
const allUpcoming = collectUpcomingDeadlines(samplePrograms, today);
if (allUpcoming.length === 0) {
  console.log("  (none within 90 days)");
} else {
  for (const item of allUpcoming) {
    const days =
      item.daysFromToday === 0
        ? "TODAY"
        : `in ${item.daysFromToday} day${item.daysFromToday === 1 ? "" : "s"}`;
    console.log(`  [${days}] ${item.label} (${item.date})`);
    if (item.note) console.log(`          ${item.note}`);
  }
}
console.log();

// ── Per-address demos ─────────────────────────────────────────────────────────
for (const ctx of demoContexts) {
  console.log(`── ${ctx.label} ──`);

  const matchedPrograms = samplePrograms.filter((p) =>
    ctx.matchedProgramIds.includes(p.id)
  );

  const summary = deadlinesForAddress({
    matchedPrograms,
    tifDistrict: ctx.tifDistrict,
    tifFinancials: tifFile?.districts ?? null,
    sbifRollout: sbifFile?.windows ?? null,
    today,
  });

  if (summary.allItems.length === 0) {
    console.log("  No upcoming deadlines or alerts.");
  } else {
    for (const item of summary.allItems) {
      const dayLabel =
        item.isPast
          ? `${Math.abs(item.daysFromToday)}d ago`
          : item.daysFromToday === 0
          ? "TODAY"
          : `in ${item.daysFromToday}d`;
      console.log(`  [${item.kind}] ${item.label} (${item.date}, ${dayLabel})`);
      if (item.note) console.log(`    ↳ ${item.note}`);
    }
  }

  if (summary.tifExpirationAlert?.actSoon) {
    const a = summary.tifExpirationAlert;
    console.log(
      `  ⚑ ACT SOON: TIF ${a.tifNumber} "${a.tifName}" expires ` +
        `${a.expirationDate} (${a.monthsRemaining} months). ` +
        `Apply for TIF-funded programs before the window closes.`
    );
  }

  console.log();
}

console.log("Done!\n");
