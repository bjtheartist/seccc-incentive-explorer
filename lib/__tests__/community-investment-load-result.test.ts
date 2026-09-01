import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: existsSyncMock, readFileSync: readFileSyncMock };
});

import {
  COMMUNITY_INVESTMENT_UNAVAILABLE_COPY,
  __resetCommunityInvestmentCacheForTests,
  loadCommunityInvestment,
  loadCommunityInvestmentResult,
} from "../community-investment";

/**
 * R1 finding 4 — the false-claims class, community-investment loader.
 *
 * `loadCommunityInvestment` returned a bare `null` for a missing file, an
 * unreadable file, malformed JSON, and a wrong-shaped envelope alike. Every
 * /investment surface then rendered the SAME sentence for all of them: "No
 * grants, awards, or development have been recorded in <area> since 2020 in
 * this dataset." That is an authoritative negative finding about a real
 * neighbourhood, produced by a file the app never managed to read.
 *
 * Modelled on lib/shortlist-universe.ts's fail-closed result — the house
 * style — the loader now names WHY.
 */

const VALID_EXPORT = JSON.stringify({
  generatedAt: "2026-01-01T00:00:00.000Z",
  records: [{ id: "r1", source: "tif", communityArea: "South Shore" }],
  meta: { sources: ["fixture"] },
});

beforeEach(() => {
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
  __resetCommunityInvestmentCacheForTests();
});

afterEach(() => {
  __resetCommunityInvestmentCacheForTests();
});

describe("loadCommunityInvestmentResult names the failure instead of collapsing it", () => {
  it("a file that has never been generated reports export_missing", () => {
    existsSyncMock.mockReturnValue(false);
    expect(loadCommunityInvestmentResult()).toEqual({
      ok: false,
      reason: "export_missing",
      detail: expect.stringContaining("community-investment.json"),
    });
  });

  it("a file that cannot be read reports export_unreadable — NOT 'not generated yet'", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const result = loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_unreadable");
  });

  it("a truncated / malformed file reports export_invalid_json", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('{"records": [');
    const result = loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_invalid_json");
  });

  it("parseable JSON that is not the documented envelope reports export_invalid_shape", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('{"records": "not an array"}');
    const result = loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_invalid_shape");
  });

  it("a good file loads as ok:true with its records intact", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(VALID_EXPORT);
    const result = loadCommunityInvestmentResult();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.records).toHaveLength(1);
  });

  it("caches the settled result — a failure is not re-read once per call", () => {
    existsSyncMock.mockReturnValue(false);
    loadCommunityInvestmentResult();
    loadCommunityInvestmentResult();
    loadCommunityInvestmentResult();
    expect(existsSyncMock).toHaveBeenCalledTimes(1);
  });
});

describe("the null-returning wrapper stays behaviour-identical for its remaining callers", () => {
  it("returns the export on success", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(VALID_EXPORT);
    expect(loadCommunityInvestment()?.records).toHaveLength(1);
  });

  it("returns null on every failure mode, exactly as before", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("not json at all");
    expect(loadCommunityInvestment()).toBeNull();
  });
});

describe("the shipped unavailability copy is honest", () => {
  it("states a loading problem and explicitly disclaims being a finding", () => {
    expect(COMMUNITY_INVESTMENT_UNAVAILABLE_COPY).toContain("could not be loaded");
    expect(COMMUNITY_INVESTMENT_UNAVAILABLE_COPY).toContain(
      "not a finding about this community",
    );
  });

  it("never asserts an absence and is never eligibility-shaped", () => {
    expect(COMMUNITY_INVESTMENT_UNAVAILABLE_COPY).not.toMatch(
      /no grants|have been recorded|none recorded/i,
    );
    expect(COMMUNITY_INVESTMENT_UNAVAILABLE_COPY).not.toMatch(/eligib|qualif|you may receive/i);
  });
});
