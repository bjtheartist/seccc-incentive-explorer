import {
  currentLicenseConflictSummary,
  vacancyCanonicalTypeLabel,
  vacancyFreshnessLabel,
  vacancyLicenseCheckStateNote,
  vacancySourceLabel,
} from "@/lib/area-vacancy-presentation";

export const DRAWN_AREA_VACANCY_SOURCE_ID = "drawn-area-vacancy-signals";
export const DRAWN_AREA_VACANCY_LAYER_ID = "drawn-area-vacancy-signal-points";

interface GeoJsonSourceLike {
  setData: (data: GeoJSON.FeatureCollection) => void;
}

interface SourceMapLike {
  getSource: (id: string) => unknown;
}

export function setDrawnAreaVacancySignals(
  map: SourceMapLike,
  features: readonly GeoJSON.Feature[],
): void {
  const source = map.getSource(DRAWN_AREA_VACANCY_SOURCE_ID) as
    | GeoJsonSourceLike
    | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: [...features],
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildDrawnAreaVacancyPopupHtml(
  properties: Record<string, unknown>,
): string {
  const address = escapeHtml(properties.address || "Address not recorded");
  const source = escapeHtml(vacancySourceLabel(properties.source));
  const type = escapeHtml(vacancyCanonicalTypeLabel(properties.canonicalType));
  const freshness = escapeHtml(vacancyFreshnessLabel(properties.freshnessClass));
  const sourceDate = escapeHtml(
    typeof properties.sourceRecordDate === "string"
      ? properties.sourceRecordDate.slice(0, 10)
      : "Not recorded",
  );
  const conflict = currentLicenseConflictSummary(properties.currentLicenseMatches);
  const sourceStatus =
    typeof properties.status === "string" && properties.status.trim()
      ? escapeHtml(properties.status)
      : "Not recorded";
  const licenseNote = escapeHtml(
    vacancyLicenseCheckStateNote(properties.licenseCheckState),
  );
  return `
    <div class="bureau-popup-content">
      <div class="bureau-popup-eyebrow">Tracked vacancy signal</div>
      <div class="bureau-popup-title">${address}</div>
      <div class="bureau-popup-row"><strong>Type</strong><span>${type}</span></div>
      <div class="bureau-popup-row"><strong>Source</strong><span>${source}</span></div>
      <div class="bureau-popup-row"><strong>Source status</strong><span>${sourceStatus}</span></div>
      <div class="bureau-popup-row"><strong>Source date</strong><span>${sourceDate}</span></div>
      <div class="bureau-popup-row"><strong>Freshness</strong><span>${freshness}</span></div>
      ${
        conflict
          ? `<div class="bureau-popup-note"><strong>Current-license conflict:</strong> ${escapeHtml(conflict)}. This may indicate current use; confirm.</div>`
          : `<div class="bureau-popup-note">${licenseNote}</div>`
      }
    </div>
  `;
}
