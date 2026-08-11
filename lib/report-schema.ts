/**
 * Persisted-report schema boundary.
 *
 * A saved report is a snapshot of whatever `GeneratedReport` looked like on the
 * day it was written. The engine keeps moving; the rows in `saved_reports` do
 * not. Before this module the workspace page cast that stored JSON straight to
 * `GeneratedReport` (`data.report.reportData as GeneratedReport`), which means
 * any shape drift — a renamed field, a section that used to be an array, a row
 * written by a future deploy — surfaced as a render-time crash on somebody's
 * saved report rather than as a handled failure.
 *
 * So: every read of persisted report JSON goes through `normalizeSavedReport`,
 * and every write stamps `schemaVersion` via `stampReportSchemaVersion`.
 *
 * The rules that keep this honest as versions accumulate:
 *
 *  - **Missing `schemaVersion` means 1, never "unknown".** Everything saved
 *    before this field existed is by definition the version-1 shape.
 *  - **Coerce what is recoverable, reject only what is not a report.** A blob
 *    missing `summary` still renders fine with an empty summary; refusing it
 *    would lose the user's saved work for no gain. A blob with no `sections`
 *    array is not a report and must fail loudly instead of half-rendering.
 *  - **A version from the future is a failure, not a best-effort render.** If a
 *    newer deploy wrote version N+1 and this build only understands N, it
 *    cannot know what changed; guessing is how silent corruption starts.
 *  - **Failures are typed and returned, never thrown.** The caller renders
 *    "this saved report could not be loaded"; nothing crashes the page.
 *
 * Adding version 2: bump `CURRENT_REPORT_SCHEMA_VERSION`, add a migration step
 * to `MIGRATIONS` keyed by the version it upgrades *from*, and leave the
 * version-1 validation below alone — old rows keep arriving forever.
 */

import type { GeneratedReport, ReportItem, ReportSection, ReportType } from "./report-engine";

/**
 * The shape the engine writes today. Version 1 is the shape that existed
 * before any of this was versioned, so the first stamped version and the first
 * legacy version are deliberately the same number.
 */
export const CURRENT_REPORT_SCHEMA_VERSION = 1;

/** Read on a blob with no `schemaVersion` field at all. */
export const LEGACY_REPORT_SCHEMA_VERSION = 1;

export type SavedReportFailureReason =
  /** Not a JSON object at all — null, an array, a string, a number. */
  | "not-an-object"
  /** `schemaVersion` present but not a usable version number. */
  | "invalid-version"
  /** Written by a newer deploy than this build understands. */
  | "future-version"
  /** Object, but missing something a report cannot be a report without. */
  | "missing-required-fields";

export interface SavedReportSuccess {
  ok: true;
  report: GeneratedReport;
  /** The version the stored blob claimed (1 when the field was absent). */
  sourceVersion: number;
  /** True when the stored blob predates the current version and was upgraded. */
  migrated: boolean;
}

export interface SavedReportFailure {
  ok: false;
  reason: SavedReportFailureReason;
  /** Operator-facing detail. Safe to log; not written for end users. */
  detail: string;
}

export type NormalizedSavedReport = SavedReportSuccess | SavedReportFailure;

/** Message the UI shows when a saved report cannot be loaded. */
export const SAVED_REPORT_LOAD_ERROR =
  "This saved report could not be loaded. It was saved in a format this version of the site does not recognize.";

// ─── Narrow runtime checks (hand-rolled on purpose — no validator dependency
//     belongs on the workspace page's client bundle for six field checks) ───

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

const REPORT_TYPES: readonly ReportType[] = [
  "site-incentives",
  "dev-feasibility",
  "corridor-intelligence",
  "location-incentives",
  "best-location",
  "program-explorer",
  "developer-analysis",
];

/**
 * Unknown report types fall back rather than fail: `reportType` only picks a
 * headline template, and a saved report with an unrecognized one still holds
 * every program the user cared about.
 */
function asReportType(value: unknown): ReportType {
  return REPORT_TYPES.includes(value as ReportType) ? (value as ReportType) : "site-incentives";
}

const ACTION_PRIORITIES = new Set(["high", "medium", "low"]);

function asPriority(value: unknown): "high" | "medium" | "low" {
  return ACTION_PRIORITIES.has(value as string) ? (value as "high" | "medium" | "low") : "low";
}

/**
 * Sections and their items are the only parts the display walks unconditionally
 * (`report.sections.map(...)`, `section.items.map(...)`), so those two arrays
 * are the ones that have to be arrays no matter what the blob says. Entries
 * that are not objects are dropped — there is nothing to render from a bare
 * string or null, and keeping it only moves the crash into the renderer.
 */
