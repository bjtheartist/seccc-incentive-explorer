import { describe, expect, it } from "vitest";

import {
  LEARNING_CHECK_TOTAL,
  LEARNING_LESSONS,
  LEARNING_MODULES,
  LEARNING_RAILS_NOTE,
  LEARNING_MINUTES_LABEL,
  lessonParagraphText,
  type Lesson,
} from "@/lib/learning-pathway";
import { LEARNING_FIGURES } from "@/lib/learning-pathway-figures";

/**
 * The lesson set used to be an 87 KB HTML file rendered in an iframe, and
 * the only test it could support counted `<article>` tags. These assertions
 * are what typed data bought: the shape of the pathway, and — more to the
 * point — that the narrative rewrite did not quietly drop a fact, a
 * statute cite, an agency name, or an official source on its way out of
 * the artifact.
 */

function lessonText(lesson: Lesson): string {
  return [
    lesson.title,
    ...lesson.body.map(lessonParagraphText),
    lesson.check.prompt,
    ...lesson.check.options.map((option) => option.text),
    lessonParagraphText(lesson.check.why),
  ].join("\n");
}

const ALL_TEXT = LEARNING_LESSONS.map(lessonText).join("\n");

describe("Learning Pathway structure", () => {
  it("keeps three modules and twelve lessons", () => {
    expect(LEARNING_MODULES).toHaveLength(3);
    expect(LEARNING_LESSONS).toHaveLength(12);
    expect(LEARNING_CHECK_TOTAL).toBe(12);
    expect(LEARNING_MODULES.map((item) => item.lessons.length)).toEqual([
      4, 4, 4,
    ]);
  });

  it("keeps the module titles and the published ~30 minute reading time", () => {
    expect(LEARNING_MODULES.map((item) => item.title)).toEqual([
      "Who actually decides",
      "Zoning and permitted uses",
      "Permits and opening",
    ]);
    expect(LEARNING_MINUTES_LABEL).toBe("~30");
  });

  it("keeps every lesson title's meaning from the artifact it replaced", () => {
    expect(LEARNING_LESSONS.map((lesson) => lesson.title)).toEqual([
      "Zoning isn't a form you file",
      "Three kinds of decision, three sets of manners",
      "What each body hands you",
      "Why a stranger knows about your permit",
      "Read the table, not the rumor",
      "Four symbols, four futures",
      "Three different asks to one board",
      "What a hearing actually is",
      "The cheapest lesson: when you need no permit",
      "Four tracks, and what sorts you into one",
      "Self-certification is a liability transfer",
      "Permit, occupancy, license: three finish lines",
    ]);
  });

  it("gives every lesson a unique, deep-linkable id and an L-code in order", () => {
    const ids = LEARNING_LESSONS.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/));

    expect(LEARNING_LESSONS.map((lesson) => lesson.code)).toEqual([
      "L1.1", "L1.2", "L1.3", "L1.4",
      "L2.1", "L2.2", "L2.3", "L2.4",
      "L3.1", "L3.2", "L3.3", "L3.4",
    ]);

    for (const learningModule of LEARNING_MODULES) {
      for (const lesson of learningModule.lessons) {
        expect(lesson.moduleId).toBe(learningModule.id);
      }
    }
  });
});

describe("the twelve checks", () => {
  it("each offer three options with exactly one correct answer", () => {
    for (const lesson of LEARNING_LESSONS) {
      expect(lesson.check.options).toHaveLength(3);
      expect(lesson.check.options.map((option) => option.key)).toEqual([
        "A",
        "B",
        "C",
      ]);
      const correct = lesson.check.options.filter((option) => option.correct);
      expect(correct, `${lesson.code} correct-answer count`).toHaveLength(1);
    }
  });

  it("open the explanation with the letter of the correct option", () => {
    for (const lesson of LEARNING_LESSONS) {
      const correct = lesson.check.options.find((option) => option.correct)!;
      expect(lessonParagraphText(lesson.check.why).startsWith(`${correct.key}.`)).toBe(
        true,
      );
    }
  });
});

