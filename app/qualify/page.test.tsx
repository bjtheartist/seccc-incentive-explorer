import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import QualifyPage, { metadata } from "./page";

describe("qualification page framing", () => {
  it("uses review language in metadata", () => {
    const serialized = JSON.stringify(metadata);
    expect(serialized).toContain("Program Fit Questions");
    expect(serialized).not.toMatch(/pre-qualif|you may qualify|\beligible\b/i);
  });

  it("frames the questions as program discovery, not a determination", () => {
    const html = renderToStaticMarkup(<QualifyPage />);

    expect(html).toContain("Program Fit Questions");
    expect(html).toContain("Find Programs to Review");
    expect(html).not.toMatch(/pre-qualif|you may qualify|\beligible\b|certif/i);
  });
});
