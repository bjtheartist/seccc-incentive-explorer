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
 * review6 S14 (HIGH): "expand the negative-determination grammar" — six
 * named families the S4 pass didn't cover, each with contractions and/or
 * passive constructions: "not qualified", "does not/cannot qualify",
 * "appears ineligible", "fails requirements", "cannot/will not
 * receive/be approved/be accepted", "application/project denied". Table-
 * driven per the coordinator's TEST requirement, one assertion per named
 * phrase, plus a dedicated near-miss table proving genuinely
 * informational sentences (not a claim about THIS reader) never trip.
 */
describe("validateConciergeOutput — S14 expanded negative-determination grammar families", () => {
  const FAMILY_PHRASES: { family: string; text: string; reason: string }[] = [
    // "not qualified" (adjectival)
    { family: "not qualified", text: "You're not qualified for the SBIF grant.", reason: "you-not-qualified" },
    { family: "not qualified", text: "You are not qualified for this program.", reason: "you-not-qualified" },
    { family: "not qualified", text: "Your business is not qualified for TIF financing.", reason: "business-not-qualified" },
    { family: "not qualified", text: "Your business not qualified — sorry.", reason: "business-not-qualified" },
    // "does not/cannot qualify"
    { family: "cannot qualify", text: "You cannot qualify for the Enterprise Zone exemption.", reason: "you-cannot-qualify" },
    { family: "cannot qualify", text: "You can't qualify for NOF funding.", reason: "you-cannot-qualify" },
    { family: "cannot qualify", text: "Your business does not qualify for this grant.", reason: "business-does-not-qualify" },
    { family: "cannot qualify", text: "Your business doesn't qualify for TIF financing.", reason: "business-does-not-qualify" },
    { family: "cannot qualify", text: "Your business cannot qualify for the SBIF program.", reason: "business-does-not-qualify" },
    { family: "cannot qualify", text: "Your business can't qualify for this round.", reason: "business-does-not-qualify" },
    // "appears ineligible"
    { family: "appears ineligible", text: "This location appears ineligible for the program.", reason: "appears-ineligible" },
    { family: "appears ineligible", text: "It appears to be ineligible for NOF funding.", reason: "appears-ineligible" },
    { family: "appears ineligible", text: "Based on your address, you appear not eligible for this grant.", reason: "appears-ineligible" },
    // "fails requirements"
    { family: "fails requirements", text: "You fail the requirements for this grant.", reason: "fails-requirements" },
    { family: "fails requirements", text: "You fail to meet the requirements for TIF financing.", reason: "fails-requirements" },
    { family: "fails requirements", text: "Your application fails the requirements for this program.", reason: "fails-requirements" },
    { family: "fails requirements", text: "Your project fails to meet requirements for this round.", reason: "fails-requirements" },
    // "cannot/will not receive/be approved/be accepted"
    { family: "cannot receive/approved/accepted", text: "You will not receive any funding from this program.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You will never receive this incentive.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You won't receive the full grant amount.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You cannot be approved for this program.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You can't be approved for TIF financing.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You cannot be accepted into this round.", reason: "you-will-not-receive" },
    { family: "cannot receive/approved/accepted", text: "You won't be accepted for this program.", reason: "you-will-not-receive" },
    // passive tenses of the existing "you've been denied/rejected" claim
    { family: "you were denied (passive tense)", text: "You were denied for this program.", reason: "denied-claim" },
    { family: "you were denied (passive tense)", text: "You are denied for the SBIF grant.", reason: "denied-claim" },
    { family: "you were denied (passive tense)", text: "You will be rejected for this round.", reason: "denied-claim" },
    // "application/project denied"
    { family: "application/project denied", text: "Your application was denied.", reason: "application-denied" },
    { family: "application/project denied", text: "Your application has been denied for this program.", reason: "application-denied" },
    { family: "application/project denied", text: "Your project is denied for TIF financing.", reason: "application-denied" },
    { family: "application/project denied", text: "Your request will be denied.", reason: "application-denied" },
    { family: "application/project denied", text: "Your application was rejected.", reason: "application-denied" },
    { family: "application/project denied", text: "The application was denied.", reason: "application-denied" },
    { family: "application/project denied", text: "The project has been rejected.", reason: "application-denied" },
  ];

  for (const { family, text, reason } of FAMILY_PHRASES) {
    it(`[${family}] rejects: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(true);
      expect(result.reason, text).toBe(reason);
    });
  }

  /**
   * Near-miss safe-language controls — the coordinator's own named
   * example ("the program requires X" must NOT trip) plus one control
   * per new family, all sentences that describe a published rule or a
   * GENERIC/third-party fact rather than asserting anything about THIS
   * reader. These must pass straight through (hit: false) — a validator
   * that trips on these would make ordinary, safe informational answers
   * unusable.
   */
  const SAFE_NEAR_MISSES: { label: string; text: string }[] = [
    { label: "coordinator's named example", text: "The program requires a minimum investment of $50,000." },
    { label: "generic requirement, not a reader claim", text: "This grant requires proof of ownership before you apply." },
    { label: "third-party subject, not 'you'/'your business'", text: "Some applicants are not qualified for this round due to timing." },
    { label: "informational, not this reader's outcome", text: "Common reasons applications fail: missing required documents." },
    { label: "'requirements' as a noun the reader must satisfy, not a claim they failed to", text: "Review the eligibility requirements before you apply." },
    { label: "'qualify' describing the program category, not the reader", text: "This program does not qualify as a direct cash grant — it is a tax credit." },
    { label: "'appears' used descriptively, no eligibility claim", text: "The parcel appears to be zoned for commercial use." },
    { label: "'denied' in an unrelated, non-determination context", text: "Access to the online portal was denied due to a login error." },
    { label: "third-party application, not the reader's own", text: "Other applications were denied last cycle for missing paperwork." },
  ];

  for (const { label, text } of SAFE_NEAR_MISSES) {
    it(`[safe near-miss: ${label}] does NOT reject: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(false);
    });
  }
});