describe("official sources survive the rewrite", () => {
  it("every lesson links at least one https source from the administering body", () => {
    for (const lesson of LEARNING_LESSONS) {
      expect(lesson.sources.length, `${lesson.code} sources`).toBeGreaterThan(0);
      for (const source of lesson.sources) {
        expect(source.label.trim().length).toBeGreaterThan(0);
        expect(source.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("carries forward every official URL the artifact linked", () => {
    const urls = new Set(
      LEARNING_LESSONS.flatMap((lesson) => lesson.sources.map((s) => s.url)),
    );
    for (const url of [
      "https://www.chicago.gov/city/en/sites/chicago-business-licensing/home/license-application-requirements.html",
      "https://www.chicago.gov/city/en/depts/bacp/supp_info/zoning.html",
      "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
      "https://www.chicago.gov/content/dam/city/depts/dol/rulesandregs/ZBA-Rules-of-Procedure-2025.pdf",
      "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits.html",
      "https://www.ic3.gov/PSA/2026/PSA260309",
      "https://www.ic3.gov",
      "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48750",
      "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-49164",
      "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-51987",
      "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/no-permit-reqd.html",
      "https://www.chicago.gov/city/en/sites/guide-to-building-permits/home/help/faq/DOB/bldg-permit-not-required/all.html",
      "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/self-cert-permits.html",
      "https://www.chicago.gov/city/en/depts/bldgs/supp_info/certificate-of-occupancy.html",
      "https://www.chicago.gov/city/en/depts/bldgs/provdrs/inspect/svcs/permit_inspection.html",
    ]) {
      expect(urls, `${url} must still be linked`).toContain(url);
    }
  });

  it("still tells the reader to verify before spending money", () => {
    expect(LEARNING_RAILS_NOTE).toContain(
      "Verify with the administering agency before spending money",
    );
    expect(LEARNING_RAILS_NOTE).toContain(
      "not legal, tax, or financial advice",
    );
  });
});

describe("no fact, number, agency, or legal term was lost in the rewrite", () => {
  it.each([
    "Department of Business Affairs and Consumer Protection",
    "Department of Buildings",
    "Zoning Board of Appeals",
    "Zoning Administrator",
    "ex parte",
    "findings of fact",
    "Property Index Number",
    "PIN",
    "use category",
    "§ 17-13-0900",
    "§ 17-13-0600",
    "nonconforming use",
    "means of egress",
    "November 2023",
    "Standard Plan Review",
    "Express Permit Program",
    "Developer Services",
    "Self-Certified Permit Application Program",
    "design professional of record",
    "Illinois-licensed architect or structural engineer",
    "Chicago building code",
    "Certificate of Occupancy",
    "change of occupancy",
    "FBI",
  ])("still says %s", (phrase) => {
    expect(ALL_TEXT).toContain(phrase);
  });
});

describe("the ported diagrams", () => {
  it("keeps all ten, each attached to a real lesson at a real paragraph", () => {
    expect(Object.keys(LEARNING_FIGURES)).toHaveLength(10);

    const withFigures = LEARNING_LESSONS.filter(
      (lesson) => lesson.figureAfterParagraph !== undefined,
    );
    expect(withFigures).toHaveLength(10);

    for (const lesson of withFigures) {
      const figure = LEARNING_FIGURES[lesson.id];
      expect(figure, `${lesson.code} figure`).toBeDefined();
      expect(figure.alt.length).toBeGreaterThan(40);
      expect(figure.viewBox).toMatch(/^0 0 \d+ \d+$/);
      expect(figure.markup.length).toBeGreaterThan(100);
      expect(lesson.figureAfterParagraph!).toBeGreaterThan(0);
      expect(lesson.figureAfterParagraph!).toBeLessThanOrEqual(lesson.body.length);
    }

    // No orphan diagrams: every figure key is a lesson id.
    const lessonIds = new Set(LEARNING_LESSONS.map((lesson) => lesson.id));
    for (const key of Object.keys(LEARNING_FIGURES)) {
      expect(lessonIds.has(key), `${key} must be a lesson id`).toBe(true);
    }
  });

  it("keeps the four current permit programs named inside the L3.2 diagram", () => {
    const markup = LEARNING_FIGURES["four-permit-tracks"].markup;
    expect(markup).toContain("Express Permit Program");
    expect(markup).toContain("Self-Certified Permit");
    expect(markup).toContain("Standard Plan Review");
    expect(markup).toContain("Developer Services");
    expect(markup).toContain("Easy Permit Program — retired November 2023");
  });

  it("keeps marker ids unique and every marker reference resolvable", () => {
    const ids: string[] = [];
    const references: string[] = [];
    for (const figure of Object.values(LEARNING_FIGURES)) {
      for (const match of figure.markup.matchAll(/<marker id="([^"]+)"/g)) {
        ids.push(match[1]);
      }
      for (const match of figure.markup.matchAll(
        /marker-(?:start|mid|end)="url\(#([^)]+)\)"/g,
      )) {
        references.push(match[1]);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    const markerIds = new Set(ids);
    references.forEach((reference) => expect(markerIds.has(reference)).toBe(true));
  });
});

describe("the lessons read as prose, not as lists of statements", () => {
  it("gives every lesson multiple paragraphs of real text", () => {
    for (const lesson of LEARNING_LESSONS) {
      expect(lesson.body.length, `${lesson.code} paragraphs`).toBeGreaterThanOrEqual(3);
      for (const paragraph of lesson.body) {
        expect(lessonParagraphText(paragraph).trim().length).toBeGreaterThan(40);
      }
    }
  });

  it("carries an explicit causal connective in every lesson", () => {
    // The rewrite's whole point: each lesson explains why one thing leads
    // to another rather than stacking independent assertions.
    const causal =
      /\b(because|so that|so the|which is why|which means|so\b|therefore|that is why|since|follows from|it follows|as a result|and that)\b/i;
    for (const lesson of LEARNING_LESSONS) {
      const text = lesson.body.map(lessonParagraphText).join(" ");
      expect(causal.test(text), `${lesson.code} causal connective`).toBe(true);
    }
  });
});
