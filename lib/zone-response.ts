import { ZONE_KEYS } from "./constants";

export interface NormalizedZoneCheck {
  zones: Record<string, boolean>;
  zoneNames: Record<string, string>;
  incentiveCount: number;
}

interface ZoneCheckItem {
  key?: unknown;
  name?: unknown;
}

function emptyZoneMap(): Record<string, boolean> {
  return Object.fromEntries(ZONE_KEYS.map((key) => [key, false]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeZoneNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(value)) {
    if (typeof name === "string") names[key] = name;
  }
  return names;
}

function countActiveZones(zones: Record<string, boolean>): number {
  return Object.values(zones).filter(Boolean).length;
}

export function normalizeZoneCheckResponse(
  data: unknown
): NormalizedZoneCheck | null {
  const zones = emptyZoneMap();
  const zoneNames: Record<string, string> = {};

  if (Array.isArray(data)) {
    for (const item of data as ZoneCheckItem[]) {
      if (!isRecord(item) || typeof item.key !== "string") continue;
      zones[item.key] = true;
      if (typeof item.name === "string" && item.name) {
        zoneNames[item.key] = item.name;
      }
    }

    return {
      zones,
      zoneNames,
      incentiveCount: countActiveZones(zones),
    };
  }

  if (!isRecord(data) || !isRecord(data.zones)) {
    return null;
  }

  for (const [key, value] of Object.entries(data.zones)) {
    zones[key] = Boolean(value);
  }

  return {
    zones,
    zoneNames: normalizeZoneNames(data.zoneNames),
    incentiveCount:
      typeof data.incentiveCount === "number"
        ? data.incentiveCount
        : countActiveZones(zones),
  };
}
