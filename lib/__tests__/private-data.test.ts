import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/private-data.ts is the single read path for data/private/*.json, and the
 * whole point of it is the FALLBACK: the file is on disk in dev, in the test
 * suite and in CI, and is NOT in the deployed function bundle (next.config.ts
 * excludes `./data/private/**` — that exclusion is what took ~48MB out of every
 * deployment), so production resolves the same bytes out of a private Vercel
 * Blob using the committed data/private-manifest.json.
 *
 * Both seams are mocked here, because the difference between them is invisible
 * locally: on this machine the local branch always wins, so a broken blob branch
 * would ship green. The three cases below are exactly the three states a
 * deployed function can be in.
 */

const { readFileMock, getMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: { ...actual, readFile: readFileMock }, readFile: readFileMock };
});

vi.mock("@vercel/blob", () => ({ get: getMock }));

import { __resetPrivateDataCacheForTests, loadPrivateJson, readPrivateText } from "../private-data";

/** A filename that data/private-manifest.json really names, so the blob branch
 * exercises a real pathname lookup rather than a fixture-only one. */
const FILENAME = "tif-briefs.json";

function enoent(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

/** What `get(pathname, { access: "private" })` resolves to on a hit. */
function blobHit(text: string) {
  return {
    statusCode: 200 as const,
    stream: new Response(text).body,
    headers: new Headers(),
    blob: { pathname: FILENAME, contentType: "application/json", size: text.length },
  };
}

beforeEach(() => {
  readFileMock.mockReset();
  getMock.mockReset();
  __resetPrivateDataCacheForTests();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_TEST");
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetPrivateDataCacheForTests();
});

describe("loadPrivateJson", () => {
  it("reads the LOCAL file when it is on disk, and never touches the blob store", async () => {
    readFileMock.mockResolvedValue('{"districts": [], "zips": {}}');

    await expect(loadPrivateJson(FILENAME)).resolves.toEqual({ districts: [], zips: {} });
    expect(getMock).not.toHaveBeenCalled();
    // The path is assembled from segments + the parameter, never a static
    // string literal that output-file tracing could follow back into the bundle.
    expect(readFileMock.mock.calls[0][0]).toMatch(/data[/\\]private[/\\]tif-briefs\.json$/);
  });

  it("falls back to the PRIVATE blob when the local file is absent — the production path", async () => {
    readFileMock.mockRejectedValue(enoent());
    getMock.mockResolvedValue(blobHit('{"districts": ["T-1"], "zips": {}}'));

    await expect(loadPrivateJson(FILENAME)).resolves.toEqual({ districts: ["T-1"], zips: {} });

    // Fetched by the CONTENT-ADDRESSED pathname the committed manifest names,
    // with private access — a public read would defeat the gating that
    // data/private/README.md exists to enforce.
    const [pathname, options] = getMock.mock.calls[0];
    expect(pathname).toMatch(/^private-data\/[0-9a-f]{16}\/tif-briefs\.json$/);
    expect(options).toMatchObject({ access: "private" });
  });

  it("returns null when the file is absent locally AND missing from the blob store", async () => {
    readFileMock.mockRejectedValue(enoent());
    getMock.mockResolvedValue(null);

    // null, not a throw: every caller's existing "the export has not been
    // generated yet" fallback depends on this.
    await expect(loadPrivateJson(FILENAME)).resolves.toBeNull();
  });

  it("returns null when the blob read throws", async () => {
    readFileMock.mockRejectedValue(enoent());
    getMock.mockRejectedValue(new Error("BlobNotFoundError"));

    await expect(loadPrivateJson(FILENAME)).resolves.toBeNull();
  });

  it("returns null when the resolved body is not JSON", async () => {
    readFileMock.mockResolvedValue("<html>not json</html>");

    await expect(loadPrivateJson(FILENAME)).resolves.toBeNull();
  });

  it("memoizes per filename — a warm function reads once, not once per caller", async () => {
    readFileMock.mockResolvedValue('{"districts": [], "zips": {}}');

    await Promise.all([loadPrivateJson(FILENAME), loadPrivateJson(FILENAME)]);
    await loadPrivateJson(FILENAME);

    expect(readFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("readPrivateText keeps MISSING and UNREADABLE apart", () => {
  it("reports missing when neither disk nor blob has it", async () => {
    readFileMock.mockRejectedValue(enoent());
    getMock.mockResolvedValue(null);

    await expect(readPrivateText(FILENAME)).resolves.toEqual({ ok: false, reason: "missing" });
  });

  it("reports unreadable when the local read fails for a reason other than absence", async () => {
    readFileMock.mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );
    getMock.mockResolvedValue(null);

    const result = await readPrivateText(FILENAME);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreadable");
  });

  it("names which source answered", async () => {
    readFileMock.mockResolvedValue("{}");
    await expect(readPrivateText(FILENAME)).resolves.toMatchObject({ ok: true, source: "local" });

    __resetPrivateDataCacheForTests();
    readFileMock.mockRejectedValue(enoent());
    getMock.mockResolvedValue(blobHit("{}"));
    await expect(readPrivateText(FILENAME)).resolves.toMatchObject({ ok: true, source: "blob" });
  });

  it("does not attempt a blob read with no token configured", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    readFileMock.mockRejectedValue(enoent());

    await expect(readPrivateText(FILENAME)).resolves.toEqual({ ok: false, reason: "missing" });
    expect(getMock).not.toHaveBeenCalled();
  });
});
