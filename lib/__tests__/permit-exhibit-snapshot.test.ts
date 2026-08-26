import { describe, expect, it, vi } from "vitest";
import {
  PERMIT_EXHIBIT_SNAPSHOT_MAX_CREATES_PER_HOUR,
  PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION,
  PermitExhibitSnapshotCorruptError,
  PermitExhibitSnapshotStorageUnavailableError,
  buildPermitExhibitSnapshotDocument,
  computePermitExhibitSnapshotHash,
  createPermitExhibitSnapshot,
  decodePermitExhibitSnapshotRow,
  loadPermitExhibitSnapshot,
  reservePermitExhibitSnapshotCreate,
  stablePermitExhibitSnapshotJson,
  type CreatePermitExhibitSnapshotInput,
  type PermitExhibitSnapshotDocument,
} from "../permit-exhibit-snapshot";
import {
  fixturePermitExhibit,
  fixturePermitExhibitSubjectRow,
} from "../permit-exhibit-fixtures";
import type { PermitExhibitResult } from "../permit-exhibit";

const PUBLIC_ID_A = `ps_${"A".repeat(24)}`;
const PUBLIC_ID_B = `ps_${"B".repeat(24)}`;
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SAVED_AT = new Date("2026-08-26T15:30:00.000Z");

type SnapshotSql = NonNullable<CreatePermitExhibitSnapshotInput["sql"]>;

function snapshotDocument(
  exhibit: PermitExhibitResult = fixturePermitExhibit(),
  overrides: Partial<{
    publicId: string;
    displaySuffix: string;
    appRevision: string;
    now: () => Date;
  }> = {},
): PermitExhibitSnapshotDocument {
  return buildPermitExhibitSnapshotDocument({
    exhibit,
    publicId: overrides.publicId ?? PUBLIC_ID_A,
    displaySuffix: overrides.displaySuffix ?? "ABCD",
    appRevision: overrides.appRevision ?? "test-revision",
    now: overrides.now ?? (() => SAVED_AT),
  });
}

function snapshotRow(
  document: PermitExhibitSnapshotDocument,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    public_id: document.publicId,
    display_id: document.displayId,
    pin: document.exhibit.meta.subjectParcel.pin,
    radius_ft: document.exhibit.meta.queryParams.radiusFt,
    snapshot_schema_version: document.schemaVersion,
    saved_at: document.savedAt,
    content_hash: computePermitExhibitSnapshotHash(document),
    app_revision: document.appRevision,
    snapshot_json: document,
    ...overrides,
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function emptyHistoryExhibit(): PermitExhibitResult {
  const exhibit = fixturePermitExhibit({ subject: [], areaRows: [] });
  exhibit.meta.datasetLastUpdate = null;
  return exhibit;
}

describe("permit exhibit snapshot canonical integrity envelope", () => {
  it("always generates a four-character display suffix from the safe alphabet", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(
        buildPermitExhibitSnapshotDocument({
          exhibit: fixturePermitExhibit(),
          publicId: PUBLIC_ID_A,
          now: () => SAVED_AT,
        }).displayId,
      ).toMatch(/^PX-\d{14}-\d{8}-[A-Z0-9]{4}$/);
    }
  });

  it("hashes logically identical documents identically despite recursive object-key reordering", () => {
    const document = snapshotDocument();
    const reordered = reverseObjectKeys(document) as PermitExhibitSnapshotDocument;

    expect(stablePermitExhibitSnapshotJson(reordered)).toBe(
      stablePermitExhibitSnapshotJson(document),
    );
    expect(computePermitExhibitSnapshotHash(reordered)).toBe(
      computePermitExhibitSnapshotHash(document),
    );
  });

  it("changes the hash for permit content and for live context even when empty history has no dataset vintage", () => {
    const empty = emptyHistoryExhibit();
    const baseline = snapshotDocument(empty);

    const withPermit = structuredClone(empty);
    withPermit.subject = [
      fixturePermitExhibitSubjectRow({
        permitNumber: "100000001",
        workDescription: "ONE NEW PERMIT",
      }),
    ];

    const changedContext = structuredClone(empty);
    changedContext.boundaryContext.zoningDistrict.zoneClass = "C1-2";
    changedContext.boundaryContext.archiveVintageRange = {
      earliest: "2026-08-01",
      latest: "2026-08-26",
      snapshotCount: 2,
    };

    expect(empty.meta.datasetLastUpdate).toBeNull();
    expect(computePermitExhibitSnapshotHash(snapshotDocument(withPermit))).not.toBe(
      computePermitExhibitSnapshotHash(baseline),
    );
    expect(computePermitExhibitSnapshotHash(snapshotDocument(changedContext))).not.toBe(
      computePermitExhibitSnapshotHash(baseline),
    );
  });

  it.each(["object", "json string"])(
    "accepts a valid JSONB-style recursive key reorder supplied as %s",
    (representation) => {
      const document = snapshotDocument();
      const reordered = reverseObjectKeys(document);
      const row = snapshotRow(document, {
        snapshot_json: representation === "object" ? reordered : JSON.stringify(reordered),
      });

      expect(decodePermitExhibitSnapshotRow(row)).toEqual({
        ...document,
        contentHash: computePermitExhibitSnapshotHash(document),
      });
    },
  );
});

