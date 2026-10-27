/**
 * Analytics choice for the cookie banner (opt-out model, owner ruling
 * 2026-10-27): analytics runs until a visitor turns it off, and a browser
 * sending Global Privacy Control is treated as already opted out.
 *
 * The choice lives in a first-party cookie (not localStorage) so the server
 * can honor it too: /api/events drops events and expires the cie_vid visitor
 * cookie for an opted-out browser even if a stale client still sends them.
 *
 * "Analytics" here means: first-party report_events, the cie_vid visitor
 * cookie, the page-view session id in localStorage, and Vercel Analytics.
 * Sign-in, security, and chat-session cookies are essential and unaffected.
 */

export const ANALYTICS_CONSENT_COOKIE = "cie_analytics";
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Fired on window after the choice changes. */
export const ANALYTICS_CONSENT_CHANGED_EVENT = "cie:analytics-consent-changed";
/** Fired on window to reopen the banner from the footer. */
export const ANALYTICS_CHOICES_OPEN_EVENT = "cie:analytics-choices-open";

export type AnalyticsConsent = "on" | "off";

/** Browser-side analytics identifiers removed when a visitor opts out. */
const BROWSER_ANALYTICS_STORAGE_KEYS = [
  "cie_traffic_session_id",
  "cie_traffic_session_started_at",
];

export function parseAnalyticsConsent(value: string | null | undefined): AnalyticsConsent | null {
  return value === "on" || value === "off" ? value : null;
}

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`));
  return parseAnalyticsConsent(match?.slice(ANALYTICS_CONSENT_COOKIE.length + 1));
}

export function globalPrivacyControlEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** False on the server: analytics is a browser-only concern there. */
export function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return readAnalyticsConsent() !== "off" && !globalPrivacyControlEnabled();
}

export function writeAnalyticsConsent(value: AnalyticsConsent) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${ANALYTICS_CONSENT_COOKIE}=${value}; Path=/; Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;

  if (value === "off") {
    for (const key of BROWSER_ANALYTICS_STORAGE_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Storage can be unavailable (private mode); nothing to clear then.
      }
    }
  }

  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_CHANGED_EVENT, { detail: value }));
}
