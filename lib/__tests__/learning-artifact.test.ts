import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tier 1 learning artifact", () => {
  const html = readFileSync(
    join(process.cwd(), "public/learning/tier-one-lessons.html"),
    "utf8",
  );

  it("ships the complete authored lesson and question set", () => {
    expect(html.match(/<article>/g)).toHaveLength(12);
    expect(html.match(/<div class="fig">/g)).toHaveLength(10);
    expect(html.match(/<div class="q" data-q>/g)).toHaveLength(12);

    const questionStarts = [...html.matchAll(/<div class="q" data-q>/g)].map(
      (match) => match.index,
    );
    questionStarts.forEach((start, index) => {
      const end = questionStarts[index + 1] ?? html.length;
      const questionMarkup = html.slice(start, end);
      expect(
        questionMarkup.match(/<button class="opt" type="button" data-correct>/g),
      ).toHaveLength(1);
    });
  });

  it("keeps diagram marker identifiers unique and references intact", () => {
    const ids = [...html.matchAll(/<marker id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);

    const markerIds = new Set(ids);
    const references = [
      ...html.matchAll(/marker-(?:start|mid|end)="url\(#([^)]+)\)"/g),
    ].map((match) => match[1]);
    references.forEach((reference) => expect(markerIds.has(reference)).toBe(true));
  });

  it("presents the lessons as a branded, navigable learning course", () => {
    expect(html).toContain("Chicago Zoning &amp; Permit Essentials");
    expect(html).toContain("Chicago Incentive Explorer");
    expect(html).toContain('id="module-decisions"');
    expect(html).toContain('id="module-zoning"');
    expect(html).toContain('id="module-permits"');
    expect(html).toContain('id="courseProgress"');
    expect(html).toContain("Run an address report");
    expect(html).toContain("Southeast Chicago Chamber of Commerce");
  });
});