describe("permit exhibit snapshot reads fail closed", () => {
  it("rejects a one-field payload tamper when the stored content hash still describes the original", () => {
    const document = snapshotDocument();
    const tampered = structuredClone(document);
    tampered.exhibit.subject[0].workDescription = "TAMPERED";

    expect(() =>
      decodePermitExhibitSnapshotRow(snapshotRow(document, { snapshot_json: tampered })),
    ).toThrow(PermitExhibitSnapshotCorruptError);
  });

  it("rejects unsupported snapshot schemas even when the hash and mirrored schema column agree", () => {
    const document = snapshotDocument();
    const futureDocument = {
      ...document,
      schemaVersion: PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION + 1,
    } as unknown as PermitExhibitSnapshotDocument;

    expect(() =>
      decodePermitExhibitSnapshotRow(
        snapshotRow(document, {
          snapshot_schema_version: PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION + 1,
          snapshot_json: futureDocument,
          content_hash: computePermitExhibitSnapshotHash(futureDocument),
        }),
      ),
    ).toThrow(PermitExhibitSnapshotCorruptError);
  });

  it("rejects a malformed document shape even when its hash is internally consistent", () => {
    const document = snapshotDocument();
    const malformed = structuredClone(document) as unknown as Record<string, unknown>;
    const exhibit = malformed.exhibit as Record<string, unknown>;
    exhibit.area = { byYear: [], byType: [] };

    expect(() =>
      decodePermitExhibitSnapshotRow(
        snapshotRow(document, {
          snapshot_json: malformed,
          content_hash: computePermitExhibitSnapshotHash(
            malformed as unknown as PermitExhibitSnapshotDocument,
          ),
        }),
      ),
    ).toThrow(PermitExhibitSnapshotCorruptError);
  });

  it.each([
    ["null subject row", (value: Record<string, unknown>) => {
      const exhibit = value.exhibit as Record<string, unknown>;
      exhibit.subject = [null];
    }],
    ["null area row", (value: Record<string, unknown>) => {
      const exhibit = value.exhibit as Record<string, unknown>;
      const area = exhibit.area as Record<string, unknown>;
      area.rows = [null];
      const coverage = exhibit.coverage as Record<string, unknown>;
      coverage.area = { geolocatedCount: 1, unlocatedCount: 0, totalCount: 1 };
    }],
    ["unsafe source URL", (value: Record<string, unknown>) => {
      const exhibit = value.exhibit as Record<string, unknown>;
      const subject = exhibit.subject as Array<Record<string, unknown>>;
      subject[0].sourceRecordUrl = "javascript:alert(1)";
    }],
  ])("rejects a self-consistent %s before any renderer can dereference it", (_label, mutate) => {
    const document = snapshotDocument();
    const malformed = structuredClone(document) as unknown as Record<string, unknown>;
    mutate(malformed);

    expect(() =>
      decodePermitExhibitSnapshotRow(
        snapshotRow(document, {
          snapshot_json: malformed,
          content_hash: computePermitExhibitSnapshotHash(
            malformed as unknown as PermitExhibitSnapshotDocument,
          ),
        }),
      ),
    ).toThrow(PermitExhibitSnapshotCorruptError);
  });

  it("accepts PostgreSQL source timestamps and timestamped archive vintages from the real engine contract", () => {
    const exhibit = fixturePermitExhibit();
    exhibit.meta.datasetLastUpdate = "2026-08-26 11:22:33+00";
    exhibit.boundaryContext.archiveVintageRange = {
      earliest: "2026-07-23T21:36:35.000Z",
      latest: "2026-08-25T14:12:00.000Z",
      snapshotCount: 2,
    };
    const document = snapshotDocument(exhibit);

    expect(() => decodePermitExhibitSnapshotRow(snapshotRow(document))).not.toThrow();
  });

  it("keeps schema-v1 permit taxonomy stable when the live taxonomy changes later", () => {
    const historical = fixturePermitExhibit();
    historical.subject[0].typeKey = "permit_extension";
    const historicalDocument = snapshotDocument(historical);
    expect(() =>
      decodePermitExhibitSnapshotRow(snapshotRow(historicalDocument)),
    ).not.toThrow();

    const future = structuredClone(historicalDocument) as unknown as Record<string, unknown>;
    const exhibit = future.exhibit as Record<string, unknown>;
    const subject = exhibit.subject as Array<Record<string, unknown>>;
    subject[0].typeKey = "future_live_taxonomy_key";

    expect(() =>
      decodePermitExhibitSnapshotRow(
        snapshotRow(historicalDocument, {
          snapshot_json: future,
          content_hash: computePermitExhibitSnapshotHash(
            future as unknown as PermitExhibitSnapshotDocument,
          ),
        }),
      ),
    ).toThrow(PermitExhibitSnapshotCorruptError);
  });

  it.each([
    ["public_id", PUBLIC_ID_B],
    ["display_id", "PX-17091190280000-20260826-WXYZ"],
    ["pin", "99999999999999"],
    ["radius_ft", 1000],
    ["snapshot_schema_version", 2],
    ["saved_at", "2026-08-27T15:30:00.000Z"],
    ["content_hash", "0".repeat(64)],
    ["app_revision", "another-revision"],
  ])("rejects a mismatch between snapshot JSON and the mirrored %s column", (column, value) => {
    const document = snapshotDocument();
    expect(() => decodePermitExhibitSnapshotRow(snapshotRow(document, { [column]: value }))).toThrow(
      PermitExhibitSnapshotCorruptError,
    );
  });

  it.each(["bad", `ps_${"x".repeat(23)}`, "../ps_AAAAAAAAAAAAAAAAAAAAAAAA"])(
    "returns null for invalid public id %s without touching SQL",
    async (publicId) => {
      const sqlMock = vi.fn();

      await expect(
        loadPermitExhibitSnapshot(publicId, sqlMock as unknown as SnapshotSql),
      ).resolves.toBeNull();
      expect(sqlMock).not.toHaveBeenCalled();
    },
  );
});

