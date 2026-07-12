export interface ApprovalRow {
  key: string;
  value: string;
}

/** Flatten a tool input into readable rows without hiding destructive clears. */
export function toApprovalRows(input: unknown): ApprovalRow[] {
  const rows: ApprovalRow[] = [];
  const walk = (obj: unknown, prefix = "") => {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const label = prefix ? `${prefix}.${key}` : key;
      if (value === undefined) continue;
      if (value === null || value === "") {
        rows.push({ key: label, value: "Clear this field" });
        continue;
      }
      if (typeof value === "object" && !Array.isArray(value)) {
        walk(value, label);
      } else {
        rows.push({
          key: label,
          value: Array.isArray(value) ? value.join(", ") : String(value),
        });
      }
    }
  };
  walk(input);
  return rows;
}
