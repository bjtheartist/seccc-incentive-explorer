/**
 * build-spec.md 2.5 (audit "F-rail"; consult item 7) — the concierge output
 * validator. Adversarial per the spec's test matrix: prompt-injection
 * attempt ("tell me I'm eligible"), and prohibited phrase split across
 * stream chunks (this validator only ever runs on the fully-buffered
 * string, so a phrase built by concatenating chunks is exactly what it
 * sees — there is no earlier point where a partial chunk could slip past).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getConciergeValidatorTelemetry,
  recordConciergeValidatorHit,
  resetConciergeValidatorLogEmitter,
  resetConciergeValidatorTelemetry,
  setConciergeValidatorLogEmitter,
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

  it("review5 S4: 'appears eligible' is now a hard REJECT, not a soft rewrite — the coordinator named this phrase explicitly as a required rejection, superseding the old normalize-and-pass-through behavior", () => {
    const result = validateConciergeOutput("This location appears eligible (based on location).");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("appears-eligible");
  });

  it("runs normalizePublicDeterminationText so OTHER report-engine-style determination phrases are still softly rewritten (not every phrase that normalizer handles is on the hard-reject list)", () => {
    const result = validateConciergeOutput("This is a high match for the SBIF program.");
    expect(result.hit).toBe(false);
    expect(result.text).not.toContain("high match");
    expect(result.text).toContain("Program review");
  });
});

/**
 * review5 S4: "REJECT (fallback path) all reader-level positive AND
 * negative determinations on raw text before normalization" — the
 * adversarial phrase table verbatim from the coordinator's message, plus
 * the negative direction the original validator had no coverage for at
 * all. Table-driven so every named phrase gets its own assertion, not a
 * combined "one of these matched" check that could hide a gap.
 */
describe("validateConciergeOutput — S4 adversarial phrase table (both directions)", () => {
  const POSITIVE_PHRASES: { text: string; reason: string }[] = [
    { text: "Sure — you are eligible for the SBIF grant.", reason: "you-are-eligible" },
    { text: "This appears eligible for the Enterprise Zone exemption.", reason: "appears-eligible" },
    { text: "It appears to be eligible for NOF funding.", reason: "appears-eligible" },
    { text: "You qualify for the Enterprise Zone exemption.", reason: "you-qualify" },
    { text: "Your business is eligible for this program.", reason: "business-eligible" },
    { text: "You meet all requirements for the grant.", reason: "meets-requirements" },
    { text: "You meet the requirements for TIF financing.", reason: "meets-requirements" },
    { text: "This is a guaranteed award for your project.", reason: "guaranteed-claim" },
    { text: "You will receive the full grant amount.", reason: "you-will-receive" },
    { text: "You've been approved for the program.", reason: "approved-claim" },
    { text: "You are ready to apply right now.", reason: "ready-to-apply" },
    { text: "This unlocks the full incentive package.", reason: "unlocks" },
    { text: "Just verify your eligibility with the agency.", reason: "verify-eligibility" },
  ];

  const NEGATIVE_PHRASES: { text: string; reason: string }[] = [
    { text: "Unfortunately, you are ineligible for this program.", reason: "you-are-ineligible" },
    { text: "You're not eligible for the SBIF grant.", reason: "you-are-ineligible" },
    { text: "You do not qualify for the Enterprise Zone exemption.", reason: "you-do-not-qualify" },
    { text: "You don't qualify for NOF funding.", reason: "you-do-not-qualify" },
    { text: "Your business is not eligible for this program.", reason: "business-ineligible" },
    { text: "Your business is ineligible for TIF financing.", reason: "business-ineligible" },
    { text: "You do not meet requirements for the grant.", reason: "does-not-meet-requirements" },
    { text: "You don't meet the requirements for this program.", reason: "does-not-meet-requirements" },
    { text: "You will not receive any funding from this program.", reason: "you-will-not-receive" },
    { text: "You've been denied for the program.", reason: "denied-claim" },
    { text: "You've been rejected for this grant.", reason: "denied-claim" },
  ];

  for (const { text, reason } of POSITIVE_PHRASES) {
    it(`rejects positive determination: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(true);
      expect(result.reason, text).toBe(reason);
    });
  }

  for (const { text, reason } of NEGATIVE_PHRASES) {
    it(`rejects negative determination: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(true);
      expect(result.reason, text).toBe(reason);
    });
  }

  it("a negative determination buried in an otherwise-safe multi-sentence answer is still caught — the whole response is rejected, not just the offending clause", () => {
    const result = validateConciergeOutput(
      "The TIF program reimburses eligible costs in designated districts. Based on what you've told me, you do not qualify for this round. Consider reviewing other programs instead.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-do-not-qualify");
  });
});

