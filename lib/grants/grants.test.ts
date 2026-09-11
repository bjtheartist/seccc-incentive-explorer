import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { GrantsStore, type Query } from "./store";
import {
  applicantSchema,
  programSchema,
  roundSchema,
  sourceSchema,
  roundState,
  screenMatch,
  matchNeedsReview,
  type Member,
  type Round,
  type Applicant,
} from "./model";
import { canonicalUrl, parseSource, publicIPv4 } from "./fetch-source";
import { scanSources } from "./scanner";
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const owner: Member = {
  userId: "owner",
  name: "Owner",
  email: "owner@example.org",
  role: "owner",
};
const p = programSchema.parse({
  name: "Test program",
  sponsor: "Funder",
  sponsorType: "public",
  fundingType: "reimbursement",
  cadence: "hybrid",
  sourceUrl: "https://example.org/grants",
});
const r = () =>
  roundSchema.parse({
    programId: "program",
    name: "2026 round",
    availability: "open",
    closesAt: "2026-12-01T23:59:00-06:00",
    evidenceUrl: "https://example.org/rules",
    review: "verified",
    evidence: "Sponsor rules checked",
    verifiedAt: "2026-09-10T12:00:00Z",
    nextReviewAt: "2026-10-01T12:00:00Z",
    rules: {
      roles: ["operator"],
      entities: ["for_profit"],
      stages: ["operating"],
      geography: ["Chicago"],
      costs: ["roofing"],
    },
  });
const a = () =>
  applicantSchema.parse({
    name: "Test business",
    role: "operator",
    entity: "for_profit",
    stage: "operating",
    geography: ["Chicago"],
    costs: ["roofing"],
    factsSource: "Owner intake confirmed",
  });