/**
 * review7 S19(a) (HIGH): review6 S14 removed "qualify" from the "will
 * not/never receive/be approved/be accepted" pattern, on the stated
 * assumption the new "cannot/does not qualify" family would cover the
 * ground it gave up — it didn't. The FUTURE-TENSE/contraction forms
 * ("will not qualify", "will never qualify", "won't qualify") were
 * caught before S14 and silently stopped being caught after. Table-
 * driven per the coordinator's TEST requirement: all three missed forms.
 */
describe("validateConciergeOutput — S19(a) restored future/contraction 'qualify' forms", () => {
  const MISSED_QUALIFY_FORMS: { text: string; reason: string }[] = [
    { text: "You will not qualify for the Enterprise Zone exemption.", reason: "you-will-not-qualify" },
    { text: "You will never qualify for NOF funding.", reason: "you-will-not-qualify" },
    { text: "You won't qualify for TIF financing.", reason: "you-will-not-qualify" },
  ];

  for (const { text, reason } of MISSED_QUALIFY_FORMS) {
    it(`rejects the previously-missed form: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(true);
      expect(result.reason, text).toBe(reason);
    });
  }

  // Sanity: the S14 "cannot qualify" family and the S4 "will not
  // receive" family (with "qualify" removed) both still work correctly
  // alongside this new one — the fix didn't reintroduce the overlap S14
  // deliberately removed.
  it("'you cannot qualify' still hits the S14 modal family, not this one", () => {
    const result = validateConciergeOutput("You cannot qualify for the SBIF grant.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-cannot-qualify");
  });

  it("'you will not receive' (no 'qualify') still hits the S4/S14 receive family", () => {
    const result = validateConciergeOutput("You will not receive any funding from this program.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("you-will-not-receive");
  });
});

/**
 * review7 S19(b) (HIGH): review6 S16's "application/project denied" fix
 * required "your" OR "the" before the noun — closing the fully-optional-
 * article false positive it was reviewed for, but "the application ...
 * denied" is STILL ambiguous on its own: it can mean the reader's own
 * submission, or someone else's relayed in reported speech ("Jane said
 * the application was denied last cycle" — the coordinator's own named
 * example). `findApplicationDeniedViolation` restricts the definite-
 * article form to reader context via a reported-speech-marker exclusion,
 * sentence by sentence; "your X" (no article ambiguity) is unaffected.
 */
describe("validateConciergeOutput — S19(b) definite-article application-denied restricted to reader context", () => {
  it("still rejects 'your application was denied' — no article ambiguity", () => {
    const result = validateConciergeOutput("Your application was denied.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("application-denied");
  });

  it("still rejects a bare 'the application was denied' with no third-party framing", () => {
    const result = validateConciergeOutput("The application was denied last cycle.");
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("application-denied");
  });

  const THIRD_PARTY_DEFINITE_ARTICLE_CONTROLS: string[] = [
    "Jane said the application was denied last cycle.",
    "My accountant told me the application was denied.",
    "According to the newsletter, the project was rejected last quarter.",
    "A neighboring business owner mentioned the request was denied.",
    "The city clerk reported the application was denied for missing paperwork.",
    "I heard the project was rejected, but I haven't confirmed it.",
  ];

  for (const text of THIRD_PARTY_DEFINITE_ARTICLE_CONTROLS) {
    it(`does NOT reject the coordinator's third-party control shape: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(false);
    });
  }

  it("a reported-speech marker in an EARLIER, separate sentence does not excuse a LATER sentence's genuine reader-facing denial claim", () => {
    const result = validateConciergeOutput(
      "Jane said she had a similar situation last year. The application was denied for your case specifically.",
    );
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("application-denied");
  });
});

