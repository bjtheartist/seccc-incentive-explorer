// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { PERMIT_EXHIBIT_ACCESS_SOURCE } from "@/lib/shortlist-access";
import { PERMIT_EXHIBIT_ACCESS_SOURCE_LITERAL } from "@/components/permit-exhibit/PermitExhibitAccessGate";

/**
 * PermitExhibitAccessGate.tsx cannot import PERMIT_EXHIBIT_ACCESS_SOURCE
 * from lib/shortlist-access.ts directly — that module's top-level
 * node:crypto import breaks the client webpack bundle the instant a "use
 * client" file imports anything from it (see the component's own doc
 * comment). It carries its own LITERAL copy of the string instead. This
 * test is the one thing standing between that literal and silent drift.
 */
describe("Permit Exhibit access gate source tag", () => {
  it("the client component's local literal matches lib/shortlist-access.ts's registered source exactly", () => {
    expect(PERMIT_EXHIBIT_ACCESS_SOURCE_LITERAL).toBe(PERMIT_EXHIBIT_ACCESS_SOURCE);
  });
});
