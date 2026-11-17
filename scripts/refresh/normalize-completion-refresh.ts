type Row = Record<string, unknown>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseRows(content: string, label: string): Row[] {
  const rows: unknown = JSON.parse(content);
  if (!Array.isArray(rows) || rows.some((row) => row === null || Array.isArray(row) || typeof row !== "object")) {
    throw new Error(`${label} completion data must be an array of row objects`);
  }
  return rows as Row[];
}

function matchingKey(row: Row): string {
  // These completion datasets do not publish a durable native project ID in
  // their curated JSON. This is deliberately NOT claimed as permanent identity.
  // Only geometry and Socrata's computed geography may change automatically;
  // all other edits need review instead of a fuzzy match or ID reassignment.
  return canonical(Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== "location" && !key.startsWith(":@computed_region_"))));
}

function hasUsableCoordinates(row: Row): boolean {
  const location = row.location as { coordinates?: unknown } | null | undefined;
  const coords = location?.coordinates;
  // Exactly the exporter's inclusion condition (not a guessed city boundary).
  return Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1]);
}

function groupRows(rows: Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = matchingKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/**
 * Preserve published positional NOF/SBIF IDs without inventing upstream IDs.
 * Every retained row comes from the successful fetch. Missing/changed rows,
 * ambiguous duplicates and eligibility changes fail closed for human review.
 * Existing rows keep their prior order; genuinely new rows append afterwards.
 */
export function normalizeCompletionRefresh(before: string | null, next: string): string {
  if (before === null) throw new Error("Completion refresh needs an accepted baseline before assigning positional IDs");
  const prior = parseRows(before, "Accepted");
  const fetched = parseRows(next, "Fetched");
  const oldGroups = groupRows(prior);
  const newGroups = groupRows(fetched);

  for (const [key, oldRows] of oldGroups) {
    const newRows = newGroups.get(key);
    if (!newRows || newRows.length !== oldRows.length) {
      throw new Error(`Completion refresh removed/changed an accepted row or its multiplicity: ${String(oldRows[0].project_name ?? oldRows[0].applicant_name ?? "unnamed")} — human identity review required`);
    }
    // Truly identical accepted duplicate rows are indistinguishable, so their
    // unchanged multiplicity is safe. Never arbitrarily pair distinct copies.
    if (oldRows.length > 1 && (new Set(oldRows.map(canonical)).size !== 1 || new Set(newRows.map(canonical)).size !== 1)) {
      throw new Error("Completion refresh has ambiguous duplicate rows — human identity review required");
    }
    if (oldRows.some((row, i) => hasUsableCoordinates(row) !== hasUsableCoordinates(newRows[i]))) {
      throw new Error("Completion refresh changes a row's coordinate inclusion — human identity review required to preserve IDs");
    }
  }
  for (const [key, newRows] of newGroups) {
    if (!oldGroups.has(key) && newRows.length > 1) {
      throw new Error("Completion refresh adds ambiguous duplicate rows — human identity review required");
    }
  }

  const queues = new Map([...newGroups].map(([key, rows]) => [key, [...rows]]));
  const ordered = prior.map((row) => queues.get(matchingKey(row))!.shift()!);
  ordered.push(...fetched.filter((row) => !oldGroups.has(matchingKey(row))));
  // A pure order/property-order change is not a data change. This returns the
  // prior serialization ONLY after every row was confirmed in fetched bytes.
  if (canonical(ordered) === canonical(prior)) return before;
  return JSON.stringify(ordered) + "\n";
}