/**
 * review8 S25 (HIGH): the reported-speech marker list above only covered
 * past-tense/one-off forms (said/told/mentioned/reported/noted/stated/
 * wrote/explained) — a present-tense report like "the program guide
 * says/explains that the application was denied in the example" wasn't
 * recognized, so it was wrongly rejected as a reader-facing denial claim.
 * Table-driven: every present-tense inflection of an already-covered verb
 * must be recognized (hit: false), while every genuine reader-facing
 * denial form from the S19(b) suite above must still be rejected
 * (hit: true, reason: "application-denied") — no over-correction.
 */
describe("validateConciergeOutput — S25 present-tense reported-speech inflections", () => {
  const SAFE_PRESENT_TENSE_DESCRIPTIONS: string[] = [
    "The program guide says the application was denied in the example.",
    "The program guide explains that the application was denied in the example.",
    "The FAQ notes that the application was denied in a similar case last year.",
    "The city website reports the application was denied for missing paperwork.",
    "The handbook states the application was denied when the deadline was missed.",
    "The memo tells readers the application was denied in that scenario.",
    "The article mentions the project was rejected during a prior round.",
    "The bulletin writes that the request was denied for incomplete documents.",
    "The summary indicates the application was denied for that applicant.",
    "The case study describes how the application was denied in a past cycle.",
  ];

  for (const text of SAFE_PRESENT_TENSE_DESCRIPTIONS) {
    it(`recognizes present-tense reported speech and does NOT reject: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(false);
    });
  }

  const READER_FACING_DENIAL_CONTROLS: Array<{ text: string; reason: string }> = [
    { text: "Your application was denied.", reason: "application-denied" },
    { text: "The application was denied last cycle.", reason: "application-denied" },
    { text: "Your project is denied for TIF financing.", reason: "application-denied" },
  ];

  for (const { text, reason } of READER_FACING_DENIAL_CONTROLS) {
    it(`still rejects the genuine reader-facing denial control: "${text}"`, () => {
      const result = validateConciergeOutput(text);
      expect(result.hit, text).toBe(true);
      expect(result.reason).toBe(reason);
    });
  }
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
