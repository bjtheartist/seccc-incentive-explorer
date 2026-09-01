import { describe, expect, it } from "vitest";
import { decodeCheckState, decodeWizardState } from "../url-state";

/**
 * R2 finding 6 — share-link residuals.
 *
 * A previous round fixed goal-id validation (`pg`/`pt` are checked against the
 * ids the wizard can actually produce) and capped `cg` at 240 characters, and
 * stopped there. Everything else a share link carries was still copied into
 * wizard state raw:
 *
 * - Eleven free-text params (`nbh`, `ind`, `bud`, `pu`, `fc`, `gap`, `tl`,
 *   `sc`, `jobs`, `addr`, `caddr`) with no length cap at all.
 * - `decodeArray` (`cta`, `docs`, `need`) returned every string in the
 *   base64-JSON payload, at any count and any length.
 * - `sa=` was `JSON.parse(atob(...))` straight into `state.surveyAnswers`,
 *   typed as `SurveyAnswers` on the way out, despite `SurveyAnswersSchema`
 *   already existing in lib/schemas.ts.
 *
 * All of it is attacker-writable, and all of it flows into the report engine,
 * into rendered report copy, and into saved-report jsonb.
 */

const HUGE = "x".repeat(5000);

/** `wv` is the wizard-link version gate; without it decodeWizardState bails. */
function wizardFrom(query: string) {
  const state = decodeWizardState(new URLSearchParams(`wv=1&${query}`));
  if (!state) throw new Error("decodeWizardState returned null for a versioned link");
  return state;
}

describe("free-text share params are length-capped", () => {
  it.each([
    ["nbh", "neighborhood"],
    ["ind", "industry"],
    ["bud", "budgetRange"],
    ["pu", "proposedUse"],
    ["fc", "fundingCommitted"],
    ["gap", "remainingGap"],
    ["tl", "timeline"],
    ["sc", "siteControl"],
    ["jobs", "jobsImpact"],
    ["addr", "address"],
    ["cg", "customGoal"],
  ])("%s is capped at 240 characters (-> %s)", (param, field) => {
    const state = wizardFrom(`${param}=${HUGE}`) as unknown as Record<string, string>;
    expect(state[field]).toHaveLength(240);
    expect(state[field]).toBe("x".repeat(240));
  });

  it("caddr (comparison address) is capped too", () => {
    expect(wizardFrom(`caddr=${HUGE}`).compareAddress).toHaveLength(240);
  });

  it("keeps ordinary values completely intact", () => {
    const state = wizardFrom("nbh=Chatham&ind=Manufacturing&addr=9300 S Drexel Ave&jobs=12");
    expect(state.neighborhood).toBe("Chatham");
    expect(state.industry).toBe("Manufacturing");
    expect(state.address).toBe("9300 S Drexel Ave");
    expect(state.jobsImpact).toBe("12");
  });

  it("caps the /check deep link's address and sector as well", () => {
    const state = decodeCheckState(
      new URLSearchParams(`lat=41.75&lon=-87.6&addr=${HUGE}&sector=${HUGE}`),
    );
    expect(state?.address).toHaveLength(240);
    expect(state?.sector).toHaveLength(240);
  });
});

