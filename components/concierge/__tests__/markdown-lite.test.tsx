import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownLite } from "@/components/concierge/MarkdownLite";

describe("MarkdownLite", () => {
  it("renders web and internal links while neutralizing protocol-relative links", () => {
    const html = renderToStaticMarkup(
      <MarkdownLite
        text={[
          "[Official](https://example.gov/program)",
          "[Report](/report)",
          "[Unsafe](//example.com/redirect)",
        ].join("\n")}
      />
    );

    expect(html).toContain('href="https://example.gov/program"');
    expect(html).toContain('href="/report"');
    expect(html).not.toContain('href="//example.com/redirect"');
    expect(html).toContain("Unsafe");
  });
});
