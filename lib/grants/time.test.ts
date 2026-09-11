import { expect, it } from "vitest";
import { instantFromLocal, localTime } from "./time";
it("records Chicago deadlines with the correct summer and winter offset", () => {
  expect(instantFromLocal("2026-09-18T22:59", "America/Chicago")).toBe(
    "2026-09-19T03:59:00.000Z",
  );
  expect(instantFromLocal("2026-11-13T23:59", "America/Chicago")).toBe(
    "2026-11-14T05:59:00.000Z",
  );
  expect(localTime("2026-11-14T05:59:00.000Z", "America/Chicago")).toBe(
    "2026-11-13T23:59",
  );
});
it("rejects a nonexistent time at the daylight-saving transition", () =>
  expect(() => instantFromLocal("2026-03-08T02:30", "America/Chicago")).toThrow(
    "does not exist",
  ));
