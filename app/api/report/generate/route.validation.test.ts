import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_WIZARD_STATE } from "@/lib/report-wizard-config";
import {
  GenerateReportRequestSchema,
  MAX_GENERATE_BODY_BYTES,
} from "@/lib/report-request-schemas";

/**
 * R2 finding 2 — POST /api/report/generate accepted anything.
 *
 * It checked `isPlainObject(body.state)` and then CAST:
 *
 *     const state = body.state as unknown as WizardState;
 *     const ctx = (isPlainObject(body.ctx) ? body.ctx : {}) as ReportContext;
 *
 * so `{ state: { projectGoals: 5 } }` reached `generateReportData` and blew up
 * deep in the engine as a 500. `await request.json()` buffered and parsed a
 * body of any size. And the most expensive endpoint in the app — it runs the
 * whole report engine against the full internal catalog on every call — had no
 * rate limit at all.
 *
 * The binding constraint on the fix: app/report/page.tsx is outside this
 * round's fence and cannot be edited, so validation must accept everything
 * that page legitimately sends today. The first block below is the test that
 * matters most — if it fails, the validation is too strict, not the client.
 */

const { reserveMock } = vi.hoisted(() => ({ reserveMock: vi.fn() }));

vi.mock("@/lib/report-generate-rate-limit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/report-generate-rate-limit")
  >("@/lib/report-generate-rate-limit");
  return {
    ...actual,
    reserveReportGeneration: reserveMock,
    reportGenerateClientIdentifier: actual.reportGenerateClientIdentifier,
  };
});

import { POST } from "./route";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/report/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  reserveMock.mockReset().mockResolvedValue({ allowed: true, degraded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The exact shape app/report/page.tsx sends: a full WizardState, and a
 * ReportContext carrying every field the page populates from its own API
 * routes. Built from the REAL INITIAL_WIZARD_STATE so a field added to the
 * wizard shows up here rather than being quietly untested.
 */
const REAL_CLIENT_PAYLOAD = {
  state: {
    ...INITIAL_WIZARD_STATE,
    reportType: "site-incentives",
    address: "9300 S Drexel Ave, Chicago, IL 60619",
    lat: 41.7251,
    lon: -87.5943,
    neighborhood: "Chatham",
    industry: "Manufacturing",
    budgetRange: "500k-1m",
    projectGoals: ["expansion", "rehab"],
    projectType: "expansion",
    proposedUse: "Light assembly and warehousing",
    fundingCommitted: "250000",
    remainingGap: "400000",
    timeline: "6-12-months",
    siteControl: "under-contract",
    documentsAvailable: ["lease", "tax-bill"],
    jobsImpact: "12",
    supportNeeded: ["financing", "permits"],
    creditsToAnalyze: ["tif", "sbif"],
  },
  ctx: {
    zones: { tif: true, sbif: true, oz: false },
    zoneNames: { tif: "Chatham Ridge TIF" },
    unknownZones: ["nmtc"],
    zoneCheckedAt: "2026-09-01T12:00:00.000Z",
    census: { tract: "17031430300", medianIncome: 41000, population: 3100 },
    cityZoning: { zoneClass: "M1-2", vintage: { mirrors: [] } },
    parcel: {
      pin: "20123456789012",
      address: "9300 S DREXEL AVE",
      addressMatch: "verified",
      classCode: "5-17",
      classDescription: "Commercial building",
      landSqft: 10_000,
      bldgSqft: 7_500,
      isCommercial: true,
      isIndustrial: false,
      isVacant: false,
      checkedAt: "2026-09-01T12:00:00.000Z",
    },
    districts: { ward: 8, alderman: "Test Alderman" },
    stackingRules: [{ id: "s1", programId: "a", otherProgramId: "b", relationship: "can" }],
    communityAssets: [{ name: "Chatham Business Association", type: "bso" }],
    localBusinessSupport: { communityArea: "Chatham", organizations: [] },
    stats: { programCount: 71 },
    corridorMetrics: { vacancyRate: 0.12 },
    reportZip: "60619",
    corridorOwnerClusters: [{ key: "cluster-1", parcels: 4 }],
    neighborhoodEconomics: { medianRent: 1200 },
    siteSignals: { permitsLast5Years: 3 },
    transport: { nearestRail: "95th/Dan Ryan" },
    mobilityAccess: { transitScore: 62 },
    // `locationContext` is deliberately omitted: the client either sends a
    // complete one or none, and the engine builds its own when absent
    // (`ctx.locationContext ?? buildLocationContext(...)`). A half-built one
    // is not a shape any client produces.
  },
};

/**
 * The same rich `state`, with a `ctx` trimmed to members the report engine can
 * fully consume. REAL_CLIENT_PAYLOAD's job is to prove the SCHEMA accepts every
 * ctx member a client populates; this one's job is to run the engine. They are
 * separate because the engine expects each nested ctx structure to be complete
 * (a `parcel` without `classCode`, a half-built `locationContext`), and those
 * interiors are the engine's contract, not this schema's — see
 * lib/report-request-schemas.ts on why ctx is validated by container kind.
 */
const ENGINE_SAFE_PAYLOAD = {
  state: REAL_CLIENT_PAYLOAD.state,
  ctx: {
    zones: REAL_CLIENT_PAYLOAD.ctx.zones,
    zoneNames: REAL_CLIENT_PAYLOAD.ctx.zoneNames,
    reportZip: REAL_CLIENT_PAYLOAD.ctx.reportZip,
    localBusinessSupport: REAL_CLIENT_PAYLOAD.ctx.localBusinessSupport,
  },
};

describe("the REAL client payload still passes — the constraint on this whole fix", () => {
  it("validates against the schema unchanged", () => {
    const parsed = GenerateReportRequestSchema.safeParse(REAL_CLIENT_PAYLOAD);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.[0])).toBe(true);
  });

  it("generates a real report end to end", async () => {
    const res = await POST(post(ENGINE_SAFE_PAYLOAD) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections.length).toBeGreaterThan(0);
  });

  it("preserves EVERY key the client sent — validation must not strip context", () => {
    const parsed = GenerateReportRequestSchema.parse(REAL_CLIENT_PAYLOAD);
    expect(Object.keys(parsed.state).sort()).toEqual(
      Object.keys(REAL_CLIENT_PAYLOAD.state).sort(),
    );
    expect(Object.keys(parsed.ctx!).sort()).toEqual(Object.keys(REAL_CLIENT_PAYLOAD.ctx).sort());
  });

  it("passes through a field the client adds later rather than dropping it", () => {
    const parsed = GenerateReportRequestSchema.parse({
      state: { ...INITIAL_WIZARD_STATE, someFutureField: "kept" },
      ctx: { someFutureContext: { nested: true } },
    });
    expect((parsed.state as Record<string, unknown>).someFutureField).toBe("kept");
    expect((parsed.ctx as Record<string, unknown>).someFutureContext).toEqual({ nested: true });
  });

  it("accepts a bare INITIAL_WIZARD_STATE with no ctx at all", async () => {
    const res = await POST(post({ state: INITIAL_WIZARD_STATE }) as never);
    expect(res.status).toBe(200);
  });
});

