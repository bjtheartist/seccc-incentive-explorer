import legacy from "./capital-legacy-record-ids.json";

/**
 * Compatibility aliases, not a second investment dataset. The checked-in map
 * contains ONLY native source keys -> IDs already published at baselineCommit.
 * Its provenance pins both CSVs and the export used for the one-time migration.
 * Never rebuild it from a later source ordering: saved IDs are permanent.
 *
 * New IDs use a separate, injective source-key namespace. No prior export is
 * read, no mutable dollar/address/geometry field is an identity key, and an ID
 * can never be reused when a source row disappears and later returns.
 */
const LEGACY_IDS: Record<"tif" | "cdbg-home", Readonly<Record<string, string>>> = legacy.ids;

function numericId(value: string | undefined, label: string): string {
  const trimmed = (value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must contain a native numeric source identifier, got ${JSON.stringify(value)}`);
  }
  // Avoid distinct identities for formatting-only leading zeroes; do not use
  // Number(), which could round a future large upstream identifier.
  return trimmed.replace(/^0+(?=\d)/, "");
}

export function tifSourceKey(row: Record<string, string>): string {
  // The last component in the historic CSV is a VOLATILE row ordinal, not
  // source identity. The middle component is Socrata's published project id.
  const match = /^rda-iga:([^:]+)(?::\d+)?$/.exec((row.source_row_id ?? "").trim());
  if (!match) throw new Error(`TIF row has no usable source_row_id: ${JSON.stringify(row.source_row_id)}`);
  return `rda-iga:${numericId(match[1], "TIF source_row_id")}`;
}

export function hudSourceKey(row: Record<string, string>): string {
  const program = (row.program ?? "").trim().toLowerCase();
  if (program !== "cdbg" && program !== "home") {
    throw new Error(`HUD row has unknown program: ${JSON.stringify(row.program)}`);
  }
  return `${program}:${numericId(row.activity_id, "HUD activity_id")}`;
}

/** Per-source resolver also refuses ambiguous duplicate upstream identifiers. */
export function capitalRecordIdResolver(source: "tif" | "cdbg-home") {
  const seen = new Set<string>();
  return (sourceKey: string): string => {
    if (seen.has(sourceKey)) throw new Error(`Duplicate ${source} source identity: ${sourceKey}`);
    seen.add(sourceKey);
    return LEGACY_IDS[source][sourceKey] ?? `${source}-source-${sourceKey.replace(":", "-")}`;
  };
}
