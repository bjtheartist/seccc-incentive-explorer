import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * review9 gate finding F8 — HomePageClient had no test file at all, so the
 * sunset of the third hero intent card (/qualify — "Answer Program Fit
 * Questions") was a pure regression risk with nothing pinning the
 * surviving two-card contract. Minimal render coverage only: the two
 * surviving cards' copy, and the absence of the removed card/link.
 */

// Drop framer-motion-only props (initial/animate/whileInView/etc.) —
// renderToStaticMarkup never runs effects anyway, so they're inert. Only
// the three tags HomePageClient actually uses (motion.div/.h1/.p) are
// mocked — same pattern as app/report/__tests__/report-page-live-renderer.test.tsx.
type MotionStubProps = Record<string, unknown> & { children?: React.ReactNode };
function stripMotionProps({
  children,
  initial: _initial,
  animate: _animate,
  whileInView: _whileInView,
  viewport: _viewport,
  transition: _transition,
  exit: _exit,
  ...rest
}: MotionStubProps) {
  return { children: children as React.ReactNode, rest };
}

vi.mock("framer-motion", () => ({
  motion: {
    div: (props: MotionStubProps) => {
      const { children, rest } = stripMotionProps(props);
      return <div {...rest}>{children}</div>;
    },
    h1: (props: MotionStubProps) => {
      const { children, rest } = stripMotionProps(props);
      return <h1 {...rest}>{children}</h1>;
    },
    p: (props: MotionStubProps) => {
      const { children, rest } = stripMotionProps(props);
      return <p {...rest}>{children}</p>;
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ priority: _priority, ...props }: Record<string, unknown>) => (
    <img {...props} alt={(props.alt as string) ?? ""} />
  ),
}));

vi.mock("@/components/lookup/AddressSearch", () => ({
  AddressSearch: () => <div data-testid="stub-address-search" />,
}));

import { HomePageClient } from "../HomePageClient";

function render() {
  return renderToStaticMarkup(
    <HomePageClient
      stats={{ programs: 24, neighborhoods: 12, zoneLayers: 8, answers: 14 }}
      featuredPrograms={[{ name: "TIF Districts", slug: "tif-districts" }]}
      featuredNeighborhoods={[{ name: "South Shore", slug: "south-shore" }]}
      featuredAnswers={[
        { question: "Is my business in a TIF district?", slug: "is-my-business-in-a-tif-district" },
      ]}
      tickerNames={["TIF Districts"]}
    />
  );
}

describe("HomePageClient — hero intent cards (gate finding F8)", () => {
  const html = render();

  it("renders the two surviving cards", () => {
    expect(html).toContain("Check an Address");
    expect(html).toContain("Find Commercial Space");
  });

  it("never renders the sunset program-fit card or an /qualify link", () => {
    expect(html).not.toContain("Answer Program Fit Questions");
    expect(html).not.toContain("Program Fit Questions");
    expect(html).not.toContain('href="/qualify"');
  });
});