describe("wrong shapes are rejected with 400, not a 500 from deep in the engine", () => {
  it.each([
    ["projectGoals as a number", { projectGoals: 5 }],
    ["lat as a string", { lat: "41.75" }],
    ["reportType as an object", { reportType: { evil: true } }],
    ["address as an array", { address: ["a", "b"] }],
    ["documentsAvailable containing objects", { documentsAvailable: [{ a: 1 }] }],
  ])("rejects %s", async (_label, override) => {
    const res = await POST(
      post({ state: { ...INITIAL_WIZARD_STATE, ...override } }) as never,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid request body" });
  });

  /**
   * JSON has no Infinity literal, but `1e999` PARSES to Infinity — a
   * coordinate that is a number, is not NaN, and poisons every arithmetic
   * comparison downstream. `.finite()` is what catches it.
   */
  it("rejects a coordinate that JSON.parse turns into Infinity", async () => {
    const res = await POST(post('{"state":{"lat":1e999,"lon":-87.6}}') as never);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("lat");
  });

  it("rejects ctx members of the wrong container kind", async () => {
    const res = await POST(
      post({ state: INITIAL_WIZARD_STATE, ctx: { stackingRules: "not an array" } }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("still rejects a missing state with 400", async () => {
    const res = await POST(post({ ctx: {} }) as never);
    expect(res.status).toBe(400);
  });

  it("still rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not json") as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid JSON body" });
  });

  it("names the offending field so the failure is diagnosable", async () => {
    const res = await POST(post({ state: { projectGoals: 5 } }) as never);
    const body = await res.json();
    expect(body.detail).toContain("projectGoals");
  });

  it("never reaches the rate limiter on a malformed body", async () => {
    await POST(post({ state: { lat: "nope" } }) as never);
    expect(reserveMock).not.toHaveBeenCalled();
  });
});

describe("absurd sizes are rejected", () => {
  it("rejects an oversized body with 413", async () => {
    const huge = "x".repeat(MAX_GENERATE_BODY_BYTES + 100);
    const res = await POST(
      post({ state: { ...INITIAL_WIZARD_STATE, address: huge } }) as never,
    );
    expect(res.status).toBe(413);
  });

  it("rejects on a declared Content-Length above the ceiling", async () => {
    const res = await POST(
      post({ state: INITIAL_WIZARD_STATE }, {
        "content-length": String(MAX_GENERATE_BODY_BYTES + 1),
      }) as never,
    );
    expect(res.status).toBe(413);
  });

  it("caps an individual free-text field well below the body ceiling", async () => {
    const res = await POST(
      post({ state: { ...INITIAL_WIZARD_STATE, address: "x".repeat(5000) } }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("caps array counts in ctx", async () => {
    const res = await POST(
      post({
        state: INITIAL_WIZARD_STATE,
        ctx: { stackingRules: Array.from({ length: 5000 }, () => ({})) },
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After when the limiter refuses", async () => {
    reserveMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });
    const res = await POST(post({ state: INITIAL_WIZARD_STATE }) as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/too many/i) });
  });

  it("identifies the client by forwarded IP", async () => {
    await POST(
      post({ state: INITIAL_WIZARD_STATE }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) as never,
    );
    expect(reserveMock).toHaveBeenCalledWith("203.0.113.7");
  });

  it("consults the limiter exactly once per valid request", async () => {
    await POST(post({ state: INITIAL_WIZARD_STATE }) as never);
    expect(reserveMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The deliberate difference from /api/email-report, which 503s when its
   * storage is down. Report generation needs no database — refusing to
   * generate reports because the limiter's table is unreachable would turn a
   * degraded dependency into an outage of the app's core feature.
   */
  it("still generates the report when the limiter is degraded (fails OPEN)", async () => {
    reserveMock.mockResolvedValue({ allowed: true, degraded: true });
    const res = await POST(post(ENGINE_SAFE_PAYLOAD) as never);
    expect(res.status).toBe(200);
  });
});
