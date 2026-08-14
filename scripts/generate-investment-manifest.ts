/**
 * Regenerate data/curated/investment-inputs/manifest.json from the AUTHORED
 * table in scripts/lib/investment-manifest.ts + the files currently on disk.
 *
 * `--check` (used by the clean-diff test and CI) writes nothing and exits
 * nonzero if the committed file would change.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { buildManifest, stringifyManifest, MANIFEST_PATH } from "./lib/investment-manifest";

function main() {
  const check = process.argv.includes("--check");
  // generatedAt is excluded from the diff comparison (it's a timestamp, not
  // content) — the check compares everything EXCEPT that field.
  const fresh = buildManifest(new Date().toISOString());
  const freshText = stringifyManifest(fresh);

  if (check) {
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

  writeFileSync(MANIFEST_PATH, freshText);
  console.log(`Wrote ${MANIFEST_PATH} (${fresh.sources.length} sources)`);
}

main();
