// Load output/grants-db/grants-active.jsonl into Neon table grants_active (idempotent upsert). Usage: node load_neon.mjs <jsonl> [--truncate]
import { createRequire } from 'module'; import fs from 'fs'; import readline from 'readline';
const require = createRequire('/Users/billyndizeye/seccc-incentive-explorer/package.json');
const { neon } = require('@neondatabase/serverless');
const url = process.env.BRANCH_DATABASE_URL || process.env.DATABASE_URL; if (!url) { console.error('no DB url'); process.exit(1); }
const sql = neon(url); const file = process.argv[2]; const truncate = process.argv.includes('--truncate');
const q = (text, params) => (typeof sql.query === 'function' ? sql.query(text, params) : sql(text, params));
await q(`CREATE TABLE IF NOT EXISTS grants_active (
  id text PRIMARY KEY, source text NOT NULL, record_type text NOT NULL, chicago_relevance text NOT NULL,
  name text NOT NULL, sponsor text, level text, instrument text, status text NOT NULL, cadence text,
  opens_at date, closes_at date, closing_soon boolean NOT NULL DEFAULT false, days_to_close integer,
  amount_min bigint, amount_max bigint, amount_display text,
  entity_types text[] NOT NULL DEFAULT '{}', geography text, legitimacy text, cost_to_apply text, is_new boolean NOT NULL DEFAULT false,
  apply_url text, source_url text, verified_at date, tags text[] NOT NULL DEFAULT '{}', payload jsonb NOT NULL,
  match_readiness text NOT NULL DEFAULT 'needs_research', missing_fields text[] NOT NULL DEFAULT '{}', next_review_date date, staff_owner text, funding_source text, payment_timing text, required_contribution text, landlord_or_tenant text, operating_stage text, uses_eligible text[] NOT NULL DEFAULT '{}', uses_exclusions text[] NOT NULL DEFAULT '{}',
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(sponsor,'') || ' ' || coalesce(payload->'applicants'->>'summary','') || ' ' || coalesce(payload->'uses'->>'summary',''))) STORED,
  loaded_at timestamptz NOT NULL DEFAULT now())`, []);
for (const ddl of [
  `CREATE INDEX IF NOT EXISTS grants_active_status_idx ON grants_active (status)`,
  `CREATE INDEX IF NOT EXISTS grants_active_relevance_idx ON grants_active (chicago_relevance)`,
  `CREATE INDEX IF NOT EXISTS grants_active_closes_idx ON grants_active (closes_at)`,
  `CREATE INDEX IF NOT EXISTS grants_active_source_idx ON grants_active (source, record_type)`,
  `CREATE INDEX IF NOT EXISTS grants_active_tags_gin ON grants_active USING GIN (tags)`,
  `CREATE INDEX IF NOT EXISTS grants_active_entity_gin ON grants_active USING GIN (entity_types)`,
  `CREATE INDEX IF NOT EXISTS grants_active_search_gin ON grants_active USING GIN (search)`,
  `CREATE TABLE IF NOT EXISTS grants_active_loads (id serial PRIMARY KEY, as_of_date date NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now(), row_count integer NOT NULL, counts jsonb)`,
]) await q(ddl, []);
if (truncate) await q(`TRUNCATE grants_active`, []);
const cols = ['id','source','record_type','chicago_relevance','name','sponsor','level','instrument','status','cadence','opens_at','closes_at','closing_soon','days_to_close','amount_min','amount_max','amount_display','entity_types','geography','legitimacy','cost_to_apply','is_new','apply_url','source_url','verified_at','tags','match_readiness','missing_fields','next_review_date','staff_owner','funding_source','payment_timing','required_contribution','landlord_or_tenant','operating_stage','uses_eligible','uses_exclusions','payload'];
const d = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0,10) : null);
const toRow = (r) => { const P=r.program||{}, w=r.window||{}, f=r.funding||{}, A=r.applicants||{}, U=r.uses||{}, V=r.verification||{}, R=r.readiness||{}; return [r.id, r.source, r.recordType, r.chicagoRelevance, P.name || '(untitled)', P.funder || null, P.level || null, f.type || null, w.status, w.recurs || null, d(w.opensAt), d(w.deadline), !!w.closingSoon, w.daysToDeadline ?? null, Number.isFinite(f.amountMin) ? f.amountMin : null, Number.isFinite(f.amountMax) ? f.amountMax : null, f.amountDisplay || null, A.businessTypes || [], A.location || null, V.legitimacy || null, f.costToApply || null, !!V.isNew, P.applyUrl || null, V.sourceUrl || null, d(V.dateChecked), r.tags || [], R.status || 'needs_research', R.missing || [], d(V.nextReviewDate), V.staffOwner || null, P.fundingSource || null, f.paymentTiming || null, f.requiredContribution || null, A.landlordOrTenant || null, A.operatingStage || null, U.eligible || [], (U.exclusions || []).map(x=>String(x).slice(0,300)), JSON.stringify(r)]; };
const rl = readline.createInterface({ input: fs.createReadStream(file) }); let batch = [], n = 0, seen = new Set(); const counts = {};
async function flush() { if (!batch.length) return; const params = [], tuples = []; batch.forEach((row, i) => { const ph = row.map((_, j) => `$${i*cols.length + j + 1}${j===cols.length-1?'::jsonb':''}`); tuples.push(`(${ph.join(',')})`); params.push(...row); });
  await q(`INSERT INTO grants_active (${cols.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT (id) DO UPDATE SET ${cols.filter(c=>c!=='id').map(c=>`${c}=EXCLUDED.${c}`).join(',')}, loaded_at=now()`, params); n += batch.length; batch = []; }
for await (const line of rl) { if (!line.trim()) continue; const r = JSON.parse(line); if (seen.has(r.id)) continue; seen.add(r.id); counts[r.source] = (counts[r.source]||0)+1; batch.push(toRow(r)); if (batch.length >= 300) await flush(); }
await flush();
const asOf = process.env.AS_OF || '2026-09-11';
await q(`INSERT INTO grants_active_loads (as_of_date, row_count, counts) VALUES ($1,$2,$3::jsonb)`, [asOf, n, JSON.stringify(counts)]);
const check = await q(`SELECT count(*)::int AS rows, count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE closing_soon)::int AS closing_soon, count(*) FILTER (WHERE match_readiness='ready')::int AS ready FROM grants_active`, []);
console.log('loaded', n, 'rows; table now:', JSON.stringify(check));
