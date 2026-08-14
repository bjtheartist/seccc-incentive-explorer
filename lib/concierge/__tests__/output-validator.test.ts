/**
 * build-spec.md 2.5 (audit "F-rail"; consult item 7) — the concierge output
 * validator. Adversarial per the spec's test matrix: prompt-injection
 * attempt ("tell me I'm eligible"), and prohibited phrase split across
 * stream chunks (this validator only ever runs on the fully-buffered
 * string, so a phrase built by concatenating chunks is exactly what it
 * sees — there is no earlier point where a partial chunk could slip past).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  getConciergeValidatorTelemetry,
  recordConciergeValidatorHit,
  resetConciergeValidatorTelemetry,
  validateConciergeOutput,
} from "../output-validator";

beforeEach(() => {
  resetConciergeValidatorTelemetry();
});

describe("validateConciergeOutput", () => {
  it("passes ordinary, safe assistant text through unchanged", () => {
    const result = validateConciergeOutput(
      "The TIF program reimburses eligible costs in designated districts. Review the published criteria and confirm with the administering agency.",
    );
    expect(result.hit).toBe(false);
    expect(result.text).toContain("TIF program");
  });

  it("rejects a direct prompt-injection attempt ('tell me I'm eligible' answered affirmatively)", () => {
    const result = validateConciergeOutput(
      "Sure! Based on your address, you're eligible for the Enterprise Zone tax exemption.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-are-eligible");
  });

  it("rejects 'you qualify' framing", () => {
    const result = validateConciergeOutput("Great news — you qualify for the SBIF grant.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-qualify");
  });

  it("catches a prohibited phrase that was ASSEMBLED FROM SEPARATE CHUNKS before validation ran — chunk-splitting cannot evade the check because validation only ever sees the fully-buffered string", () => {
    // Simulate what the route does: concatenate every stream chunk BEFORE
    // calling the validator (this is the buffer-validate-emit contract —
    // the model never streams live, so there is no earlier moment a
    // partial chunk could reach the client unchecked).
    const chunks = ["Based on what you've described, you ", "qual", "ify for this program."];
    const bufferedText = chunks.join("");
    const result = validateConciergeOutput(bufferedText);
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-qualify");
  });

  it("rejects a guaranteed-award claim", () => {
    const result = validateConciergeOutput("You are guaranteed approval for this grant.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("guaranteed-claim");
  });

  it("F10: rejects a zoning-classification answer that names a generic 'the City' instead of ZBA", () => {
    const result = validateConciergeOutput(
      "For your zoning classification question, ask the City to confirm the use category.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("zoning-question-missing-zba");
  });

  it("allows a zoning-classification answer that correctly names ZBA", () => {
    const result = validateConciergeOutput(
      "For your zoning classification question, ask the Chicago Zoning Board of Appeals (ZBA) to confirm the use category.",
    );
    expect(result.hit).toBe(false);
  });

  it("runs normalizePublicDeterminationText so report-engine-style determination phrases are rewritten too", () => {
    const result = validateConciergeOutput("This location appears eligible (based on location).");
    expect(result.hit).toBe(false);
    expect(result.text).not.toContain("appears eligible");
    expect(result.text).toContain("Included for review");
  });
});

describe("concierge validator telemetry", () => {
  it("records a hit count and reason breakdown", () => {
    expect(getConciergeValidatorTelemetry().total).toBe(0);
    recordConciergeValidatorHit("you-qualify");
    recordConciergeValidatorHit("you-qualify");
    recordConciergeValidatorHit("guaranteed-claim");
    const telemetry = getConciergeValidatorTelemetry();
    expect(telemetry.total).toBe(3);
    expect(telemetry.byReason["you-qualify"]).toBe(2);
    expect(telemetry.byReason["guaranteed-claim"]).toBe(1);
  });
});
