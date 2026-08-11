import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FreshnessBadge,
  ReportNavigationLinks,
  type ReportNavigationItem,
} from "@/components/report/ReportNavigationLinks";

describe("FreshnessBadge", () => {
  it("renders nothing without a verification date", () => {
    expect(renderToStaticMarkup(<FreshnessBadge lastVerifiedAt={null} />)).toBe(
      "",
    );
  });

  it("shows a verified label for fresh data", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge lastVerifiedAt="2026-07-15T00:00:00Z" />,
    );
    expect(html).toContain("Verified Jul 2026");
  });

  it("flags stale data as unverified", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge lastVerifiedAt="2024-01-15T00:00:00Z" isStale />,
    );
    expect(html).toContain("Unverified since Jan 2024");
  });
});

describe("ReportNavigationLinks", () => {
  const baseItem: ReportNavigationItem = { label: "SBIF", value: "Matched" };

  it("renders nothing when there are no links at all", () => {
    expect(
      renderToStaticMarkup(<ReportNavigationLinks item={baseItem} />),
    ).toBe("");
  });

  it("renders the official source from the item", () => {
    const html = renderToStaticMarkup(
      <ReportNavigationLinks
        item={{
          ...baseItem,
          sourceUrl: "https://example.org/sbif",
          sourceLabel: "City of Chicago",
        }}
      />,
    );
    expect(html).toContain("https://example.org/sbif");
    expect(html).toContain("City of Chicago source");
  });

  it("renders portals and verification steps, dropping url-less entries", () => {
    const html = renderToStaticMarkup(
      <ReportNavigationLinks
        item={{
          ...baseItem,
          applicationPortals: [
            { type: "web", label: "Apply online", url: "https://example.org/apply" },
            { type: "web", label: "No link portal", url: "" },
          ],
          verificationSteps: [
            {
              label: "Confirm boundary",
              url: "https://example.org/verify",
              agency: "DPD",
              kind: "preapproval",
              note: "Bring your PIN",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Application Portals");
    expect(html).toContain("Apply online");
    expect(html).not.toContain("No link portal");
    expect(html).toContain("Suggested Next Steps");
    expect(html).toContain("Confirm boundary");
    expect(html).toContain("— DPD");
    expect(html).toContain("Bring your PIN");
  });
});
