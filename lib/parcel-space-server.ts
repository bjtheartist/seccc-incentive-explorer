import { getSQL } from "./db";
import { normalizePin14 } from "./cook-viewer";
import {
  availableSpaceSourceLabel,
  positiveSquareFeet,
  type PublicAvailableSpaceMeasurement,
} from "./parcel-space";

export type CurrentAvailableSpaceLoad =
  | { status: "available"; measurements: PublicAvailableSpaceMeasurement[] }
  | { status: "unavailable"; measurements: [] };

function publicMeasurement(row: Record<string, unknown>): PublicAvailableSpaceMeasurement | null {
  const pin = normalizePin14(row.pin);
  const availableSpaceSqft = positiveSquareFeet(row.sqft);
  const verifiedAt = new Date(String(row.verified_at));
  const reconfirmAfter = new Date(String(row.reconfirm_after));
  if (
    !pin ||
    availableSpaceSqft === null ||
    !Number.isFinite(verifiedAt.getTime()) ||
    !Number.isFinite(reconfirmAfter.getTime()) ||
    verifiedAt.getTime() > Date.now() ||
    reconfirmAfter.getTime() <= Date.now() ||
    reconfirmAfter.getTime() <= verifiedAt.getTime()
  ) {
    return null;
  }
  return {
    pin,
    availableSpaceSqft,
    source: availableSpaceSourceLabel(String(row.source_key ?? "")),
    verifiedAt: verifiedAt.toISOString(),
    reconfirmAfter: reconfirmAfter.toISOString(),
  };
}

export async function loadCurrentAvailableSpaceMeasurements({
  pin,
  zip,
}: {
  pin?: string | null;
  zip?: string | null;
}): Promise<CurrentAvailableSpaceLoad> {
  if (!pin && !zip) return { status: "unavailable", measurements: [] };
  const sql = getSQL();
  if (!sql) return { status: "unavailable", measurements: [] };

  try {
    const rows = pin
      ? await sql`
          SELECT pin, sqft, source_key, verified_at, reconfirm_after
          FROM current_available_space_measurements
          WHERE pin = ${pin}
          LIMIT 1
        `
      : await sql`
          SELECT pin, sqft, source_key, verified_at, reconfirm_after
          FROM current_available_space_measurements
          WHERE zip = ${zip}
          ORDER BY pin
        `;
    return {
      status: "available",
      measurements: rows
        .map((row) => publicMeasurement(row as Record<string, unknown>))
        .filter((row): row is PublicAvailableSpaceMeasurement => row !== null),
    };
  } catch {
    return { status: "unavailable", measurements: [] };
  }
}
