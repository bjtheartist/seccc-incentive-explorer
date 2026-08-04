# Ingestion contract (`lib/ingest`)

A reusable pipeline for persisting external property data into Postgres. Each
upstream dataset (parcels, ownership history, business licenses, permits,
violations, 311, ...) is implemented as a **source adapter** and driven by a
shared runner. Provenance is stored on every row so data can be trusted, aged
out, and re-derived without re-fetching.

## Pieces

- `types.ts` — the contract. `SourceAdapter<TRaw, TRow>`, `FetchOpts`,
  `Provenance`, `IngestResult`. Read this first.
- `run.ts` — `runIngest(adapter, opts)`: fetch → normalize (drop nulls) →
  upsert, returning an `IngestResult`. Gets the Neon client via `requireSQL()`.
- `parcels.ts` — the reference adapter. Copy its structure.

## The `SourceAdapter` lifecycle

```
runIngest(adapter, { zips })
  ├─ raw  = adapter.fetch({ zips })        // TRaw[]
  ├─ rows = raw.map(normalize) drop null   // TRow[]
  └─ written = adapter.upsert(sql, rows)   // number
```

An adapter implements exactly four members:

| member        | responsibility                                                        |
| ------------- | --------------------------------------------------------------------- |
| `sourceKey`   | stable unique id; also the provenance `source`. Never rename.         |
| `targetTable` | primary table written (documentary).                                  |
| `fetch`       | pull raw records, scoped by `opts.zips`. Resilient (retry/timeout).   |
| `normalize`   | one raw record → DB-ready row, or `null` to drop. **Pure** (testable).|
| `upsert`      | persist rows via `ON CONFLICT`. Returns rows written.                 |

### Rules

- **Idempotent.** `upsert` must use `ON CONFLICT` on a stable key so re-runs
  never duplicate. Append-only history tables use `ON CONFLICT ... DO NOTHING`.
- **Provenance on every row.** Carry `Provenance` (`source`, optional
  `fetched_at`, `raw_json`) into the row and persist `raw_json` as JSONB so
  normalization can be replayed.
- **`normalize` is pure** — no DB, no network. This is what the unit tests hit.
- **Adapters own their SQL.** The runner passes the client; it never writes.
- **Migrations are additive + idempotent** (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`). Never alter/drop existing tables or columns.

## How to add a new source

1. **Migration** — add `scripts/migrate-<source>.ts` (mirror
   `scripts/migrate-parcels.ts`): idempotent DDL, GIST index on any `geom`.
   Append it to the `db:migrate` chain and add a `db:migrate:<source>` script.
2. **Adapter** — add `lib/ingest/<source>.ts` exporting a
   `SourceAdapter<TRaw, TRow>`. Define `TRaw` (upstream shape) and `TRow`
   (DB-ready, carrying `provenance`). Reuse `socrataFetch`/`socrataHeaders`
   (`@/lib/socrata`) and any classifiers. Keep `normalize` pure.
3. **Sync script** — add `scripts/sync-<source>.ts` (mirror
   `scripts/sync-parcels.ts`): call `runIngest(adapter, { zips })`, print the
   `IngestResult`. Add a `db:sync:<source>` script.
4. **Test** — add `lib/ingest/__tests__/<source>.test.ts` covering `normalize`
   (happy path, dropped/`null` cases, provenance).
5. **Consume** — make the relevant API route DB-first: read from the new table,
   fall back to the existing live path. Additive only.

## Scope

Most backfills target the three SE-Chicago ZIPs: **60617, 60619, 60649**.

**`permits.ts` is the exception — it is CITYWIDE.** The SE-Chicago bounding box
is gone; the fetch is bounded only by the issue-date window
(`PERMIT_SINCE_DATE` in `lib/permit-match.ts`, currently 2015-01-01) and it
ignores `opts.zips`. When you add or change a citywide adapter:

- **Page by keyset, not `$offset`.** At ~470k rows deep-offset paging is slow
  and can skip or repeat rows at a page boundary. `permits.ts` cursors on the
  dataset's own unique `id`.
- **Reconcile the retrieved count against the source's own `count(1)`** for the
  identical filter, and surface the comparison. `permits.ts` records it in
  `lastFetchAudit`; `scripts/sync-condition.ts` prints it and warns loudly on a
  shortfall. A truncated ingest reads downstream as "this parcel has no
  permit" — a claim about the city rather than about the run.
- **Upsert set-based.** One INSERT per row is ~470k HTTP round trips on the
  Neon serverless driver. `permits.ts` unnests parallel arrays a page at a time.

## Verify

`npm run lint` · `npx tsc --noEmit` · `npm run test`.

**Never run a migration or a sync against production.** These scripts write to
whatever `DATABASE_URL` points at. Verify on a disposable Neon branch, report
the numbers, and leave the production run to the repo owner.
