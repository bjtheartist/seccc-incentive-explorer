import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { GrantsCatalog } from "./catalog";
import { GrantsStore, type Query } from "./store";
import { applicantSchema, type Member } from "./model";
import {
  catalogQuerySchema,
  catalogTiming,
  safeCatalogUrl,
} from "./catalog-model";
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const member: Member = {
  userId: "owner",
  name: "Owner",
  email: "owner@example.org",
  role: "owner",
};
const payload = (id: string) => ({
  id,
  program: {
    name: `Roof program ${id}`,
    funder: "Test funder",
    officialUrl: `https://example.org/${id}`,
    fundingSource: "public",
  },
  window: { status: "rolling", recurs: "rolling" },
  funding: { type: "grant" },
  applicants: {
    businessTypes: ["property_owner", "for_profit"],
    industriesIncluded: ["Retail"],
    operatingStage: "any",
    location: "Chicago",
  },
  uses: {
    eligible: ["building_improvements"],
    summary: "Roof repairs for buildings",
  },
  requirements: { other: "Confirm permits" },
  verification: {
    sourceUrl: `https://example.org/${id}`,
    dateChecked: "2026-09-11",
    evidence: "Test source evidence",
  },
});
describe("imported funding catalog", () => {
  let db: PGlite, sql: Query, catalog: GrantsCatalog, store: GrantsStore;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      "CREATE TABLE users(id text PRIMARY KEY,name text,email text);",
    );
    for (const f of ["catalog-schema.sql", "schema.sql", "catalog-links.sql"]) {
      const ddl = await readFile(new URL(f, import.meta.url), "utf8");
      await db.exec(ddl);
      await db.exec(ddl);
    }
    sql = async (q, p = []) =>
      (await db.query(q, p)).rows as Record<string, unknown>[];
    catalog = new GrantsCatalog(sql);
    store = new GrantsStore(sql);
    await db.query(
      "INSERT INTO users VALUES('owner','Owner','owner@example.org')",
    );
  });
  afterEach(async () => {
    await db.close();
  });
  async function insert(
    id: string,
    source = "curated",
    type = "opportunity",
    status = "rolling",
  ) {
    await db.query(
      `INSERT INTO grants_active(id,source,record_type,chicago_relevance,name,instrument,status,entity_types,geography,legitimacy,source_url,verified_at,next_review_date,match_readiness,landlord_or_tenant,operating_stage,uses_eligible,payload) VALUES($1,$2,$3,'high',$4,'grant',$5,ARRAY['property_owner','for_profit'],'Chicago','official',$6,'2026-09-11','2099-01-01','ready','owner','any',ARRAY['building_improvements'],$7::jsonb)`,
      [
        id,
        source,
        type,
        `Roof program ${id}`,
        `https://example.org/${id}`,
        status,
        JSON.stringify(payload(id)),
      ],
    );
  }
  it("paginates the imported collection and keeps completeness separate from timing", async () => {
    for (let i = 0; i < 27; i++) await insert(String(i));
    await insert("foundation", "irs_990pf", "foundation");
    const first = await catalog.list(catalogQuerySchema.parse({}));
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(28);
    const second = await catalog.list(catalogQuerySchema.parse({ page: 2 }));
    expect(second.items).toHaveLength(3);
    expect(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
    ).toBe(28);
    expect((await catalog.get("foundation")).timing).toBe("unconfirmed");
    expect(
      (
        await catalog.list(
          catalogQuerySchema.parse({ type: "foundation", timing: "current" }),
        )
      ).total,
    ).toBe(0);
    expect(
      (await catalog.list(catalogQuerySchema.parse({ q: "' OR 1=1 --" })))
        .total,
    ).toBe(0);
  });
  it("uses saved applicant answers for a bounded set of leads, preserving landlord and funding constraints", async () => {
    await insert("owner");
    await insert("operator");
    await db.query(
      "UPDATE grants_active SET entity_types=ARRAY['for_profit'],landlord_or_tenant='unknown' WHERE id='operator'",
    );
    const a = await store.save(
      "applicants",
      applicantSchema.parse({
        name: "Landlord",
        role: "landlord",
        entity: "for_profit",
        stage: "operating",
        industry: "Retail",
        costs: ["roofing"],
      }),
      member,
    );
    expect((await catalog.suggest(a.id)).items.map((i) => i.id)).toEqual([
      "owner",
    ]);
    const updated = { ...(a.data as object), fundingTypes: ["in_kind"] };
    await store.save("applicants", updated, member, a.id, a.version);
    expect((await catalog.suggest(a.id)).items).toEqual([]);
  });
  it("promotes idempotently without inventing verified windows or overwriting staff edits", async () => {
    await insert("review");
    const first = await catalog.promote("review", member),
      second = await catalog.promote("review", member);
    expect(second).toEqual(first);
    const rows = await db.query<{
      data: { review: string; closesAt: null; catalogId: string };
    }>("SELECT data FROM grants_rounds");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].data).toMatchObject({
      review: "unverified",
      closesAt: null,
      catalogId: "review",
    });
    await db.query(
      "UPDATE grants_programs SET data=jsonb_set(data,'{notes}','\"Staff notes\"') WHERE id=$1",
      [first.programId],
    );
    await catalog.promote("review", member);
    expect(
      (
        await db.query<{ notes: string }>(
          "SELECT data->>'notes' AS notes FROM grants_programs",
        )
      ).rows[0].notes,
    ).toBe("Staff notes");
  });
  it("withdraws verification when an imported source changes, preserving the staff evidence", async () => {
    await insert("change");
    const link = await catalog.promote("change", member);
    await db.query(
      "UPDATE grants_rounds SET data=jsonb_set(data,'{review}','\"verified\"') WHERE id=$1",
      [link.roundId],
    );
    const before = await db.query<{
      data: Record<string, unknown>;
      version: number;
    }>("SELECT data,version FROM grants_rounds WHERE id=$1", [link.roundId]);
    await db.query(
      "UPDATE grants_active SET payload=jsonb_set(payload,'{notes}','\"Changed requirements\"') WHERE id='change'",
    );
    const after = await db.query<{
      data: Record<string, unknown>;
      version: number;
    }>("SELECT data,version FROM grants_rounds WHERE id=$1", [link.roundId]);
    expect(after.rows[0].data.review).toBe("unverified");
    expect(after.rows[0].data.evidence).toBe(before.rows[0].data.evidence);
    expect(after.rows[0].version).toBe(before.rows[0].version + 1);
    await db.query(
      "UPDATE grants_active SET payload=payload WHERE id='change'",
    );
    expect(
      (
        await db.query<{ version: number }>(
          "SELECT version FROM grants_rounds WHERE id=$1",
          [link.roundId],
        )
      ).rows[0].version,
    ).toBe(after.rows[0].version);
  });
});
describe("catalog source boundaries", () => {
  it("does not turn a foundation filing, standing program or expired source into a current round", () => {
    const base = {
      recordType: "opportunity",
      sourceStatus: "rolling",
      deadline: null,
      opensAt: null,
      checkedAt: "2026-09-11",
      reviewAt: "2026-10-11",
    };
    expect(catalogTiming(base, "2026-09-11")).toBe("current");
    expect(
      catalogTiming({ ...base, recordType: "foundation" }, "2026-09-11"),
    ).toBe("unconfirmed");
    expect(
      catalogTiming({ ...base, recordType: "standing_program" }, "2026-09-11"),
    ).toBe("unconfirmed");
    expect(
      catalogTiming({ ...base, reviewAt: "2026-09-10" }, "2026-09-11"),
    ).toBe("unconfirmed");
    expect(
      catalogTiming({ ...base, deadline: "2026-09-10" }, "2026-09-11"),
    ).toBe("closed");
  });
  it("rejects malformed links, credentials, scripts and unbounded pages", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://first.org https://second.org",
      "https://user:secret@example.org",
      "http://example.org",
    ])
      expect(safeCatalogUrl(url)).toBeNull();
    expect(catalogQuerySchema.safeParse({ page: 2001 }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ source: "' OR true" }).success).toBe(
      false,
    );
  });
});
