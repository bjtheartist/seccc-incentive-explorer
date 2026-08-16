/** Client-safe Google Maps search-link construction for public site records. */

export interface GoogleMapsLocation {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  zip?: string | null;
}

const PLACEHOLDER_ADDRESSES = new Set([
  "",
  "ADDRESS NOT PUBLISHED",
  "ADDRESS NOT RECORDED",
  "ADDRESS UNKNOWN",
  "N/A",
  "NOT PUBLISHED",
  "UNKNOWN",
  "NOT AVAILABLE",
]);

function usableAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_ADDRESSES.has(collapsed.toUpperCase())) return null;
  return collapsed;
}

function usableLatitude(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 && value >= -90 && value <= 90;
}

function usableLongitude(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 && value >= -180 && value <= 180;
}

/**
 * Prefer the published street address, with Chicago context added only when
 * the string does not already name the city. Coordinates remain an honest
 * fallback for records whose source did not publish a usable address.
 */
export function googleMapsSearchUrl(location: GoogleMapsLocation): string | null {
  const address = usableAddress(location.address);
  let query: string | null = null;

  if (address) {
    const hasChicago = /\bCHICAGO\b/i.test(address);
    const zip = typeof location.zip === "string" && /^\d{5}$/.test(location.zip.trim())
      ? ` ${location.zip.trim()}`
      : "";
    query = hasChicago ? address : `${address}, Chicago, IL${zip}`;
  } else if (usableLatitude(location.lat) && usableLongitude(location.lon)) {
    query = `${location.lat.toFixed(6)},${location.lon.toFixed(6)}`;
  }

  if (!query) return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}
