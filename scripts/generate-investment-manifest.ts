/**
 * Regenerate data/curated/investment-inputs/manifest.json from the AUTHORED
 * table in scripts/lib/investment-manifest.ts + the files currently on disk.
 *
 * `--check` (used by the clean-diff test and CI) writes nothing and exits
 * nonzero if the committed file would change.
 */
import { readFileSync, existsSync } from "node:fs";
import { buildManifest, writeManifest, MANIFEST_PATH } from "./lib/investment-manifest";

function main() {
  const check = process.argv.includes("--check");

  if (check) {
    // generatedAt is excluded from the diff comparison (it's a timestamp, not
    // content) — the check compares everything EXCEPT that field.
    const fresh = buildManifest(new Date().toISOString());
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`MISSING: ${MANIFEST_PATH}`);
      process.exit(1);
    }
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const committedNormalized = { ...committed, generatedAt: "GENERATED_AT" };
    const freshNormalized = { ...fresh, generatedAt: "GENERATED_AT" };
    const same = JSON.stringify(committedNormalized) === JSON.stringify(freshNormalized);
    if (!same) {
      console.error("manifest.json is stale — run `npm run data:manifest:generate`");
      process.exit(1);
    }
    console.log("manifest.json is clean.");
    return;
  }

  // The write itself lives in scripts/lib/investment-manifest.ts's
  // writeManifest() so scripts/refresh/refresh-live-sources.ts regenerates the
  // manifest through the SAME code path this CLI uses, rather than a second
  // copy that can drift from it.
  const written = writeManifest();
  console.log(`Wrote ${MANIFEST_PATH} (${written.sources.length} sources)`);
}

main();