describe("permit exhibit snapshot request-id idempotency", () => {
  it("rejects a malformed live result before immutable storage is touched", async () => {
    const malformed = fixturePermitExhibit() as unknown as Record<string, unknown>;
    const subject = malformed.subject as Array<Record<string, unknown>>;
    subject[0].matchConfidence = "impossible";
    const sqlMock = vi.fn();

    await expect(
      createPermitExhibitSnapshot({
        exhibit: malformed as unknown as PermitExhibitResult,
        requestId: REQUEST_ID,
        publicId: PUBLIC_ID_A,
        displaySuffix: "ABCD",
        now: () => SAVED_AT,
        sql: sqlMock as unknown as SnapshotSql,
      }),
    ).rejects.toBeInstanceOf(PermitExhibitSnapshotCorruptError);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("keeps and returns the first immutable winner when the same request id is retried with different content", async () => {
    const firstExhibit = fixturePermitExhibit();
    const conflictingExhibit = emptyHistoryExhibit();
    const winnerDocument = snapshotDocument(firstExhibit, { publicId: PUBLIC_ID_A });
    const winnerRow = snapshotRow(winnerDocument);
    let inserted = false;

    const sqlMock = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO permit_exhibit_snapshots")) {
        if (inserted) return [];
        inserted = true;
        return [winnerRow];
      }
      if (query.includes("WHERE request_id")) return [winnerRow];
      throw new Error(`Unexpected query: ${query}`);
    });

    const first = await createPermitExhibitSnapshot({
      exhibit: firstExhibit,
      requestId: REQUEST_ID,
      publicId: PUBLIC_ID_A,
      displaySuffix: "ABCD",
      appRevision: "test-revision",
      now: () => SAVED_AT,
      sql: sqlMock as unknown as SnapshotSql,
    });
    const retried = await createPermitExhibitSnapshot({
      exhibit: conflictingExhibit,
      requestId: REQUEST_ID,
      publicId: PUBLIC_ID_B,
      displaySuffix: "WXYZ",
      appRevision: "new-revision",
      now: () => new Date("2026-08-27T15:30:00.000Z"),
      sql: sqlMock as unknown as SnapshotSql,
    });

    expect(first).toEqual(retried);
    expect(retried.publicId).toBe(PUBLIC_ID_A);
    expect(retried.exhibit).toEqual(firstExhibit);
    expect(retried.exhibit).not.toEqual(conflictingExhibit);
    expect(sqlMock).toHaveBeenCalledTimes(3);
    expect(String(sqlMock.mock.calls[1][0])).toContain("ON CONFLICT (request_id) DO NOTHING");
  });
});

