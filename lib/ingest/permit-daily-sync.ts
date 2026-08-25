import { socrataHeaders } from "@/lib/socrata";
import {
  PERMITS_URL,
  PERMIT_SELECT_COLS,
  SINCE_DATE,
  permitsAdapter,
  type RawPermit,
} from "./permits";
import type { SQL } from "./types";

const SOURCE_KEY = "building_permits";
const PAGE_SIZE = 5_000;
const MAX_CHANGED_ROWS = 50_000;
const CURSOR_OVERLAP_MS = 48 * 60 * 60 * 1_000;
const LEASE_SECONDS = 15 * 60;

type IncrementalRawPermit = RawPermit & {
  ":id"?: string;
  ":updated_at"?: string;
};

export type DailyPermitSyncResult = {
  status:
    | "synced"
    | "no_changes"
    | "already_running"
    | "bootstrap_required"
    | "surge_blocked";
  rowsChanged: number;
  rowsFetched: number;
  rowsWritten: number;
  rowsRemoved: number;
  cursor: string | null;
};

type PermitSyncAdapter = Pick<typeof permitsAdapter, "normalize" | "upsert">;

export interface DailyPermitSyncOptions {
  sql: SQL;
  fetchImpl?: typeof fetch;
  adapter?: PermitSyncAdapter;
}

function timestampOrNull(value: unknown): string | null {
  if (value == null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sourceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sourceLiteral(value: string): string {
  // Every caller first canonicalizes through Date#toISOString. Keeping the
  // final quote escape makes the query safe if this helper is reused.
  return `'${value.replaceAll("'", "''")}'`;
}

function permitIsInWindow(row: RawPermit): boolean {
  const issueDate = row.issue_date?.slice(0, 10);
  return issueDate != null && /^\d{4}-\d{2}-\d{2}$/.test(issueDate) && issueDate >= SINCE_DATE;
}

async function ensureStateTable(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS permit_sync_state (
      source_key TEXT PRIMARY KEY,
      cursor_updated_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      rows_changed INTEGER NOT NULL DEFAULT 0,
      rows_fetched INTEGER NOT NULL DEFAULT 0,
      rows_written INTEGER NOT NULL DEFAULT 0,
      rows_removed INTEGER NOT NULL DEFAULT 0,
      lease_until TIMESTAMPTZ,
      last_error TEXT
    )
  `;
}

async function claimRun(sql: SQL): Promise<{ claimed: boolean; cursor: string | null }> {
  const rows = await sql`
    INSERT INTO permit_sync_state (
      source_key,
      cursor_updated_at,
      last_checked_at,
      lease_until
    )
    SELECT
      ${SOURCE_KEY},
      MAX(fetched_at),
      NOW(),
      NOW() + (${LEASE_SECONDS} * INTERVAL '1 second')
    FROM building_permits
    ON CONFLICT (source_key) DO UPDATE SET
      cursor_updated_at = COALESCE(
        permit_sync_state.cursor_updated_at,
        EXCLUDED.cursor_updated_at
      ),
      last_checked_at = NOW(),
      lease_until = EXCLUDED.lease_until
    WHERE permit_sync_state.lease_until IS NULL
       OR permit_sync_state.lease_until <= NOW()
    RETURNING cursor_updated_at::text
  `;
  const row = (rows as Record<string, unknown>[])[0];
  return {
    claimed: row != null,
    cursor: timestampOrNull(row?.cursor_updated_at),
  };
}

async function finishRun(
  sql: SQL,
  result: Omit<DailyPermitSyncResult, "status">,
): Promise<void> {
  await sql`
    UPDATE permit_sync_state
    SET
      cursor_updated_at = COALESCE(${result.cursor}, cursor_updated_at),
      last_checked_at = NOW(),
      last_success_at = NOW(),
      rows_changed = ${result.rowsChanged},
      rows_fetched = ${result.rowsFetched},
      rows_written = ${result.rowsWritten},
      rows_removed = ${result.rowsRemoved},
      lease_until = NULL,
      last_error = NULL
    WHERE source_key = ${SOURCE_KEY}
  `;
}

async function failRun(sql: SQL, message: string): Promise<void> {
  await sql`
    UPDATE permit_sync_state
    SET
      last_checked_at = NOW(),
      lease_until = NULL,
      last_error = ${message.slice(0, 2_000)}
    WHERE source_key = ${SOURCE_KEY}
  `;
}

async function sourceJson(
  fetchImpl: typeof fetch,
  params: URLSearchParams,
): Promise<unknown> {
  const response = await fetchImpl(`${PERMITS_URL}?${params.toString()}`, {
    headers: socrataHeaders(),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Chicago permits source returned ${response.status}`);
  }
  return response.json();
}

async function changedSourceWindow(
  fetchImpl: typeof fetch,
  lowerCursor: string,
): Promise<{ count: number; upperCursor: string | null }> {
  const params = new URLSearchParams({
    $select: "count(1),max(:updated_at)",
    $where: `:updated_at > ${sourceLiteral(lowerCursor)}`,
  });
  const payload = await sourceJson(fetchImpl, params);
  const row = Array.isArray(payload) ? payload[0] : null;
  const raw = row && typeof row === "object"
    ? (row as Record<string, unknown>).count_1 ?? (row as Record<string, unknown>).count
    : null;
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Chicago permits source returned an invalid change count");
  }
  const maxUpdatedAt = row && typeof row === "object"
    ? (row as Record<string, unknown>).max_updated_at
    : null;
  const upperCursor = sourceTimestamp(maxUpdatedAt);
  if (count > 0 && !upperCursor) {
    throw new Error("Chicago permits source returned an invalid upper cursor");
  }
  return { count, upperCursor };
}

