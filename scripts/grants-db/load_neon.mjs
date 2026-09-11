// Load output/grants-db/grants-active.jsonl into Neon table grants_active (idempotent upsert). Usage: node load_neon.mjs <jsonl> (requires BRANCH_DATABASE_URL)
import fs from "node:fs";
import readline from "node:readline";
import { neon } from "@neondatabase/serverless";
const url = process.env.BRANCH_DATABASE_URL;
if (!url) {
  console.error("no DB url");
  process.exit(1);
}
const sql = neon(url);
const file = process.argv[2];
if (process.argv.includes("--truncate"))
  throw new Error(
    "Truncation is disabled. Imports preserve existing records and staff reviews.",
  );
const q = (text, params) =>
  typeof sql.query === "function" ? sql.query(text, params) : sql(text, params);
const schema = fs.readFileSync(
  new URL("../../lib/grants/catalog-schema.sql", import.meta.url),
  "utf8",
);
for (const statement of schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean))
  await q(statement, []);
const cols = [
  "id",
  "source",
  "record_type",
  "chicago_relevance",
  "name",
  "sponsor",
  "level",
  "instrument",
  "status",
  "cadence",
  "opens_at",
  "closes_at",
  "closing_soon",
  "days_to_close",
  "amount_min",
  "amount_max",
  "amount_display",
  "entity_types",
  "geography",
  "legitimacy",
  "cost_to_apply",
  "is_new",
  "apply_url",
  "source_url",
  "verified_at",
  "tags",
  "match_readiness",
  "missing_fields",
  "next_review_date",
  "staff_owner",
  "funding_source",
  "payment_timing",
  "required_contribution",
  "landlord_or_tenant",
  "operating_stage",
  "uses_eligible",
  "uses_exclusions",
  "payload",
];
const d = (s) =>
  s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0, 10) : null;
const toRow = (r) => {
  const P = r.program || {},
    w = r.window || {},
    f = r.funding || {},
    A = r.applicants || {},
    U = r.uses || {},
    V = r.verification || {},
    R = r.readiness || {};
  return [
    r.id,
    r.source,
    r.recordType,
    r.chicagoRelevance,
    P.name || "(untitled)",
    P.funder || null,
    P.level || null,
    f.type || null,
    w.status,
    w.recurs || null,
    d(w.opensAt),
    d(w.deadline),
    !!w.closingSoon,
    w.daysToDeadline ?? null,
    Number.isFinite(f.amountMin) ? f.amountMin : null,
    Number.isFinite(f.amountMax) ? f.amountMax : null,
    f.amountDisplay || null,
    A.businessTypes || [],
    A.location || null,
    V.legitimacy || null,
    f.costToApply || null,
    !!V.isNew,
    P.applyUrl || null,
    V.sourceUrl || null,
    d(V.dateChecked),
    r.tags || [],
    R.status || "needs_research",
    R.missing || [],
    d(V.nextReviewDate),
    V.staffOwner || null,
    P.fundingSource || null,
    f.paymentTiming || null,
    f.requiredContribution || null,
    A.landlordOrTenant || null,
    A.operatingStage || null,
    U.eligible || [],
    (U.exclusions || []).map((x) => String(x).slice(0, 300)),
    JSON.stringify(r),
  ];
};
const rl = readline.createInterface({ input: fs.createReadStream(file) });
let batch = [],
  n = 0,
  seen = new Set();
const counts = {};
async function flush() {
  if (!batch.length) return;
  const params = [],
    tuples = [];
  batch.forEach((row, i) => {
    const ph = row.map(
      (_, j) =>
        `$${i * cols.length + j + 1}${j === cols.length - 1 ? "::jsonb" : ""}`,
    );
    tuples.push(`(${ph.join(",")})`);
    params.push(...row);
  });
  await q(
    `INSERT INTO grants_active (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (id) DO UPDATE SET ${cols
      .filter((c) => c !== "id")
      .map((c) => `${c}=EXCLUDED.${c}`)
      .join(",")}, loaded_at=now()`,
    params,
  );
  n += batch.length;
  batch = [];
}
for await (const line of rl) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  counts[r.source] = (counts[r.source] || 0) + 1;
  batch.push(toRow(r));
  if (batch.length >= 300) await flush();
}
await flush();
const asOf = process.env.AS_OF || "2026-09-11";
await q(
  `INSERT INTO grants_active_loads (as_of_date, row_count, counts) VALUES ($1,$2,$3::jsonb)`,
  [asOf, n, JSON.stringify(counts)],
);
const check = await q(
  `SELECT count(*)::int AS rows, count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE closing_soon)::int AS closing_soon, count(*) FILTER (WHERE match_readiness='ready')::int AS ready FROM grants_active`,
  [],
);
console.log("loaded", n, "rows; table now:", JSON.stringify(check));
