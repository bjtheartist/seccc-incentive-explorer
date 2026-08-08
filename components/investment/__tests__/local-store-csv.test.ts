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
});
