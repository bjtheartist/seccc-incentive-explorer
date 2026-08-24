import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import PermitActivityAreaPage, {
  dynamic,
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "./page";

interface PermitActivityAreaOption {
  id: number;
  name: string;
  slug: string;
}

async function renderPage(area: string) {
  return (await PermitActivityAreaPage({
    params: Promise.resolve({ area }),
  })) as ReactElement<{
    area: PermitActivityAreaOption;
    areas: PermitActivityAreaOption[];
  }>;
}

describe("permit activity neighborhood routes", () => {
  it("exposes exactly 77 unique, serializable community-area commands", () => {
    const params = generateStaticParams();
    const slugs = new Set(params.map(({ area }) => area));

    expect(params).toHaveLength(77);
    expect(slugs.size).toBe(77);
    expect(slugs).toContain("o-hare");
  });

  it("keeps the complete static route contract dynamic and closed", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(dynamicParams).toBe(false);
  });

  it("passes all commands and the canonical selected area to the brief", async () => {
    const page = await renderPage("o-hare");
    const ids = new Set(page.props.areas.map((area) => area.id));
    const slugs = new Set(page.props.areas.map((area) => area.slug));

    expect(page.props.area).toEqual({
      id: 76,
      name: "O'Hare",
      slug: "o-hare",
    });
    expect(page.props.areas).toHaveLength(77);
    expect(ids.size).toBe(77);
    expect(slugs.size).toBe(77);
    expect(page.props.areas).toContainEqual(page.props.area);
    expect(JSON.parse(JSON.stringify(page.props.areas))).toEqual(page.props.areas);
  });

  it("keeps neighborhood pages out of search indexing", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ area: "chatham" }),
    });

    expect(metadata).toMatchObject({
      title: "Permit Activity Analysis — Chatham",
      robots: { index: false, follow: false },
    });
  });
});
