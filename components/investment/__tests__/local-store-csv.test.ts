import { describe, expect, it } from "vitest";
import { shortlistToCsv, type ShortlistRecord } from "../local-store";

describe("investment working-set CSV", () => {
  it("exports the persisted government funding purpose with each saved record", () => {
    const records: ShortlistRecord[] = [
      {
        id: "capital-1",
        recipient: "Example Builder",
        funderName: "City of Chicago",
        source: "cdg",
        governmentFundingPurpose: "capital_project",
        year: 2024,
        amountAwarded: 250_000,
        communityArea: "South Chicago",
        notes: "Review scope",
      },
      {
        id: "foundation-1",
        recipient: "Example Nonprofit",
        funderName: "Example Foundation",
        source: "foundation",
        governmentFundingPurpose: null,
        year: 2023,
        amountAwarded: 50_000,
        communityArea: "South Chicago",
        notes: "",
      },
    ];

    const csv = shortlistToCsv(records);

    expect(csv.split("\n")[0]).toBe(
      "Recipient,Funder,Program,Government funding purpose,Year,Awarded,Community area,Notes",
    );
    expect(csv).toContain(
      "Example Builder,City of Chicago,cdg,Capital projects,2024,250000,South Chicago,Review scope",
    );
    expect(csv).toContain(
      "Example Nonprofit,Example Foundation,foundation,Not government,2023,50000,South Chicago,",
    );
  });

  it("does not label a legacy record 'Not government' when nothing was recorded", () => {
    // A record saved before `governmentFundingPurpose` existed has the key
    // ABSENT, not null, and readShortlist validates only `id` so it survives
    // the round-trip unchanged. The old two-way ternary sent it down the same
    // branch as an explicit null and exported a City of Chicago award
    // asserting it was not government money.
    const legacy = {
      id: "legacy-1",
      recipient: "Example Builder",
      funderName: "City of Chicago",
      source: "cdg",
      year: 2024,
      amountAwarded: 250_000,
      communityArea: "South Chicago",
      notes: "",
    } as ShortlistRecord;

    // The distinction the fix rests on: absent survives JSON, null survives too.
    expect(Object.hasOwn(legacy, "governmentFundingPurpose")).toBe(false);
    expect(JSON.parse(JSON.stringify(legacy))).not.toHaveProperty(
      "governmentFundingPurpose",
    );

    const csv = shortlistToCsv([legacy]);
    expect(csv).not.toContain("Not government");
    expect(csv).toContain("Not recorded (saved before this field existed)");
  });

  it("keeps all three states distinguishable in one export", () => {
    const base = {
      recipient: "R", funderName: "F", source: "cdg",
      year: 2024, amountAwarded: 1, communityArea: "X", notes: "",
    };
    const csv = shortlistToCsv([
      { ...base, id: "a", governmentFundingPurpose: "capital_project" },
      { ...base, id: "b", governmentFundingPurpose: null },
      { ...base, id: "c" } as ShortlistRecord,
    ]);
    expect(csv).toContain("Capital projects");
    expect(csv).toContain("Not government");
    expect(csv).toContain("Not recorded");
  });
});
