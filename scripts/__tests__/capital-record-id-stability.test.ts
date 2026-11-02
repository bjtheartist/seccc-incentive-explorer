import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommunityInvestmentRecord } from "../../lib/community-investment";
import { mapHud, mapTif, parseDelimited } from "../export-community-investment";
import { hudSourceKey, tifSourceKey } from "../lib/capital-record-ids";
import legacy from "../lib/capital-legacy-record-ids.json";

const inputDir = join(process.cwd(), "data/curated/investment-inputs");
const tif = parseDelimited(readFileSync(join(inputDir, "tif_projects.csv"), "utf8"), ",")
  .filter((r) => r.dataset === "rda-iga");
const hud = parseDelimited(readFileSync(join(inputDir, "hud_cpd_activities.csv"), "utf8"), ",");
const accepted = JSON.parse(readFileSync(join(process.cwd(), "data/private/community-investment.json"), "utf8")) as {
  records: CommunityInvestmentRecord[];
};
const asOf = new Date("2026-11-02T00:00:00Z");
const hudAliases: Record<string, string> = legacy.ids["cdbg-home"];

describe("capital native source identities preserve published IDs", () => {
  it.each(["tif", "cdbg-home"] as const)("reproduces EVERY accepted %s ID from the real source CSV", (source) => {
    const mapped = source === "tif" ? mapTif(tif).records : mapHud(hud, asOf).records;
    const expected = accepted.records.filter((r) => r.source === source);
    expect(mapped).toHaveLength(expected.length);
    const byId = new Map(expected.map((r) => [r.id, r]));
    for (const record of mapped) {
      const prior = byId.get(record.id);
      expect(prior, record.id).toBeDefined();
      // Independent accepted export: a bad alias must fail even if deterministic.
      expect([record.recipient, record.address, record.authorizedAmount, record.geometry], record.id)
        .toEqual([prior!.recipient, prior!.address, prior!.authorizedAmount, prior!.geometry]);
      expect(record.sourceRecordId).toBeTruthy();
    }
  });

  it("does not renumber any TIF or HUD row when input order reverses", () => {
    for (const [normal, reversed] of [
      [mapTif(tif).records, mapTif([...tif].reverse()).records],
      [mapHud(hud, asOf).records, mapHud([...hud].reverse(), asOf).records],
    ]) {
      const identities = (records: typeof normal) => records.map((r) => [r.sourceRecordId, r.id]).sort();
      expect(identities(reversed)).toEqual(identities(normal));
    }
  });

  it("preserves a held TIF ID through real geometry recovery, address/amount changes and ordinal churn", () => {
    const trippe = tif.find((r) => tifSourceKey(r) === "rda-iga:1335")!;
    const original = mapTif([trippe]).records[0];
    expect(original.id).toBe("tif-held-0");
    const changed = { ...trippe, address: "1111 W 35th St", lat: "41.8305362396", lng: "-87.6538679998",
      authorized_tif_assistance: "1600001", source_row_id: "rda-iga:1335:99999" };
    const recovered = mapTif([changed]).records[0];
    expect(recovered.id).toBe(original.id);
    expect(recovered.geometry.kind).toBe("point");
    expect(recovered.locationReason).toBeNull();
    expect(recovered.authorizedAmount).toBe(1600001);
  });

  it("keeps published point and held HUD IDs through location recovery/loss", () => {
    const held = hud.find((r) => hudAliases[hudSourceKey(r)]?.includes("-held-"))!;
    const prior = mapHud([held], asOf).records[0];
    const recovered = mapHud([{ ...held, lat: "41.88", lng: "-87.63" }], asOf).records[0];
    expect(recovered.id).toBe(prior.id);
    expect(recovered.geometry.kind).toBe("point");
    const oldPoint = mapHud([hud[0]], asOf).records[0];
    const nowHeld = mapHud([{ ...hud[0], lat: "40", lng: "-86" }], asOf).records[0];
    expect(nowHeld.id).toBe(oldPoint.id);
    expect(nowHeld.geometry.kind).toBe("citywide");
  });

  it("allocates deterministic noncolliding IDs to additions, never reusing a removed legacy ID", () => {
    const first = tif[0];
    const added = { ...first, source_row_id: "rda-iga:999999999:0", project_name: "Synthetic new project" };
    const before = mapTif(tif).records;
    const inserted = mapTif([added, ...tif]).records;
    expect(inserted[0].id).toBe("tif-source-rda-iga-999999999");
    expect(inserted.filter((r) => r.sourceRecordId !== "rda-iga:999999999").map((r) => r.id))
      .toEqual(before.map((r) => r.id));
    expect(mapTif([added, ...tif.slice(1)]).records.map((r) => r.id)).not.toContain(before[0].id);
    expect(mapTif([{ ...added, lat: "", lng: "" }]).records[0].id).toBe(inserted[0].id);
    expect(mapTif([first]).records[0].id).toBe(before[0].id);
  });

  it("namespaces HUD additions by program and survives insertion and geometry changes", () => {
    const newHome = { ...hud[0], program: "home", activity_id: "999999999" };
    const newCdbg = { ...newHome, program: "cdbg" };
    const added = mapHud([newHome, ...hud, newCdbg], asOf).records;
    const newIds = added.filter((r) => r.sourceRecordId!.endsWith(":999999999")).map((r) => r.id);
    expect(newIds).toEqual(["cdbg-home-source-home-999999999", "cdbg-home-source-cdbg-999999999"]);
    expect(added.filter((r) => !newIds.includes(r.id)).map((r) => r.id)).toEqual(mapHud(hud, asOf).records.map((r) => r.id));
    expect(mapHud([{ ...newHome, lat: "40", lng: "-86" }], asOf).records[0].id).toBe(newIds[0]);
  });

  it("refuses ambiguous or missing native IDs instead of falling back to row numbers", () => {
    expect(() => mapTif([tif[0], { ...tif[0], source_row_id: tif[0].source_row_id.replace(/:\d+$/, ":987") }]))
      .toThrow(/Duplicate tif source identity/);
    expect(() => mapHud([hud[0], { ...hud[0], lat: "", lng: "" }], asOf)).toThrow(/Duplicate cdbg-home source identity/);
    expect(() => mapTif([{ ...tif[0], source_row_id: "" }])).toThrow(/source_row_id/);
    expect(() => mapHud([{ ...hud[0], activity_id: "" }], asOf)).toThrow(/activity_id/);
    expect(() => mapHud([{ ...hud[0], program: "unknown" }], asOf)).toThrow(/unknown program/);
  });

  it("pins unique immutable aliases with exact source/export provenance", () => {
    expect(legacy.baselineCommit).toBe("31952775542c26c66406b69193dade8a2d69d628");
    expect(Object.values(legacy.baselineSha256).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(Object.keys(legacy.ids.tif)).toHaveLength(769);
    expect(Object.keys(legacy.ids["cdbg-home"])).toHaveLength(6101);
    const ids = [...Object.values(legacy.ids.tif), ...Object.values(legacy.ids["cdbg-home"])];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
