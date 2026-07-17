import { describe, expect, it } from "vitest";
import { batchPins, pinInClause, toDashedPin, toDigitsOnlyPin, DEFAULT_PIN_BATCH_SIZE } from "../pin-batch";

describe("batchPins", () => {
  it("splits into chunks of the default batch size", () => {
    const pins = Array.from({ length: DEFAULT_PIN_BATCH_SIZE + 1 }, (_, i) => `pin${i}`);
    const batches = batchPins(pins);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(DEFAULT_PIN_BATCH_SIZE);
    expect(batches[1]).toHaveLength(1);
  });

  it("respects a custom batch size and preserves order", () => {
    const pins = ["a", "b", "c", "d", "e"];
    const batches = batchPins(pins, 2);
    expect(batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("exactly fills the last batch with no trailing empty chunk", () => {
    const pins = ["a", "b", "c", "d"];
    expect(batchPins(pins, 2)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("trims and drops blank/whitespace-only entries", () => {
    expect(batchPins([" 123 ", "", "   ", "456"], 10)).toEqual([["123", "456"]]);
  });

  it("returns an empty array for an empty or all-blank input", () => {
    expect(batchPins([])).toEqual([]);
    expect(batchPins(["", "  "])).toEqual([]);
  });

  it("single batch when batchSize exceeds the pin count", () => {
    expect(batchPins(["a", "b"], 400)).toEqual([["a", "b"]]);
  });
});

describe("pinInClause", () => {
  it("quotes and joins pins for a SoQL `pin in(...)` fragment", () => {
    expect(pinInClause(["17-21-321-018-0000", "07-18-411-025-0000"])).toBe(
      "pin in('17-21-321-018-0000','07-18-411-025-0000')"
    );
  });

  it("escapes an embedded single quote per SoQL string-literal rules", () => {
    expect(pinInClause(["O'Brien-pin"])).toBe("pin in('O''Brien-pin')");
  });

  it("handles a single-pin batch", () => {
    expect(pinInClause(["17-21-321-018-0000"])).toBe("pin in('17-21-321-018-0000')");
  });
});

describe("toDashedPin", () => {
  it("dashes a 14-digit digits-only PIN into 2-2-3-3-4 groups", () => {
    expect(toDashedPin("17213210180000")).toBe("17-21-321-018-0000");
  });

  it("dashes the verified live example PINs", () => {
    expect(toDashedPin("07184110250000")).toBe("07-18-411-025-0000");
  });

  it("passes through input that isn't exactly 14 digits unchanged", () => {
    expect(toDashedPin("123")).toBe("123");
    expect(toDashedPin("")).toBe("");
    expect(toDashedPin("17-21-321-018-0000")).toBe("17-21-321-018-0000");
  });
});

describe("toDigitsOnlyPin", () => {
  it("strips dashes back to the parcels.pin digits-only convention", () => {
    expect(toDigitsOnlyPin("17-21-321-018-0000")).toBe("17213210180000");
  });

  it("is a no-op on an already digits-only PIN", () => {
    expect(toDigitsOnlyPin("17213210180000")).toBe("17213210180000");
  });

  it("round-trips with toDashedPin for a well-formed 14-digit PIN", () => {
    const pin = "02152010351009";
    expect(toDigitsOnlyPin(toDashedPin(pin))).toBe(pin);
  });
});