describe("decodeArray output is count- and length-capped", () => {
  /** base64 can contain `+`, which a raw query string decodes as a space. */
  function encode(value: unknown): string {
    return encodeURIComponent(btoa(JSON.stringify(value)));
  }

  it.each(["cta", "docs", "need"])("%s is truncated to at most 32 entries", (param) => {
    // 200 short ids: well over the 32-entry cap, but still small enough
    // encoded that the separate oversized-payload guard is not what fires.
    const many = Array.from({ length: 200 }, (_, i) => `i${i}`);
    const state = wizardFrom(`${param}=${encode(many)}`) as unknown as Record<string, string[]>;
    const field = { cta: "creditsToAnalyze", docs: "documentsAvailable", need: "supportNeeded" }[
      param
    ]!;
    expect(state[field]).toHaveLength(32);
    expect(state[field]![0]).toBe("i0");
  });

  it("caps the length of each decoded entry", () => {
    const long = "x".repeat(600);
    const state = wizardFrom(`docs=${encode([long, "lease"])}`);
    expect(state.documentsAvailable[0]).toHaveLength(120);
    expect(state.documentsAvailable[1]).toBe("lease");
  });

  it("rejects an oversized encoded payload without decoding it", () => {
    const enormous = btoa(JSON.stringify(Array.from({ length: 20000 }, () => "pad")));
    expect(enormous.length).toBeGreaterThan(4096);
    expect(wizardFrom(`docs=${enormous}`).documentsAvailable).toEqual([]);
  });

  it("still decodes a normal, realistic list unchanged", () => {
    const state = wizardFrom(`docs=${encode(["lease", "tax-bill", "site-plan"])}`);
    expect(state.documentsAvailable).toEqual(["lease", "tax-bill", "site-plan"]);
  });

  it("still drops non-string entries", () => {
    const state = wizardFrom(`need=${encode(["financing", 42, null, { a: 1 }, "permits"])}`);
    expect(state.supportNeeded).toEqual(["financing", "permits"]);
  });
});

describe("sa= is validated against SurveyAnswersSchema", () => {
  /** Object form, so base64 `+` is never mangled into a space. */
  function sa(value: unknown): ReturnType<typeof decodeCheckState> {
    return decodeCheckState(
      new URLSearchParams({ lat: "41.75", lon: "-87.6", sa: btoa(JSON.stringify(value)) }),
    );
  }

  it("accepts a well-formed SurveyAnswers payload", () => {
    const state = sa({ industry: "manufacturing", property: "own", size: "10-50" });
    expect(state?.surveyAnswers).toEqual({
      industry: "manufacturing",
      property: "own",
      size: "10-50",
    });
  });

  it("rejects a payload whose fields are the wrong type", () => {
    expect(sa({ industry: 42 })?.surveyAnswers).toBeUndefined();
    expect(sa({ activities: "not-an-array" })?.surveyAnswers).toBeUndefined();
  });

  it("rejects a non-object payload outright", () => {
    expect(sa("just a string")?.surveyAnswers).toBeUndefined();
    expect(sa([1, 2, 3])?.surveyAnswers).toBeUndefined();
    expect(sa(null)?.surveyAnswers).toBeUndefined();
  });

  it("strips unknown keys instead of carrying arbitrary attacker JSON into state", () => {
    const state = sa({ industry: "retail", evil: "<script>alert(1)</script>", nested: { a: 1 } });
    expect(state?.surveyAnswers).toEqual({ industry: "retail" });
    expect(state?.surveyAnswers).not.toHaveProperty("evil");
    expect(state?.surveyAnswers).not.toHaveProperty("nested");
  });

  it("ignores an oversized encoded sa= without decoding it", () => {
    const enormous = btoa(JSON.stringify({ industry: HUGE.repeat(2) }));
    expect(enormous.length).toBeGreaterThan(4096);
    const state = decodeCheckState(
      new URLSearchParams({ lat: "41.75", lon: "-87.6", sa: enormous }),
    );
    expect(state?.surveyAnswers).toBeUndefined();
  });

  it("still ignores malformed base64 / non-JSON without throwing", () => {
    const state = decodeCheckState(new URLSearchParams("lat=41.75&lon=-87.6&sa=%%%not-base64%%%"));
    expect(state).not.toBeNull();
    expect(state?.surveyAnswers).toBeUndefined();
  });
});

describe("goal-id validation is unchanged", () => {
  it("still rejects an unknown goal id", () => {
    const state = wizardFrom("pt=not-a-real-goal");
    expect(state.projectType).toBe("");
    expect(state.projectGoals).toEqual([]);
  });

  it("still accepts a known goal id", () => {
    const state = wizardFrom("pt=expansion");
    expect(state.projectType).toBe("expansion");
    expect(state.projectGoals).toEqual(["expansion"]);
  });
});
