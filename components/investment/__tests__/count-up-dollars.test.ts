import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountUpDollars, easeOutCubic, countUpValue } from "@/components/investment/CountUpDollars";
import { formatFullDollars } from "@/components/investment/format";

describe("easeOutCubic", () => {
  it("pins the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("clamps out-of-range clocks instead of overshooting", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("is the cubic ease-out at the midpoint and rises monotonically", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10); // 1 - (1-0.5)^3
    const samples = [0, 0.25, 0.5, 0.75, 1].map(easeOutCubic);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    // ease-OUT: more distance is covered early than late
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("countUpValue", () => {
  it("starts at 0 and lands exactly on the target", () => {
    expect(countUpValue(1_310_000_000, 0)).toBe(0);
    expect(countUpValue(1_310_000_000, 1)).toBe(1_310_000_000);
  });

  it("returns rounded integers mid-flight (no fractional cents)", () => {
    const v = countUpValue(1_234_567, 0.5);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBe(Math.round(1_234_567 * 0.875));
  });

  it("formats the final frame to the same grouped string as the static hero", () => {
    expect(formatFullDollars(countUpValue(1_234_567, 1))).toBe("$1,234,567");
    expect(formatFullDollars(countUpValue(1_310_000_000, 1))).toBe("$1,310,000,000");
  });
});

describe("CountUpDollars SSR fallback", () => {
  it("server-renders the final value so there is no layout shift or hydration mismatch", () => {
    const html = renderToStaticMarkup(createElement(CountUpDollars, { value: 1_310_000_000 }));
    expect(html).toContain("$1,310,000,000");
    expect(html).not.toContain("$0"); // never the pre-animation zero on the server
  });
});