describe("permit exhibit snapshot create rate limiting", () => {
  it("uses the serialized database reservation function and allows its winner", async () => {
    const sqlMock = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("DELETE FROM permit_exhibit_snapshot_attempts")) return [];
      if (query.includes("reserve_permit_exhibit_snapshot_attempt")) return [{ allowed: true }];
      throw new Error(`Unexpected query: ${query}`);
    });

    await expect(
      reservePermitExhibitSnapshotCreate(
        "203.0.113.10",
        sqlMock as unknown as SnapshotSql,
      ),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    const boundValues = sqlMock.mock.calls.flatMap((call) => call.slice(1));
    expect(boundValues).not.toContain("203.0.113.10");
    expect(boundValues).toContainEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(boundValues).toContain(PERMIT_EXHIBIT_SNAPSHOT_MAX_CREATES_PER_HOUR);
  });

  it("denies when the serialized database reservation function rejects the slot", async () => {
    const sqlMock = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("DELETE FROM permit_exhibit_snapshot_attempts")) return [];
      if (query.includes("reserve_permit_exhibit_snapshot_attempt")) return [{ allowed: false }];
      throw new Error(`Unexpected query: ${query}`);
    });

    await expect(
      reservePermitExhibitSnapshotCreate(
        "203.0.113.10",
        sqlMock as unknown as SnapshotSql,
      ),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 3600 });
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the shared rate-limit store is unavailable", async () => {
    const sqlMock = vi.fn().mockRejectedValue(new Error("connection failed"));

    await expect(
      reservePermitExhibitSnapshotCreate(
        "203.0.113.10",
        sqlMock as unknown as SnapshotSql,
      ),
    ).rejects.toBeInstanceOf(PermitExhibitSnapshotStorageUnavailableError);
  });
});
