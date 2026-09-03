import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectManifestProblems } from "../verify-investment-manifest";
import type { InvestmentManifest } from "../lib/investment-manifest";

/**
 * The CI gate behind `npm run data:manifest:verify`. Each of its three failure
 * modes — a stale contentHash, a declared file missing from disk, an exporter
 * read of an undeclared file — is exercised here against a TEMP input dir and
 * a SYNTHETIC manifest + exporter source, never the real committed data (the
 * real data is clean, so it cannot exhibit any of them; the clean case below
 * is what covers that shape). Same harness idea as
 * scripts/__tests__/investment-manifest-verification.test.ts, plus real files
 * on disk, since this gate's whole job is comparing the manifest TO disk.
 */

const TIF_BYTES = "id,authorized_tif_assistance\n1,1000\n";
const CARES_BYTES = "id,historical_authorized_usd\n1,50\n";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** An exporter that reads exactly the two fixture files by hard-coded literal. */
const CLEAN_EXPORTER_SOURCE = `
  // A DO_NOT_EXPORT file named only in a COMMENT must never count as a read:
  // fixture_quarantined_DO_NOT_EXPORT.csv
  const tifRows = readCsv("tif_projects.csv").filter((r) => r.dataset === "annual-report");
  const caresRows = readCsv("chicago_cares_program_ledger.csv");
  const nofSmall = JSON.parse(verifiedRead(manifestFile("chicago-cares"))) as SocrataRow[];
`;

describe("investment manifest verify gate (npm run data:manifest:verify)", () => {
  let inputDir: string;

  function manifest(): InvestmentManifest {
    return {
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      note: "fixture",
      sources: [
        {
          id: "tif",
          file: "tif_projects.csv",
          label: "Fixture TIF",
          cadence: "monthly",
          refreshMethod: "n/a",
          valueField: "authorized_tif_assistance",
          decreasePolicy: "monotonic_floor",
          vintage: "2026-01-01",
          contentHash: sha256(TIF_BYTES),
        },
        {
          id: "chicago-cares",
          file: "chicago_cares_program_ledger.csv",
          label: "Fixture CARES ledger",
          cadence: "monthly",
          refreshMethod: "n/a",
          valueField: "historical_authorized_usd",
          decreasePolicy: "monotonic_floor",
          vintage: "2026-01-01",
          contentHash: sha256(CARES_BYTES),
        },
      ],
    };
  }

  beforeEach(() => {
    inputDir = mkdtempSync(join(tmpdir(), "manifest-verify-gate-"));
    writeFileSync(join(inputDir, "tif_projects.csv"), TIF_BYTES);
    writeFileSync(join(inputDir, "chicago_cares_program_ledger.csv"), CARES_BYTES);
  });

  afterEach(() => {
    rmSync(inputDir, { recursive: true, force: true });
  });

  it("reports NO problems when every declared hash matches disk and every exporter read is declared", () => {
    expect(
      collectManifestProblems({ manifest: manifest(), inputDir, exporterSource: CLEAN_EXPORTER_SOURCE }),
    ).toEqual([]);
  });

  it("(a) fails on a committed contentHash that no longer matches the file on disk", () => {
    // The 2026-09-02 shape exactly: the input is rewritten by a refresh, the
    // manifest still pins the pre-refresh bytes.
    writeFileSync(join(inputDir, "tif_projects.csv"), "id,authorized_tif_assistance\n1,2000\n");

    const problems = collectManifestProblems({
      manifest: manifest(),
      inputDir,
      exporterSource: CLEAN_EXPORTER_SOURCE,
    });

    expect(problems.map((p) => [p.kind, p.subject])).toEqual([["hash-mismatch", "tif_projects.csv"]]);
    expect(problems[0].message).toMatch(/ACTUAL bytes at read time/);
    // The untouched sibling must NOT be dragged in — the message is per file.
    expect(problems[0].message).not.toMatch(/chicago_cares_program_ledger\.csv/);
  });

  it("(b) fails on a manifest-declared file that is missing from the input dir", () => {
    rmSync(join(inputDir, "chicago_cares_program_ledger.csv"));

    const problems = collectManifestProblems({
      manifest: manifest(),
      inputDir,
      exporterSource: CLEAN_EXPORTER_SOURCE,
    });

    expect(problems.map((p) => [p.kind, p.subject])).toEqual([
      ["missing-file", "chicago_cares_program_ledger.csv"],
    ]);
    expect(problems[0].message).toMatch(/MISSING from/);
  });

  it("(b) does NOT fail on a declared file that is absent by design (empty contentHash, e.g. refresh-attempt.json)", () => {
    const m = manifest();
    m.sources.push({
      id: "refresh-attempt",
      file: "refresh-attempt.json",
      label: "Failure-only artifact — absent when healthy",
      cadence: "manual",
      refreshMethod: "written automatically on a failed refresh",
      valueField: null,
      decreasePolicy: "not_refreshed",
      vintage: "2026-01-01",
      contentHash: "",
    });

    expect(collectManifestProblems({ manifest: m, inputDir, exporterSource: CLEAN_EXPORTER_SOURCE })).toEqual(
      [],
    );
  });

  it("(c) fails when the exporter reads a file in the input dir that the manifest does not declare", () => {
    const undeclared = "corporate_direct_awards.csv";
    writeFileSync(join(inputDir, undeclared), "funder,amount\nACME,5\n");
    const exporterSource = `${CLEAN_EXPORTER_SOURCE}\n  const corporate = readCsv("${undeclared}");\n`;

    const problems = collectManifestProblems({ manifest: manifest(), inputDir, exporterSource });

    expect(problems.map((p) => [p.kind, p.subject])).toEqual([["undeclared-input", undeclared]]);
    expect(problems[0].message).toMatch(/NOT declared in manifest\.json/);
    expect(problems[0].message).toMatch(new RegExp(`present in ${inputDir}`));
  });

  it("(c) fails when the exporter resolves a manifest id no source declares", () => {
    const exporterSource = `${CLEAN_EXPORTER_SOURCE}\n  const rows = readCsv(manifestFile("phase4-not-authored"));\n`;

    const problems = collectManifestProblems({ manifest: manifest(), inputDir, exporterSource });

    expect(problems.map((p) => p.kind)).toEqual(["undeclared-input"]);
    expect(problems[0].message).toMatch(/phase4-not-authored/);
  });
});