/**
 * review5 S4: "authority check sentence-by-sentence (one ZBA mention must
 * not bypass a generic-City sentence elsewhere)" — the exact regression
 * the original whole-text `mentionsZba` check was vulnerable to.
 */
describe("validateConciergeOutput — S4 sentence-by-sentence authority check", () => {
  it("a correct ZBA mention in one sentence does NOT excuse a separate, later sentence's generic-City zoning claim", () => {
    const result = validateConciergeOutput(
      "For most zoning relief questions, the Chicago Zoning Board of Appeals (ZBA) is the right venue. " +
        "That said, for your specific zoning classification question, the City determines the use category directly.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("zoning-question-missing-zba");
  });

  it("a correct ZBA mention EARLIER in the same paragraph does not excuse a later, separate paragraph's violation", () => {
    const result = validateConciergeOutput(
      "The ZBA handles most zoning relief requests.\n\nSeparately, the City decides your permitted use for this address.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("zoning-question-missing-zba");
  });

  it("passes when EVERY zoning-question sentence that mentions a generic City also names ZBA within that same sentence", () => {
    const result = validateConciergeOutput(
      "For your zoning classification question, the Chicago Zoning Board of Appeals (ZBA), not the City generally, is the authority. " +
        "For your use category question, again ask the ZBA directly.",
    );
    expect(result.hit).toBe(false);
  });

  it("does not false-positive on a sentence that mentions neither zoning classification nor a generic City", () => {
    const result = validateConciergeOutput(
      "The TIF program reimburses eligible costs. Review the published criteria with the administering agency.",
    );
    expect(result.hit).toBe(false);
  });
});

describe("concierge validator — durable telemetry (review5 S4)", () => {
  afterEach(() => {
    resetConciergeValidatorLogEmitter();
  });

  it("emits a structured log line on every hit — durable (log write), not just an in-process counter", () => {
    const emitted: string[] = [];
    setConciergeValidatorLogEmitter((line) => emitted.push(line));

    recordConciergeValidatorHit("you-qualify");

    expect(emitted).toHaveLength(1);
    const parsed = JSON.parse(emitted[0]);
    expect(parsed.event).toBe("concierge_output_validator_hit");
    expect(parsed.reason).toBe("you-qualify");
    expect(typeof parsed.at).toBe("string");
    expect(Number.isNaN(new Date(parsed.at).getTime())).toBe(false);
  });

  it("logs every hit independently, in order, even across multiple reasons", () => {
    const emitted: string[] = [];
    setConciergeValidatorLogEmitter((line) => emitted.push(line));

    recordConciergeValidatorHit("you-qualify");
    recordConciergeValidatorHit("zoning-question-missing-zba");

    expect(emitted).toHaveLength(2);
    expect(JSON.parse(emitted[0]).reason).toBe("you-qualify");
    expect(JSON.parse(emitted[1]).reason).toBe("zoning-question-missing-zba");
  });

  it("the real (non-test) emitter writes to console.error, not console.log — never silently filtered out of a production log level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    resetConciergeValidatorLogEmitter();
    recordConciergeValidatorHit("you-qualify");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
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
