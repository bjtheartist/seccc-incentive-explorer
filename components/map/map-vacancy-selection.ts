import { vacancySourceLabel } from "@/lib/area-vacancy-presentation";
import type { MapDossierSource } from "@/lib/map-dossier";

const PIN_14_PATTERN = /^\d{14}$/;

function textValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function vacancyPin(properties: Record<string, unknown>): string | null {
  const publishedPin = textValue(properties.pin);
  if (publishedPin && PIN_14_PATTERN.test(publishedPin)) return publishedPin;

  // The original COLS map records encoded the PIN only in `id`. Keep that
  // fallback for the committed static data, but do not infer a PIN from other
  // source identifiers.
  const sourceId = textValue(properties.id);
  const legacyColsPin =
    textValue(properties.source) === "cols" && sourceId
      ? sourceId.replace(/^cols-/, "")
      : null;
  return legacyColsPin && PIN_14_PATTERN.test(legacyColsPin) ? legacyColsPin : null;
}

export function buildMapVacancySelectionEvidence(
  properties: Record<string, unknown>,
): { pin: string | null; sources: readonly MapDossierSource[] } {
  const sourceRecordDate = textValue(properties.sourceRecordDate);

  return {
    pin: vacancyPin(properties),
    sources: [
      {
        label: vacancySourceLabel(properties.source),
        note: `${sourceRecordDate ? `Source record date ${sourceRecordDate.slice(0, 10)}. ` : "Source record date unavailable. "}Tracked vacancy signals are research leads, not availability listings.`,
      },
    ],
  };
}
