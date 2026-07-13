export interface TrafficAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrerHost?: string;
  referrerPath?: string;
}

const MAX_ATTRIBUTION_LENGTH = 120;

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_ATTRIBUTION_LENGTH) : undefined;
}

export function readTrafficAttribution(
  search: string,
  referrer?: string,
): TrafficAttribution {
  const params = new URLSearchParams(search);
  const attribution: TrafficAttribution = {
    utmSource: clean(params.get("utm_source")),
    utmMedium: clean(params.get("utm_medium")),
    utmCampaign: clean(params.get("utm_campaign")),
    utmContent: clean(params.get("utm_content")),
    utmTerm: clean(params.get("utm_term")),
  };

  if (referrer) {
    try {
      const url = new URL(referrer);
      attribution.referrerHost = clean(url.hostname);
      attribution.referrerPath = clean(url.pathname);
    } catch {
      // Referrer metadata is optional and should never interrupt page tracking.
    }
  }

  return Object.fromEntries(
    Object.entries(attribution).filter(([, value]) => value !== undefined),
  ) as TrafficAttribution;
}
