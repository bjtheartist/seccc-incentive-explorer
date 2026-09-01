import { describe, expect, it } from "vitest";
import {
  GEOCODE_NOT_FOUND_MESSAGE,
  GEOCODE_SERVICE_UNAVAILABLE_MESSAGE,
  REPORT_GENERATION_FAILURE_COPY,
  geocodeFailureMessage,
  httpStatusFromFetchError,
} from "../report-generation-failure";
import {
  EMAIL_REPORT_TIMEOUT_MESSAGE,
  EMAIL_REPORT_TIMEOUT_MS,
  PDF_DOWNLOAD_FAILURE_MESSAGE,
  isTimeoutError,
} from "../ReportModals";

/**
 * R1 finding 1 — the copy layer.
 *
 * /report used to answer a failed `/api/geocode` call with "Could not find
 * that address. Please try a more specific Chicago address." for BOTH a
 * genuine miss and a 5xx or timeout on our side. The second is our outage
 * described as the reader's typing error, and no amount of retyping fixes it.
 */
describe("geocodeFailureMessage: only a real answer may blame the address", () => {
  it("a 404 from the geocode route keeps the address-shaped message", () => {
    expect(geocodeFailureMessage(new Error("Fetch failed: 404 Not Found"))).toBe(
      GEOCODE_NOT_FOUND_MESSAGE,
    );
  });

  it("a 400 (the service rejected the query) also keeps the address-shaped message", () => {
    expect(geocodeFailureMessage(new Error("Fetch failed: 400 Bad Request"))).toBe(
      GEOCODE_NOT_FOUND_MESSAGE,
    );
  });

  const outages = [
    "Fetch failed: 500 Internal Server Error",
    "Fetch failed: 502 Bad Gateway",
    "Fetch failed: 503 Service Unavailable",
    "Fetch failed: 504 Gateway Timeout",
    "Fetch failed: 429 Too Many Requests",
  ];
  for (const message of outages) {
    it(`"${message}" is reported as a service failure, never as a bad address`, () => {
      const copy = geocodeFailureMessage(new Error(message));
      expect(copy).toBe(GEOCODE_SERVICE_UNAVAILABLE_MESSAGE);
      expect(copy).toContain("temporarily unavailable");
      expect(copy).not.toContain("more specific Chicago address");
    });
  }

  it("a transport failure with no status at all is a service failure, not a not-found", () => {
    // Offline, DNS failure, connection reset: nobody ever answered, so there
    // is no basis for saying the address is wrong.
    expect(geocodeFailureMessage(new TypeError("Failed to fetch"))).toBe(
      GEOCODE_SERVICE_UNAVAILABLE_MESSAGE,
    );
    expect(geocodeFailureMessage(undefined)).toBe(GEOCODE_SERVICE_UNAVAILABLE_MESSAGE);
  });

  it("the service-failure copy explicitly places the fault on us", () => {
    expect(GEOCODE_SERVICE_UNAVAILABLE_MESSAGE).toContain("on our side, not your address");
    expect(GEOCODE_SERVICE_UNAVAILABLE_MESSAGE).not.toMatch(/eligib|qualif/i);
  });

  it("httpStatusFromFetchError recovers the status cachedFetch only puts in its message", () => {
    expect(httpStatusFromFetchError(new Error("Fetch failed: 503 Service Unavailable"))).toBe(503);
    expect(httpStatusFromFetchError(new Error("something else entirely"))).toBeNull();
  });
});

describe("REPORT_GENERATION_FAILURE_COPY is honest and per-path", () => {
  it("instant-mode and wizard copy are DISTINCT — the two failures are not the same event", () => {
    expect(REPORT_GENERATION_FAILURE_COPY.instant.body).not.toBe(
      REPORT_GENERATION_FAILURE_COPY.wizard.body,
    );
    // The wizard reader has answers on screen; say they survive.
    expect(REPORT_GENERATION_FAILURE_COPY.wizard.body).toContain("still filled in");
    // The instant reader has an address; say it survives.
    expect(REPORT_GENERATION_FAILURE_COPY.instant.body).toContain("address is still here");
  });

  it("every path states OUR failure, offers a way forward, and claims nothing about incentives", () => {
    for (const [source, copy] of Object.entries(REPORT_GENERATION_FAILURE_COPY)) {
      expect(copy.heading.length, source).toBeGreaterThan(0);
      expect(copy.retryLabel.length, source).toBeGreaterThan(0);
      expect(copy.body, source).toMatch(/failed|could not be built/i);
      // Never blame-shaped.
      expect(copy.body, source).not.toMatch(/you (entered|typed) .*(wrong|incorrect)/i);
      // Never eligibility-shaped, and never a finding.
      expect(copy.body, source).not.toMatch(/eligib|qualif|you (may|do not) (receive|get)/i);
      expect(copy.body, source).not.toMatch(/no programs|no incentives|nothing available/i);
    }
  });
});

/**
 * R1 finding 5 — the email half. The send had no deadline at all, so a stalled
 * request left the modal on "Sending…" with no statement and no way out.
 */
describe("email-report timeout contract", () => {
  it("fixes a 30s ceiling", () => {
    expect(EMAIL_REPORT_TIMEOUT_MS).toBe(30_000);
  });

  it("recognises an aborted request distinctly from a rejected send", () => {
    expect(isTimeoutError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
    expect(isTimeoutError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isTimeoutError(new Error("Resend rejected the recipient"))).toBe(false);
    expect(isTimeoutError("not an error")).toBe(false);
  });

  it("has distinct copy for 'took too long' versus a build failure", () => {
    expect(EMAIL_REPORT_TIMEOUT_MESSAGE).toContain("took too long");
    expect(EMAIL_REPORT_TIMEOUT_MESSAGE).toContain("was not sent");
    expect(EMAIL_REPORT_TIMEOUT_MESSAGE).not.toBe(PDF_DOWNLOAD_FAILURE_MESSAGE);
  });
});
