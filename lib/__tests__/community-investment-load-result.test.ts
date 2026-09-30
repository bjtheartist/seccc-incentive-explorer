import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader reads through lib/private-data.ts now (local file first, private
 * Vercel Blob second), so the seam this test mocks moved from the SYNC
 * `node:fs` pair to `node:fs/promises`' `readFile`. The four failure reasons
 * being pinned are unchanged — that is the whole point of the mock.
 *
 * `enoent()` is how "the file has never been generated" arrives at the loader:
 * an ENOENT rejection, which private-data treats as absent (and, with no blob
 * token in the test env, resolves to `{ ok: false, reason: "missing" }`).
 */
const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: { ...actual, readFile: readFileMock }, readFile: readFileMock };
});

function enoent(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

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
  readFileMock.mockReset();
  __resetCommunityInvestmentCacheForTests();
});

afterEach(() => {
  __resetCommunityInvestmentCacheForTests();
});

describe("loadCommunityInvestmentResult names the failure instead of collapsing it", () => {
  it("a file that has never been generated reports export_missing", async () => {
    readFileMock.mockRejectedValue(enoent());
    expect(await loadCommunityInvestmentResult()).toEqual({
      ok: false,
      reason: "export_missing",
      detail: expect.stringContaining("community-investment.json"),
    });
  });

  it("a file that cannot be read reports export_unreadable — NOT 'not generated yet'", async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
    const result = await loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_unreadable");
  });

  it("a truncated / malformed file reports export_invalid_json", async () => {
    readFileMock.mockResolvedValue('{"records": [');
    const result = await loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_invalid_json");
  });

  it("parseable JSON that is not the documented envelope reports export_invalid_shape", async () => {
    readFileMock.mockResolvedValue('{"records": "not an array"}');
    const result = await loadCommunityInvestmentResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("export_invalid_shape");
  });

  it("a good file loads as ok:true with its records intact", async () => {
    readFileMock.mockResolvedValue(VALID_EXPORT);
    const result = await loadCommunityInvestmentResult();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.records).toHaveLength(1);
  });

  it("caches the settled result — a failure is not re-read once per call", async () => {
    readFileMock.mockRejectedValue(enoent());
    await loadCommunityInvestmentResult();
    await loadCommunityInvestmentResult();
    await loadCommunityInvestmentResult();
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("the null-returning wrapper stays behaviour-identical for its remaining callers", () => {
  it("returns the export on success", async () => {
    readFileMock.mockResolvedValue(VALID_EXPORT);
    expect((await loadCommunityInvestment())?.records).toHaveLength(1);
  });

  it("returns null on every failure mode, exactly as before", async () => {
    readFileMock.mockResolvedValue("not json at all");
    expect(await loadCommunityInvestment()).toBeNull();
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
