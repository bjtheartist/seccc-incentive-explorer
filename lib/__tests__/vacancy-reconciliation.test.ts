import { describe, expect, it, vi } from "vitest";
import {
  buildVacancyReconciliationPlan,
  reconcileVacancyMembership,
} from "@/lib/vacancy-reconciliation";

describe("vacancy source reconciliation", () => {
  const records = [
    { id: "311-SR26-1", source: "dpd_vacant" as const },
    { id: "311-clean-lot-SR26-2", source: "311_clean_lot" as const },
    { id: "cols-1", source: "cols" as const },
  ];

  it("permits pruning only after a complete pull", () => {
    expect(buildVacancyReconciliationPlan(records, true)).toEqual({
      complete: true,
      safeToPrune: true,
      retainedIds: ["311-SR26-1", "311-clean-lot-SR26-2"],
      managedSources: ["dpd_vacant", "311_clean_lot"],
    });
  });

  it("fails closed when pagination is partial", () => {
    expect(buildVacancyReconciliationPlan(records, false)).toMatchObject({
      complete: false,
      safeToPrune: false,
    });
  });

  it("supports an independently managed complete COLS snapshot", () => {
    expect(buildVacancyReconciliationPlan(records, true, ["cols"])).toEqual({
      complete: true,
      safeToPrune: true,
      retainedIds: ["cols-1"],
      managedSources: ["cols"],
    });
  });

  it("does not invoke the removal operation after a partial pull", async () => {
    const removeMissing = vi.fn().mockResolvedValue(99);
    await expect(
      reconcileVacancyMembership(records, false, removeMissing),
    ).resolves.toBe(0);
    expect(removeMissing).not.toHaveBeenCalled();
  });

  it("allows a complete zero-row pull to retire prior managed membership", async () => {
    const removeMissing = vi.fn().mockResolvedValue(4);
    await expect(
      reconcileVacancyMembership([], true, removeMissing),
    ).resolves.toBe(4);
    expect(removeMissing).toHaveBeenCalledWith(
      expect.objectContaining({ safeToPrune: true, retainedIds: [] }),
    );
  });
});
