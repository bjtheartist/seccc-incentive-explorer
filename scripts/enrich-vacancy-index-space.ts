#!/usr/bin/env npx tsx
/**
 * Overlay source-separated parcel-space facts onto the trusted committed
 * vacancy index. This intentionally does not rebuild any vacancy edition.
 * Dry-run is the default; --write is required to replace the public artifact.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseZipList } from "./parcel-space-enrichment";
import {
  assertVacancySpaceOnlyChange,
  assertVacancySpacePayloadBudget,
  buildParcelSpaceFactsByPin,
  overlayVacancySpaceFacts,
  type CurrentParcelSpaceMeasurementRow,
} from "../lib/vacancy-space-snapshot";
import type { VacancyIndexExport } from "../lib/vacancy-index";

const DEFAULT_PATH = resolve(process.cwd(), "public/data/vacancy-index.json");

interface CliOptions {
  write: boolean;
  help: boolean;
  zips: string[] | null;
}
export function parseVacancySpaceOverlayArgs(args: readonly string[]): CliOptions {
  let write = false;
  let help = false;
  let zips: string[] | null = null;
  let sawWrite = false;
  let sawDryRun = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--write") {
      sawWrite = true;
      write = true;
    } else if (arg === "--dry-run") {
      sawDryRun = true;
      write = false;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--zips") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--zips requires a value");
      zips = parseZipList(value);
      index++;
    } else if (arg.startsWith("--zips=")) {
      zips = parseZipList(arg.slice("--zips=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawWrite && sawDryRun) throw new Error("Choose either --write or --dry-run, not both");
  return { write, help, zips };
}

function printUsage(): void {
  console.log(`Vacancy index parcel-space overlay

Usage:
  DATABASE_URL="postgresql://..." npx tsx scripts/enrich-vacancy-index-space.ts [--zips=60617,...]
  DATABASE_URL="postgresql://..." npx tsx scripts/enrich-vacancy-index-space.ts --write

Options:
  --zips     Optional subset of editions; defaults to every edition in the file
  --dry-run  Query, overlay, and verify without writing (default)
  --write    Replace only the public vacancy index after all guards pass
  --help     Show this help`);
}

function assertPublicArtifact(serialized: string): void {
  const forbidden = [
    '"owner_name"',
    '"owner_mailing_address"',
    '"priorityScore"',
    '"priorityTier"',
    '"priorityMix"',
    '"portfolio"',
    '"portfolioCounts"',
  ];
  const found = forbidden.filter((needle) => serialized.includes(needle));
  if (found.length > 0) {
    throw new Error(`Public vacancy artifact contains forbidden fields: ${found.join(", ")}`);
  }
}

export async function enrichVacancyIndexSpace(options: CliOptions): Promise<void> {
  if (options.help) {
    printUsage();
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const before = JSON.parse(readFileSync(DEFAULT_PATH, "utf8")) as VacancyIndexExport;
  const zips = options.zips ?? Object.keys(before.editions).sort();
  const sql = neon(databaseUrl);
  const rows = (await sql`
    SELECT m.pin, m.metric, m.sqft, m.source_key, m.source_year,
           m.verification_status, m.measurement_scope, m.is_active,
           m.verified_at, m.reconfirm_after
    FROM parcel_space_measurements m
    WHERE m.is_current IS TRUE
      AND (
        m.zip = ANY(${zips})
        OR EXISTS (
          SELECT 1 FROM parcels p
          WHERE p.pin = m.pin AND p.zip = ANY(${zips})
        )
      )
    ORDER BY m.pin, m.metric
  `) as CurrentParcelSpaceMeasurementRow[];

  if (rows.length === 0) {
    throw new Error("No current parcel-space measurements found for the requested ZIPs");
  }

  const factsByPin = buildParcelSpaceFactsByPin(rows);
  const overlaid = overlayVacancySpaceFacts(before, factsByPin, zips);
  overlaid.summary.measurementRowsRead = rows.length;
  assertVacancySpaceOnlyChange(before, overlaid.data, zips);
  const payload = assertVacancySpacePayloadBudget(before, overlaid.data);
  const serialized = JSON.stringify(overlaid.data);
  assertPublicArtifact(serialized);

  console.log(
    JSON.stringify(
      {
        mode: options.write ? "write" : "dry-run",
        ...overlaid.summary,
        payload: {
          ...payload,
          growthPercent: Number((payload.growthRatio * 100).toFixed(2)),
        },
      },
      null,
      2,
    ),
  );

  if (!options.write) {
    console.log("DRY RUN complete: public/data/vacancy-index.json was not changed.");
    return;
  }
  writeFileSync(DEFAULT_PATH, serialized);
  console.log(`Wrote ${DEFAULT_PATH}`);
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  enrichVacancyIndexSpace(parseVacancySpaceOverlayArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
