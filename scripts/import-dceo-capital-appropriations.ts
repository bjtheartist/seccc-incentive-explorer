#!/usr/bin/env npx tsx
/**
 * Import the Illinois DCEO Capital Appropriation List into a deterministic CSV.
 *
 * These rows represent legislative appropriations. They are intentionally not
 * labeled as active opportunities, GATA awards, or funding available to a
 * project.
 *
 * Usage:
 *   npx tsx scripts/import-dceo-capital-appropriations.ts /path/to/source.pdf
 *   npx tsx scripts/import-dceo-capital-appropriations.ts --input https://...pdf
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "unpdf";
import {
  DCEO_CAPITAL_APPROPRIATIONS_SOURCE_PAGE_URL,
  DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL,
  DCEO_CAPITAL_APPROPRIATIONS_SOURCE_VERSION,
  parseDceoCapitalAppropriationsPages,
  type DceoCapitalAppropriationRecord,
} from "../lib/dceo-capital-appropriations";

const DEFAULT_OUTPUT = join(
  process.cwd(),
  "data",
  "curated",
  "investment-inputs",
  "dceo_capital_appropriations.csv",
);

interface CliOptions {
  input: string;
  output: string;
  diagnosticsOutput: string;
  sourceUrl: string;
  sourceVersion: string;
  strictFullDocument: boolean;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseDceoCapitalAppropriationCliArgs(args: string[]): CliOptions {
  let input = "";
  let output = DEFAULT_OUTPUT;
  let diagnosticsOutput = "";
  let sourceUrl = DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL;
  let sourceVersion = DCEO_CAPITAL_APPROPRIATIONS_SOURCE_VERSION;
  let strictFullDocument = true;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input") {
      input = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--output") {
      output = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--diagnostics") {
      diagnosticsOutput = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--source-url") {
      sourceUrl = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--source-version") {
      sourceVersion = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--allow-noncanonical") {
      strictFullDocument = false;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  if (!input) {
    throw new Error(
      "Provide a local PDF path or URL with --input (or as the first positional argument)",
    );
  }

  const resolvedOutput = resolve(output);
  const resolvedDiagnostics = diagnosticsOutput
    ? resolve(diagnosticsOutput)
    : resolvedOutput.replace(/\.csv$/i, "") + ".diagnostics.json";

  return {
    input,
    output: resolvedOutput,
    diagnosticsOutput: resolvedDiagnostics,
    sourceUrl,
    sourceVersion,
    strictFullDocument,
  };
}

async function readPdf(input: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to download DCEO source (${response.status} ${response.statusText})`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("pdf")) {
      throw new Error(`DCEO source returned non-PDF content type: ${contentType}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`DCEO source PDF not found: ${path}`);
  return readFileSync(path);
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeDceoCapitalAppropriationsCsv(
  records: readonly DceoCapitalAppropriationRecord[],
): string {
  const header = [
    "line_name",
    "appropriation_code",
    "appropriated_amount",
    "original_description",
    "line_type",
    "explicit_project_address",
    "source_url",
    "source_version",
  ];

  const rows = records.map((record) =>
    [
      record.lineName,
      record.appropriationCode,
      record.appropriatedAmount.toFixed(2),
      record.originalDescription,
      record.lineType,
      record.explicitProjectAddress ?? "",
      record.sourceUrl,
      record.sourceVersion,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.join(","), ...rows].join("\n") + "\n";
}

function writeIfChanged(path: string, contents: string): "created" | "updated" | "unchanged" {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === contents) return "unchanged";
  const action = existsSync(path) ? "updated" : "created";
  writeFileSync(path, contents);
  return action;
}

export async function importDceoCapitalAppropriations(options: CliOptions): Promise<void> {
  const pdf = await readPdf(options.input);
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("DCEO source is not a PDF file");
  }

  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  const extracted = await extractText(new Uint8Array(pdf), { mergePages: false });
  if (!Array.isArray(extracted.text)) {
    throw new Error("Expected unpdf to return one text element per page");
  }
  if (extracted.totalPages !== extracted.text.length) {
    throw new Error(
      `PDF extraction page mismatch: reported ${extracted.totalPages}, extracted ${extracted.text.length}`,
    );
  }

  const parsed = parseDceoCapitalAppropriationsPages(extracted.text, {
    sourceUrl: options.sourceUrl,
    sourceVersion: options.sourceVersion,
    strictFullDocument: options.strictFullDocument,
  });

  const csv = serializeDceoCapitalAppropriationsCsv(parsed.records);
  const diagnostics = JSON.stringify(
    {
      sourcePageUrl: DCEO_CAPITAL_APPROPRIATIONS_SOURCE_PAGE_URL,
      sourceUrl: options.sourceUrl,
      sourceVersion: options.sourceVersion,
      pdfSha256,
      pdfBytes: pdf.length,
      ...parsed.diagnostics,
    },
    null,
    2,
  ) + "\n";

  const csvAction = writeIfChanged(options.output, csv);
  const diagnosticsAction = writeIfChanged(options.diagnosticsOutput, diagnostics);
  console.log(
    JSON.stringify(
      {
        output: options.output,
        outputAction: csvAction,
        diagnosticsOutput: options.diagnosticsOutput,
        diagnosticsAction,
        ...parsed.diagnostics,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  importDceoCapitalAppropriations(parseDceoCapitalAppropriationCliArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    },
  );
}
