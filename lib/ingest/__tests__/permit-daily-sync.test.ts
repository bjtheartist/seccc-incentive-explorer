import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "../types";
import {
  runDailyPermitSync,
  type DailyPermitSyncResult,
} from "../permit-daily-sync";
import type { PermitRow, RawPermit } from "../permits";

const CURSOR = "2026-08-20T12:00:00.000Z";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sqlWithClaim(cursor: string | null | "unclaimed" = CURSOR) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const mock = vi.fn(async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const query = strings.join("?");
    queries.push(query);
    values.push(params);
    if (query.includes("INSERT INTO permit_sync_state")) {
      return cursor === "unclaimed" ? [] : [{ cursor_updated_at: cursor }];
    }
    if (query.includes("DELETE FROM building_permits")) {
      const ids = Array.isArray(params[0]) ? params[0] : [];
      return ids.map((permit_id) => ({ permit_id }));
    }
    return [];
  });
  return { sql: mock as unknown as SQL, mock, queries, values };
}

function raw(overrides: Partial<RawPermit & { ":id": string; ":updated_at": string }> = {}) {
  return {
    ":id": "row-1",
    ":updated_at": "2026-08-25T12:27:11.706Z",
    permit_: "PERMIT-1",
    issue_date: "2026-08-24T00:00:00.000",
    street_number: "100",
    street_direction: "S",
    street_name: "STATE ST",
    ...overrides,
  };
}

function permitRow(permitId: string): PermitRow {
  return {
    permitId,
    pin: null,
    pins: [],
    address: "100 S STATE ST",
    zip: null,
    permitType: null,
    permitStatus: null,
    permitMilestone: null,
    workType: null,
    permitCondition: null,
    workDescription: null,
    issueDate: "2026-08-24T00:00:00.000",
    reportedCost: null,
    isDemolition: false,
    lat: null,
    lon: null,
    provenance: { source: "building_permits", raw_json: {} },
  };
}