async function fetchChangedRows(
  fetchImpl: typeof fetch,
  lowerCursor: string,
  upperCursor: string,
  expected: number,
): Promise<IncrementalRawPermit[]> {
  const rows: IncrementalRawPermit[] = [];
  let pageCursor = lowerCursor;
  let pageId = "";

  while (rows.length < expected) {
    const afterCursor = pageId
      ? `(:updated_at > ${sourceLiteral(pageCursor)} OR (` +
        `:updated_at = ${sourceLiteral(pageCursor)} AND :id > ${sourceLiteral(pageId)}))`
      : `:updated_at > ${sourceLiteral(pageCursor)}`;
    const cursorFilter = `${afterCursor} AND :updated_at <= ${sourceLiteral(upperCursor)}`;
    const params = new URLSearchParams({
      $select: `:id,:updated_at,${PERMIT_SELECT_COLS}`,
      $where: cursorFilter,
      $order: ":updated_at,:id",
      $limit: String(Math.min(PAGE_SIZE, expected - rows.length)),
    });
    const payload = await sourceJson(fetchImpl, params);
    if (!Array.isArray(payload)) {
      throw new Error("Chicago permits source returned an invalid page");
    }
    if (payload.length === 0) break;

    for (const value of payload) {
      if (!value || typeof value !== "object") {
        throw new Error("Chicago permits source returned an invalid row");
      }
      const row = value as IncrementalRawPermit;
      const updatedAt = sourceTimestamp(row[":updated_at"]);
      const sourceId = row[":id"]?.trim();
      if (!updatedAt || !sourceId) {
        throw new Error("Chicago permits source omitted its row cursor");
      }
      rows.push(row);
      pageCursor = updatedAt;
      pageId = sourceId;
    }
  }

  if (rows.length !== expected) {
    throw new Error(
      `Chicago permits change reconciliation failed: expected ${expected}, fetched ${rows.length}`,
    );
  }
  return rows;
}

/**
 * Apply only rows the City changed since the last successful cursor. The
 * 48-hour overlap is deliberately replayed on every run: upserts are keyed by
 * permit id, so replay is cheap and gives late-published corrections a second
 * chance. A source-wide rewrite is stopped before any row is written.
 */
export async function runDailyPermitSync({
  sql,
  fetchImpl = fetch,
  adapter = permitsAdapter,
}: DailyPermitSyncOptions): Promise<DailyPermitSyncResult> {
  await ensureStateTable(sql);
  const claim = await claimRun(sql);
  if (!claim.claimed) {
    return {
      status: "already_running",
      rowsChanged: 0,
      rowsFetched: 0,
      rowsWritten: 0,
      rowsRemoved: 0,
      cursor: null,
    };
  }

  if (!claim.cursor) {
    const message = "Daily permit sync requires an existing citywide permit bootstrap";
    await failRun(sql, message);
    return {
      status: "bootstrap_required",
      rowsChanged: 0,
      rowsFetched: 0,
      rowsWritten: 0,
      rowsRemoved: 0,
      cursor: null,
    };
  }

  try {
    const lowerCursor = new Date(
      new Date(claim.cursor).getTime() - CURSOR_OVERLAP_MS,
    ).toISOString();
    const sourceWindow = await changedSourceWindow(fetchImpl, lowerCursor);
    const rowsChanged = sourceWindow.count;

    if (rowsChanged > MAX_CHANGED_ROWS) {
      await failRun(
        sql,
        `Daily permit sync blocked source surge of ${rowsChanged} changed rows`,
      );
      return {
        status: "surge_blocked",
        rowsChanged,
        rowsFetched: 0,
        rowsWritten: 0,
        rowsRemoved: 0,
        cursor: claim.cursor,
      };
    }

    if (rowsChanged === 0) {
      const empty = {
        rowsChanged: 0,
        rowsFetched: 0,
        rowsWritten: 0,
        rowsRemoved: 0,
        cursor: claim.cursor,
      };
      await finishRun(sql, empty);
      return { status: "no_changes", ...empty };
    }

    const newestCursor = sourceWindow.upperCursor;
    if (!newestCursor) throw new Error("Chicago permits source did not provide a final cursor");
    const changed = await fetchChangedRows(
      fetchImpl,
      lowerCursor,
      newestCursor,
      rowsChanged,
    );

    const upsertByPermitId = new Map<string, ReturnType<typeof adapter.normalize>>();
    const removeIds = new Set<string>();
    for (const raw of changed) {
      const permitId = raw.permit_?.trim();
      if (!permitId) continue;
      const normalized = permitIsInWindow(raw) ? adapter.normalize(raw) : null;
      if (normalized) {
        removeIds.delete(permitId);
        upsertByPermitId.set(permitId, normalized);
      } else {
        upsertByPermitId.delete(permitId);
        removeIds.add(permitId);
      }
    }

    const upsertRows = Array.from(upsertByPermitId.values()).filter(
      (row): row is NonNullable<typeof row> => row != null,
    );
    const rowsWritten = upsertRows.length > 0
      ? await adapter.upsert(sql, upsertRows)
      : 0;
    let rowsRemoved = 0;
    if (removeIds.size > 0) {
      const removed = await sql`
        DELETE FROM building_permits
        WHERE permit_id = ANY(${Array.from(removeIds)}::text[])
        RETURNING permit_id
      `;
      rowsRemoved = (removed as unknown[]).length;
    }

    const completed = {
      rowsChanged,
      rowsFetched: changed.length,
      rowsWritten,
      rowsRemoved,
      cursor: newestCursor,
    };
    await finishRun(sql, completed);
    return { status: "synced", ...completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown daily permit sync error";
    try {
      await failRun(sql, message);
    } catch (stateError) {
      console.error("daily permit sync: could not record failure", stateError);
    }
    throw error;
  }
}
