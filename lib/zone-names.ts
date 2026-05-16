import type { Feature } from "geojson";

type ZoneProperties = Record<string, unknown>;

function firstString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function parseZoneProperties(value: unknown): ZoneProperties {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as ZoneProperties)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as ZoneProperties) : {};
}

export function formatSsaNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/\bSSA\s*#?\s*(\d+(?:-\d{4})?)\b/i);
  return match ? `SSA #${match[1]}` : "";
}

export function formatZoneFeatureName(
  zoneKey: string,
  properties: ZoneProperties = {},
): string {
  const name = firstString([
    properties.name,
    properties.NAME,
    properties.Name,
    properties.display_name,
  ]);
  const description = firstString([
    properties.description,
    properties.DESCRIPTION,
  ]);

  if (zoneKey === "ssa") {
    const ssaNumber = formatSsaNumber(description) || formatSsaNumber(name);
    if (name && ssaNumber && !name.toLowerCase().includes(ssaNumber.toLowerCase())) {
      return `${name} (${ssaNumber})`;
    }
    return name || ssaNumber || description;
  }

  return name || description;
}

export function featureDisplayName(zoneKey: string, feature: Feature): string {
  return formatZoneFeatureName(zoneKey, parseZoneProperties(feature.properties));
}
