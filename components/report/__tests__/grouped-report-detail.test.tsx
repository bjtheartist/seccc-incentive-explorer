import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupedReportDetail } from "@/components/report/GroupedReportDetail";
import { ProjectFitNote } from "@/components/report/ProjectFitNote";

describe("grouped report details", () => {
  it("renders transportation groups as semantic lists with a separate caveat", () => {
    const html = renderToStaticMarkup(
      <GroupedReportDetail
        summary="Strong public transit access"
        groups={[
          { id: "cta", label: "CTA rail", items: ["Western (Orange Line) · 0.9 mi"] },
          { id: "drive", label: "Drive access", items: ["Stevenson Expy (I-55) · 1.0 mi"] },
        ]}
        caveat="Distances are straight-line proximity signals."
      />,
    );

    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("<ul");
    expect(html).toContain("CTA rail");
    expect(html).toContain("Stevenson Expy (I-55)");
    expect(html).toContain("Distances are straight-line proximity signals.");
  });

  it("renders only plain-language project fit guidance", () => {
    const html = renderToStaticMarkup(
      <ProjectFitNote
        fit={{
          level: "strong",
          label: "Strong fit for hiring",
          reason: "This program directly supports the selected goal.",
        }}
      />,
    );

    expect(html).toContain("Strong fit for hiring");
    expect(html).not.toContain("score");
  });
});