const now = new Date("2026-09-11T12:00:00Z");
describe("grant timing and screening", () => {
  it("closes past rounds even when the recurring program persists", () =>
    expect(roundState({ ...r(), closesAt: "2026-09-01T12:00:00Z" }, now)).toBe(
      "closed",
    ));
  it("does not mistake an unreviewed or stale date for an open application", () => {
    expect(roundState({ ...r(), review: "unverified" }, now)).toBe(
      "unverified",
    );
    expect(
      roundState({ ...r(), nextReviewAt: "2026-09-11T11:00:00Z" }, now),
    ).toBe("unverified");
  });
  it("preserves unknown startup and entity information", () =>
    expect(
      screenMatch({ ...a(), stage: "unknown", entity: "unknown" }, r(), now)
        .result,
    ).toBe("needs_information"));
  it("rules a landlord out of operator-only opportunities", () =>
    expect(
      screenMatch({ ...a(), role: "landlord" }, r(), now).exclusions,
    ).toContain("Applicant role: does not match recorded criteria"));
  it("does not invent criteria when the rules are empty", () =>
    expect(
      screenMatch(a(), { ...r(), rules: { ...r().rules, roles: [] } }, now)
        .result,
    ).toBe("needs_information"));
  it("does not treat a missing zone tag as proof of geographic ineligibility", () => {
    const result = screenMatch(
      a(),
      { ...r(), rules: { ...r().rules, geography: ["Eligible corridor"] } },
      now,
    );
    expect(result.result).toBe("needs_information");
    expect(result.exclusions).toEqual([]);
  });
  it("requires evidence and date order to verify a round", () => {
    expect(roundSchema.safeParse({ ...r(), evidence: "" }).success).toBe(false);
    expect(
      roundSchema.safeParse({ ...r(), opensAt: "2027-01-01T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(roundSchema.safeParse({ ...r(), closesAt: null }).success).toBe(
      false,
    );
  });
});
describe("source parsing and network boundary", () => {
  it("rejects internal, metadata, private, multicast, and IPv6 destinations", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
    ])
      expect(publicIPv4(ip)).toBe(false);
    expect(publicIPv4("93.184.216.34")).toBe(true);
  });
  it("canonicalizes tracking-only duplicates", () =>
    expect(canonicalUrl("https://example.org/grant/?utm_source=x#apply")).toBe(
      "https://example.org/grant",
    ));
  it("extracts funding leads, removes executable text, and leaves dates unverified", () => {
    const parsed = parseSource(
      `<html><head><title>Funding</title></head><body><main>${"Official funding opportunities for community businesses. ".repeat(3)}<a href='/grants/new?utm_source=test'>New grant application</a><a href='javascript:alert(1)'>Apply now</a><script>stealSecrets()</script></main></body></html>`,
      "https://example.org",
    );
    expect(parsed.links).toEqual([
      { url: "https://example.org/grants/new", title: "New grant application" },
    ]);
    expect(parsed.text).not.toContain("stealSecrets");
  });
});
describe("shared Postgres persistence", () => {
  let db: PGlite, sql: Query, store: GrantsStore;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      "CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT);",
    );
    const ddl = await readFile(
      new URL("./schema.sql", import.meta.url),
      "utf8",
    );
    await db.exec(ddl);
    await db.exec(ddl); // migration is repeatable
    sql = async (q, p = []) =>
      (await db.query(q, p)).rows as Record<string, unknown>[];
    store = new GrantsStore(sql);
    await db.query(
      "INSERT INTO users VALUES('owner','Owner','owner@example.org')",
    );
  }, 20000);
  afterEach(async () => {
    await db.close();
  });
  it("shares records, preserves history, and rejects a lost update", async () => {
    const created = await store.save("programs", p, owner);
    const other = new GrantsStore(sql);
    const first = await other.get("programs", created.id);
    await store.save(
      "programs",
      { ...p, name: "Reviewed name" },
      owner,
      created.id,
      1,
    );
    await expect(
      other.save(
        "programs",
        { ...p, name: "Stale edit" },
        owner,
        created.id,
        first.version,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await db.query(
          "SELECT before_data,after_data FROM grants_activity ORDER BY id",
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (await other.get<{ name: string }>("programs", created.id)).data.name,
    ).toBe("Reviewed name");
  });
  it("enforces program and round relationships and duplicate URLs", async () => {
    await expect(store.save("rounds", r(), owner)).rejects.toMatchObject({
      code: "23503",
    });
    await store.save("programs", p, owner);
    await expect(store.save("programs", p, owner)).rejects.toMatchObject({
      code: "23505",
    });
  });
  it("invalidates match reviews after applicant or round changes", async () => {
    const pr = await store.save("programs", p, owner),
      ar = await store.save("applicants", a(), owner);
    const rr = await store.save("rounds", { ...r(), programId: pr.id }, owner);
    const m = {
      applicantId: ar.id,
      roundId: rr.id,
      roundVersion: 1,
      applicantVersion: 1,
      status: "candidate",
      rationale: "Recorded fit",
      questions: "",
      nextAction: "Review requirements",
    };
    await store.save("matches", m, owner);
    await store.save(
      "applicants",
      { ...a(), role: "landlord" },
      owner,
      ar.id,
      1,
    );
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT data->>'status' AS status FROM grants_matches",
        )
      ).rows[0].status,
    ).toBe("needs_information");
    await expect(store.save("matches", m, owner)).rejects.toMatchObject({
      status: 409,
    });
    const current = await store.get<Applicant>("applicants", ar.id);
    expect(matchNeedsReview(m as never, current, rr as never, now)).toBe(true);
  });
  it("scans idempotently, detects changes, and withdraws stale verification", async () => {
    const pr = await store.save("programs", p, owner);
    const rr = await store.save("rounds", { ...r(), programId: pr.id }, owner);
    const sr = await store.save(
      "sources",
      sourceSchema.parse({
        name: "Funding list",
        url: "https://example.org",
        kind: "directory",
        programId: pr.id,
      }),
      owner,
    );
    const fetcher = vi.fn(async () => ({
      url: "https://example.org",
      html: `<title>Grants</title><main>${"A funding opportunity with official rules for applicants. ".repeat(5)}<a href='/new-grant'>Apply for new grant</a></main>`,
    }));
    const first = await scanSources(sql, fetcher);
    expect(first.scanned).toBe(1);
    expect((await store.get<Round>("rounds", rr.id)).data.review).toBe(
      "unverified",
    );
    expect((await db.query("SELECT * FROM grants_findings")).rows).toHaveLength(
      2,
    );
    await db.query("UPDATE grants_sources SET next_scan_at=now() WHERE id=$1", [
      sr.id,
    ]);
    const second = await scanSources(sql, fetcher);
    expect(second.results[0].status).toBe("unchanged");
    expect(
      (await db.query("SELECT * FROM grants_snapshots")).rows,
    ).toHaveLength(1);
    expect((await scanSources(sql, fetcher)).scanned).toBe(0);
  });
  it("retains failed-source health without inventing findings", async () => {
    await store.save(
      "sources",
      { name: "Blocked", url: "https://example.org", kind: "directory" },
      owner,
    );
    await scanSources(sql, async () => {
      throw new Error("Source returned HTTP 403");
    });
    expect(
      (
        await db.query<{ last_status: string }>(
          "SELECT last_status FROM grants_sources",
        )
      ).rows[0].last_status,
    ).toBe("error");
    expect((await db.query("SELECT * FROM grants_findings")).rows).toHaveLength(
      0,
    );
  });
});