function adapter() {
  return {
    normalize: vi.fn((value: RawPermit) =>
      value.permit_ === "PERMIT-UNPLACEABLE"
        ? null
        : permitRow(String(value.permit_)),
    ),
    upsert: vi.fn(async (_sql: SQL, rows: PermitRow[]) => rows.length),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("runDailyPermitSync", () => {
  it("upserts changed in-window rows, removes rows that no longer qualify, and advances only to the source cursor", async () => {
    const db = sqlWithClaim();
    const sourceRows = [
      raw(),
      raw({
        ":id": "row-2",
        permit_: "PERMIT-OLD",
        issue_date: "2014-12-31T00:00:00.000",
      }),
      raw({
        ":id": "row-3",
        permit_: "PERMIT-UNPLACEABLE",
        street_number: undefined,
        street_direction: undefined,
        street_name: undefined,
      }),
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.searchParams.get("$select") === "count(1),max(:updated_at)"
        ? response([{ count_1: "3", max_updated_at: "2026-08-25T12:27:11.706Z" }])
        : response(sourceRows);
    });
    const syncAdapter = adapter();

    const result = await runDailyPermitSync({
      sql: db.sql,
      fetchImpl: fetchMock as typeof fetch,
      adapter: syncAdapter,
    });

    expect(result).toEqual<DailyPermitSyncResult>({
      status: "synced",
      rowsChanged: 3,
      rowsFetched: 3,
      rowsWritten: 1,
      rowsRemoved: 2,
      cursor: "2026-08-25T12:27:11.706Z",
    });
    expect(syncAdapter.upsert).toHaveBeenCalledOnce();
    expect(syncAdapter.upsert.mock.calls[0][1].map((row) => row.permitId)).toEqual([
      "PERMIT-1",
    ]);
    expect(syncAdapter.normalize.mock.calls[0][0]).toMatchObject({
      ":id": "row-1",
      ":updated_at": "2026-08-25T12:27:11.706Z",
    });
    expect(db.queries.some((query) => query.includes("DELETE FROM building_permits"))).toBe(true);
    expect(db.values.flat()).toContainEqual(["PERMIT-OLD", "PERMIT-UNPLACEABLE"]);
    expect(db.queries.at(-1)).toContain("last_success_at = NOW()");

    const countUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const pageUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(countUrl.searchParams.get("$where")).toBe(
      ":updated_at > '2026-08-18T12:00:00.000Z'",
    );
    expect(countUrl.searchParams.get("$where")).not.toContain("issue_date");
    expect(pageUrl.searchParams.get("$select")).toContain(":id,:updated_at,permit_");
    expect(pageUrl.searchParams.get("$order")).toBe(":updated_at,:id");
    expect(pageUrl.searchParams.get("$where")).toContain(
      ":updated_at <= '2026-08-25T12:27:11.706Z'",
    );
  });

  it("records a successful daily check when Chicago has no changed rows", async () => {
    const db = sqlWithClaim();
    const fetchMock = vi.fn(async () => response([{ count_1: "0", max_updated_at: null }]));
    const syncAdapter = adapter();

    const result = await runDailyPermitSync({
      sql: db.sql,
      fetchImpl: fetchMock as typeof fetch,
      adapter: syncAdapter,
    });

    expect(result.status).toBe("no_changes");
    expect(result.cursor).toBe(CURSOR);
    expect(syncAdapter.upsert).not.toHaveBeenCalled();
    expect(db.queries.at(-1)).toContain("last_success_at = NOW()");
  });

  it("fails closed when the citywide bootstrap is missing", async () => {
    const db = sqlWithClaim(null);
    const fetchMock = vi.fn();

    const result = await runDailyPermitSync({
      sql: db.sql,
      fetchImpl: fetchMock as typeof fetch,
      adapter: adapter(),
    });

    expect(result.status).toBe("bootstrap_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.queries.at(-1)).toContain("last_error =");
  });

  it("treats a duplicate delivery as already running without touching Chicago or the cursor", async () => {
    const db = sqlWithClaim("unclaimed");
    const fetchMock = vi.fn();

    const result = await runDailyPermitSync({
      sql: db.sql,
      fetchImpl: fetchMock as typeof fetch,
      adapter: adapter(),
    });

    expect(result.status).toBe("already_running");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(2);
  });

  it("blocks an upstream full-dataset rewrite before fetching or writing rows", async () => {
    const db = sqlWithClaim();
    const fetchMock = vi.fn(async () =>
      response([{ count_1: "50001", max_updated_at: "2026-08-25T12:27:11.706Z" }]),
    );
    const syncAdapter = adapter();

    const result = await runDailyPermitSync({
      sql: db.sql,
      fetchImpl: fetchMock as typeof fetch,
      adapter: syncAdapter,
    });

    expect(result.status).toBe("surge_blocked");
    expect(result.rowsChanged).toBe(50_001);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(syncAdapter.upsert).not.toHaveBeenCalled();
    expect(db.queries.at(-1)).toContain("last_error =");
    expect(db.values.at(-1)?.join(" ")).toContain("50001 changed rows");
  });

  it("does not advance the cursor when source reconciliation is incomplete", async () => {
    const db = sqlWithClaim();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response([{ count_1: "2", max_updated_at: "2026-08-25T12:27:11.706Z" }]),
      )
      .mockResolvedValueOnce(response([raw()]))
      .mockResolvedValueOnce(response([]));
    const syncAdapter = adapter();

    await expect(
      runDailyPermitSync({
        sql: db.sql,
        fetchImpl: fetchMock as typeof fetch,
        adapter: syncAdapter,
      }),
    ).rejects.toThrow("expected 2, fetched 1");

    expect(syncAdapter.upsert).not.toHaveBeenCalled();
    expect(db.queries.at(-1)).toContain("last_error =");
    expect(db.queries.at(-1)).not.toContain("last_success_at = NOW()");
  });
});
