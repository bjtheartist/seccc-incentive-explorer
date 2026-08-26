import { describe, expect, it } from "vitest";
import {
  FULL_ARCHIVE_SIZE_THRESHOLD_BYTES,
  decideArchiveMode,
} from "../archive-zoning-snapshot";

describe("decideArchiveMode", () => {
  it("chooses full at and under the 5 MB threshold", () => {
    expect(decideArchiveMode(0)).toBe("full");
    expect(decideArchiveMode(1)).toBe("full");
    expect(decideArchiveMode(FULL_ARCHIVE_SIZE_THRESHOLD_BYTES - 1)).toBe("full");
    expect(decideArchiveMode(FULL_ARCHIVE_SIZE_THRESHOLD_BYTES)).toBe("full");
  });

  it("chooses hash_manifest strictly over the threshold", () => {
    expect(decideArchiveMode(FULL_ARCHIVE_SIZE_THRESHOLD_BYTES + 1)).toBe("hash_manifest");
  });

  it("matches the real, currently-committed zoning snapshot's measured size (~8.98 MB, well over 5 MB)", () => {
    // Verified live in this repo 2026-08-25/26: the citywide zoning-map-
    // snapshot.json is attribute/geometry-FINGERPRINT-only (not full
    // geometry) and is already ~8.98 MB. This pins the CONSEQUENCE of that
    // fact — the script must choose hash_manifest today, not "full" — so a
    // future change to the threshold constant or the branch order cannot
    // silently start committing multi-megabyte blobs to git history.
    const measuredSizeBytes = 8_977_167;
    expect(decideArchiveMode(measuredSizeBytes)).toBe("hash_manifest");
  });

  it("the threshold itself is exactly 5 MB, per spec", () => {
    expect(FULL_ARCHIVE_SIZE_THRESHOLD_BYTES).toBe(5 * 1024 * 1024);
  });
});
