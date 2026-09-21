#!/usr/bin/env npx tsx
/**
 * Concierge SHADOW decisions report (Jev via AI Gateway).
 *
 * Reads the audit-only rows written by the concierge route
 * (concierge_tool_actions.tool_name = 'shadow.jev.decision'), joins each to the
 * assistant reply it shadowed, and writes a Markdown report:
 *   - lane / stage distributions and mean probabilities
 *   - off-topic and wants-handoff rates at a few thresholds
 *   - latency percentiles
 *   - a per-turn table (decision vs. the guide's reply excerpt) for hand review
 *
 * The experiment's terminal state: enough turns (default 30) to judge whether
 * Jev's lane agrees with the lane the guide actually routed to. Signed-in turns
 * only (guest turns leave a hashed runtime log line, not a DB row).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/concierge-shadow-report.ts [--days 30] [--out docs/concierge-shadow-report.md]
 */
import { writeFile } from "fs/promises";
import { neon } from "@neondatabase/serverless";
import { SHADOW_DECISION_TOOL_NAME } from "../lib/concierge/decisions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const days = Number(arg("days", "30"));
const outPath = arg("out", "docs/concierge-shadow-report.md");
const MIN_TURNS = Number(process.env.CONCIERGE_SHADOW_MIN_TURNS ?? "30");

interface Row {
  created_at: string;
  page_route: string | null;
  result_summary: string | null;
  assistant_text: string | null;
  user_text: string | null;
}

interface Summary {
  lane: string;
  lane_p: number | null;
  stage: string;
  stage_p: number | null;
  wants_handoff: number;
  off_topic: number;
  latency_ms: number;
}

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function tally(keys: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const rows = (await sql`
    SELECT a.created_at, c.page_route, a.result_summary,
           m.content AS assistant_text,
           (
             SELECT u.content FROM concierge_messages u
             WHERE u.conversation_id = a.conversation_id AND u.role = 'user'
               AND u.created_at <= m.created_at
             ORDER BY u.created_at DESC LIMIT 1
           ) AS user_text
    FROM concierge_tool_actions a
    JOIN concierge_conversations c ON c.id = a.conversation_id
    LEFT JOIN concierge_messages m ON m.id = a.message_id
    WHERE a.tool_name = ${SHADOW_DECISION_TOOL_NAME}
      AND a.created_at >= NOW() - (${days} || ' days')::interval
    ORDER BY a.created_at DESC
  `) as Row[];

  const parsed = rows
    .map((r) => {
      try {
        return { row: r, s: JSON.parse(r.result_summary ?? "") as Summary };
      } catch {
        return null;
      }
    })
    .filter((x): x is { row: Row; s: Summary } => x !== null);

  const n = parsed.length;
  const lanes = tally(parsed.map((x) => x.s.lane));
  const stages = tally(parsed.map((x) => x.s.stage));
  const latencies = parsed.map((x) => x.s.latency_ms).filter((v) => Number.isFinite(v));
  const rate = (f: (s: Summary) => boolean) =>
    n ? `${((parsed.filter((x) => f(x.s)).length / n) * 100).toFixed(1)}%` : "n/a";

  const lines: string[] = [];
  lines.push(`# Concierge shadow decisions report`);
  lines.push(``);
  lines.push(`Generated ${new Date().toISOString()} · window: last ${days} days · turns: ${n}`);
  lines.push(``);
  lines.push(
    n >= MIN_TURNS
      ? `**Terminal state reached** (${n} ≥ ${MIN_TURNS} turns). Review the per-turn table and decide Phase 2.`
      : `**Not yet enough turns** (${n} < ${MIN_TURNS}). Keep shadowing.`
  );
  lines.push(``);
  lines.push(`## Lane distribution`);
  lines.push(`| lane | turns | share |`);
  lines.push(`|---|---|---|`);
  for (const [k, v] of lanes) lines.push(`| ${k} | ${v} | ${((v / n) * 100).toFixed(1)}% |`);
  lines.push(``);
  lines.push(`## Stage distribution`);
  lines.push(`| stage | turns | share |`);
  lines.push(`|---|---|---|`);
  for (const [k, v] of stages) lines.push(`| ${k} | ${v} | ${((v / n) * 100).toFixed(1)}% |`);
  lines.push(``);
  lines.push(`## Boolean questions`);
  lines.push(`| question | ≥0.5 | ≥0.8 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| off_topic | ${rate((s) => s.off_topic >= 0.5)} | ${rate((s) => s.off_topic >= 0.8)} |`);
  lines.push(
    `| wants_handoff | ${rate((s) => s.wants_handoff >= 0.5)} | ${rate((s) => s.wants_handoff >= 0.8)} |`
  );
  lines.push(``);
  lines.push(`## Latency (ms, as seen by the route)`);
  lines.push(`p50 ${pct(latencies, 50) ?? "n/a"} · p90 ${pct(latencies, 90) ?? "n/a"} · max ${latencies.length ? Math.max(...latencies) : "n/a"}`);
  lines.push(``);
  lines.push(`## Per-turn review (decision vs. what the guide said)`);
  lines.push(`| when | route | lane (p) | stage (p) | handoff | off-topic | visitor said | guide replied |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  const cell = (t: string | null, max = 90) =>
    (t ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, max);
  for (const { row, s } of parsed) {
    lines.push(
      `| ${row.created_at.slice(0, 16)} | ${row.page_route ?? ""} | ${s.lane} (${s.lane_p ?? "?"}) | ${s.stage} (${s.stage_p ?? "?"}) | ${s.wants_handoff} | ${s.off_topic} | ${cell(row.user_text)} | ${cell(row.assistant_text)} |`
    );
  }
  lines.push(``);

  await writeFile(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath} (${n} shadow turns)`);
}

main().catch((err) => {
  console.error("Shadow report failed:", err);
  process.exit(1);
});
