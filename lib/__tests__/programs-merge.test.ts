import { describe, expect, it } from "vitest";
import type { Program } from "../types";
import { preferStaticProgramDefinitions } from "../programs-merge";

function program(id: string, name: string, summary: string): Program {
  return {
    id,
    name,
    level: "City",
    zoneKey: id,
    summary,
    whoQualifies: "",
    benefits: [],
    howToApply: [],
    requiredDocs: [],
    contact: "",
    url: "",
  };
}

describe("preferStaticProgramDefinitions", () => {
  it("prevents stale database rows from overriding corrected static program copy", () => {
    const merged = preferStaticProgramDefinitions(
      [program("ssa", "Special Service Area (SSA)", "Generic citywide SSA copy.")],
      [program("ssa", "Special Service Area (SSA #50)", "Old Calumet Heights copy.")]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Special Service Area (SSA)");
    expect(merged[0].summary).not.toMatch(/SSA #50|Calumet Heights/i);
  });

  it("keeps DB-only programs after static definitions", () => {
    const merged = preferStaticProgramDefinitions(
      [program("ssa", "Special Service Area (SSA)", "Generic citywide SSA copy.")],
      [program("custom", "Custom Program", "DB-only program.")]
    );

    expect(merged.map((item) => item.id)).toEqual(["ssa", "custom"]);
  });
});