function normalizeSection(raw: unknown): ReportSection | null {
  if (!isPlainObject(raw)) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.filter(isPlainObject).map((item) => normalizeItem(item))
    : [];
  return {
    ...(raw as Partial<ReportSection>),
    title: asString(raw.title),
    items,
  } as ReportSection;
}

function normalizeItem(raw: Record<string, unknown>): ReportItem {
  return {
    ...(raw as Partial<ReportItem>),
    label: asString(raw.label),
    value: asString(raw.value),
  } as ReportItem;
}

function normalizeRecommendedAction(raw: unknown): GeneratedReport["recommendedActions"][number] | null {
  if (!isPlainObject(raw)) return null;
  return {
    ...(raw as Record<string, unknown>),
    label: asString(raw.label),
    description: asString(raw.description),
    priority: asPriority(raw.priority),
  } as GeneratedReport["recommendedActions"][number];
}

/**
 * Migration table, keyed by the version each step upgrades *from*. Empty today
 * because version 1 is current; the plumbing is here so the first real shape
 * change is a table entry rather than a rewrite of the load path.
 */
const MIGRATIONS: Record<number, (report: Record<string, unknown>) => Record<string, unknown>> = {};

function fail(reason: SavedReportFailureReason, detail: string): SavedReportFailure {
  return { ok: false, reason, detail };
}

/**
 * Turn stored report JSON into a `GeneratedReport`, or into a typed failure the
 * caller can render. Never throws.
 */
export function normalizeSavedReport(raw: unknown): NormalizedSavedReport {
  if (!isPlainObject(raw)) {
    return fail("not-an-object", `Expected a report object, received ${describe(raw)}.`);
  }

  // Absent means version 1 — this is the whole point of the legacy branch.
  const rawVersion = raw.schemaVersion;
  let sourceVersion: number;
  if (rawVersion === undefined || rawVersion === null) {
    sourceVersion = LEGACY_REPORT_SCHEMA_VERSION;
  } else if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) {
    return fail("invalid-version", `schemaVersion must be a positive integer, received ${describe(rawVersion)}.`);
  } else {
    sourceVersion = rawVersion;
  }

  if (sourceVersion > CURRENT_REPORT_SCHEMA_VERSION) {
    return fail(
      "future-version",
      `Report was saved at schema version ${sourceVersion}; this build understands up to ${CURRENT_REPORT_SCHEMA_VERSION}.`,
    );
  }

  // Minimum shape. Anything not checked here is recoverable with a default.
  const missing: string[] = [];
  if (typeof raw.title !== "string" || raw.title.trim() === "") missing.push("title");
  if (!Array.isArray(raw.sections)) missing.push("sections");
  if (!Array.isArray(raw.recommendedActions)) missing.push("recommendedActions");
  if (missing.length > 0) {
    return fail("missing-required-fields", `Missing or invalid required field(s): ${missing.join(", ")}.`);
  }

  let working: Record<string, unknown> = raw;
  for (let version = sourceVersion; version < CURRENT_REPORT_SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (!step) {
      return fail("invalid-version", `No migration registered from schema version ${version}.`);
    }
    working = step(working);
  }

  const sections = (working.sections as unknown[])
    .map(normalizeSection)
    .filter((section): section is ReportSection => section !== null);
  const recommendedActions = (working.recommendedActions as unknown[])
    .map(normalizeRecommendedAction)
    .filter((action): action is GeneratedReport["recommendedActions"][number] => action !== null);

  const report: GeneratedReport = {
    ...(working as unknown as GeneratedReport),
    schemaVersion: CURRENT_REPORT_SCHEMA_VERSION,
    title: asString(working.title),
    subtitle: asString(working.subtitle),
    reportType: asReportType(working.reportType),
    generatedAt: asString(working.generatedAt),
    summary: asString(working.summary),
    sections,
    recommendedActions,
    metadata: asObject(working.metadata) as GeneratedReport["metadata"],
  };

  return {
    ok: true,
    report,
    sourceVersion,
    migrated: sourceVersion !== CURRENT_REPORT_SCHEMA_VERSION,
  };
}

/**
 * Stamp the current schema version on a report about to be persisted. Applied
 * at the write boundary rather than inside the engine: the version describes
 * the stored snapshot, and an in-memory report that is never saved has no
 * snapshot to describe.
 */
export function stampReportSchemaVersion<T extends Record<string, unknown>>(
  reportData: T,
): T & { schemaVersion: number } {
  return { ...reportData, schemaVersion: CURRENT_REPORT_SCHEMA_VERSION };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
