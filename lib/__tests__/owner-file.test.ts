import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Mirrors app/api/corridor/owners/route.test.ts: mock lib/db's getSQL so
 * getOwnerCluster/getOwnerFile can be exercised both with no database
 * configured (real static-export fallback, corridor-metrics doctrine —
 * public/data/corridor-owners.json ships the real U.S. Steel 43-parcel
 * cluster used below) and with a live database mocked in.
 */
const { getSQLMock } = vi.hoisted(() => ({ getSQLMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import {
  addOutreachEvent,
  addOwnerFileNote,
  getOwnerCluster,
  getOwnerFile,
  getOwnerFileVerification,
  listOutreachEvents,
  listOwnerClusters,
  listOwnerFileNotes,
  upsertOwnerFileVerification,
} from "../owner-file";

const REAL_ZIP = "60617";
// public/data/corridor-owners.json — the U.S. Steel 43-vacant-parcel cluster
// (shipped in PR #52, referenced throughout the plan).
const REAL_CLUSTER_KEY = "mail:600grantst1381pittsburghpa15219";

/** Queued-response mock for the Neon tagged-template sql client. */
function makeSql(responses: unknown[][]) {
  let call = 0;
  const calls: { values: unknown[] }[] = [];
  const fn = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ values });
    const result = responses[call] ?? [];
    call += 1;
    return result;
  });
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

beforeEach(() => {
  getSQLMock.mockReset();
  getSQLMock.mockReturnValue(null);
});

describe("getOwnerCluster", () => {
  it("resolves a real cluster from the static export when no database is configured", async () => {
    const cluster = await getOwnerCluster(REAL_ZIP, REAL_CLUSTER_KEY);
    expect(cluster).not.toBeNull();
    expect(cluster!.ownerName).toBe("U S STEEL");
    expect(cluster!.vacantParcelCount).toBe(43);
    expect(cluster!.confidence).toBe("High");
  });

  it("returns null for an unknown clusterKey", async () => {
    expect(await getOwnerCluster(REAL_ZIP, "mail:doesnotexist")).toBeNull();
  });

  it("returns null for a zip outside the export", async () => {
    expect(await getOwnerCluster("60601", REAL_CLUSTER_KEY)).toBeNull();
  });

  it("falls back to the static export when the live query throws a schema-drift error (42703)", async () => {
    getSQLMock.mockReturnValue(
      vi.fn().mockRejectedValue(Object.assign(new Error('column "zip" does not exist'), { code: "42703" }))
    );
    const cluster = await getOwnerCluster(REAL_ZIP, REAL_CLUSTER_KEY);
    expect(cluster).not.toBeNull();
    expect(cluster!.ownerName).toBe("U S STEEL");
  });
});

describe("listOwnerClusters", () => {
  it("returns every cluster for a footprint ZIP from the static export when no database is configured", async () => {
    const clusters = await listOwnerClusters(REAL_ZIP, 100);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.some((cluster) => cluster.clusterKey === REAL_CLUSTER_KEY)).toBe(true);
  });

  it("sorts by vacantParcelCount desc (the export's own ordering) so the U.S. Steel cluster leads", async () => {
    const clusters = await listOwnerClusters(REAL_ZIP, 100);
    expect(clusters[0].clusterKey).toBe(REAL_CLUSTER_KEY);
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1].vacantParcelCount).toBeGreaterThanOrEqual(clusters[i].vacantParcelCount);
    }
  });

  it("returns an empty array for a zip outside the export", async () => {
    expect(await listOwnerClusters("60601", 100)).toEqual([]);
  });
});

describe("getOwnerFileVerification / upsertOwnerFileVerification", () => {
  it("returns null when no verification row exists", async () => {
    const { sql } = makeSql([[]]);
    expect(await getOwnerFileVerification(sql, REAL_CLUSTER_KEY)).toBeNull();
  });

  it("maps a verification row from snake_case to the OwnerFileVerification shape", async () => {
    const now = new Date().toISOString();
    const { sql } = makeSql([
      [
        {
          id: "v1",
          cluster_key: REAL_CLUSTER_KEY,
          zip: REAL_ZIP,
          pins_snapshot: ["17111000010000", "17111000020000"],
          owner_name_snapshot: "U S STEEL",
          owner_mailing_address_snapshot: "600 GRANT ST #1381, PITTSBURGH, PA, 15219",
          export_generated_at: now,
          verifier_name: "Jane Corridor Manager",
          confidence_tier: "B",
          registered_agent_name: null,
          registered_agent_address: null,
          il_sos_file_number: null,
          il_sos_lookup_url: null,
          taxpayer_mailing_address_confirmed: null,
          local_vs_absentee: "absentee",
          checklist_json: JSON.stringify([{ id: "c1", label: "Confirm entity standing", completed: false }]),
          status: "draft",
          created_at: now,
          updated_at: now,
        },
      ],
    ]);

    const result = await getOwnerFileVerification(sql, REAL_CLUSTER_KEY);
    expect(result).toEqual({
      id: "v1",
      clusterKey: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      pinsSnapshot: ["17111000010000", "17111000020000"],
      ownerNameSnapshot: "U S STEEL",
      ownerMailingAddressSnapshot: "600 GRANT ST #1381, PITTSBURGH, PA, 15219",
      exportGeneratedAt: new Date(now).toISOString(),
      verifierName: "Jane Corridor Manager",
      confidenceTier: "B",
      registeredAgentName: null,
      registeredAgentAddress: null,
      ilSosFileNumber: null,
      ilSosLookupUrl: null,
      taxpayerMailingAddressConfirmed: null,
      localVsAbsentee: "absentee",
      checklist: [{ id: "c1", label: "Confirm entity standing", completed: false }],
      status: "draft",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
  });

  it("upsertOwnerFileVerification maps the RETURNING row back and defaults checklist/status", async () => {
    const now = new Date().toISOString();
    const { sql, calls } = makeSql([
      [
        {
          id: "v2",
          cluster_key: REAL_CLUSTER_KEY,
          zip: REAL_ZIP,
          pins_snapshot: [],
          owner_name_snapshot: null,
          owner_mailing_address_snapshot: null,
          export_generated_at: null,
          verifier_name: "Jane Corridor Manager",
          confidence_tier: "D",
          registered_agent_name: null,
          registered_agent_address: null,
          il_sos_file_number: null,
          il_sos_lookup_url: null,
          taxpayer_mailing_address_confirmed: null,
          local_vs_absentee: null,
          checklist_json: "[]",
          status: "draft",
          created_at: now,
          updated_at: now,
        },
      ],
    ]);

    const result = await upsertOwnerFileVerification(sql, {
      clusterKey: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      pinsSnapshot: [],
      ownerNameSnapshot: null,
      ownerMailingAddressSnapshot: null,
      exportGeneratedAt: null,
      verifierName: "Jane Corridor Manager",
      confidenceTier: "D",
    });

    expect(result.id).toBe("v2");
    expect(result.status).toBe("draft");
    expect(result.checklist).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("owner file notes (append-only)", () => {
  it("listOwnerFileNotes maps rows and addOwnerFileNote returns the inserted row", async () => {
    const now = new Date().toISOString();
    const noteRow = {
      id: "n1",
      cluster_key: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      author_name: "Jane Corridor Manager",
      note_type: "entity_lookup",
      body: "Confirmed active/good standing on IL SOS business entity search.",
      source_url: "https://apps.ilsos.gov/businessentitysearch/",
      created_at: now,
    };

    const { sql: listSql } = makeSql([[noteRow]]);
    const notes = await listOwnerFileNotes(listSql, REAL_CLUSTER_KEY);
    expect(notes).toEqual([
      {
        id: "n1",
        clusterKey: REAL_CLUSTER_KEY,
        zip: REAL_ZIP,
        authorName: "Jane Corridor Manager",
        noteType: "entity_lookup",
        body: "Confirmed active/good standing on IL SOS business entity search.",
        sourceUrl: "https://apps.ilsos.gov/businessentitysearch/",
        createdAt: new Date(now).toISOString(),
      },
    ]);

    const { sql: addSql } = makeSql([[noteRow]]);
    const added = await addOwnerFileNote(addSql, {
      clusterKey: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      authorName: "Jane Corridor Manager",
      noteType: "entity_lookup",
      body: "Confirmed active/good standing on IL SOS business entity search.",
      sourceUrl: "https://apps.ilsos.gov/businessentitysearch/",
    });
    expect(added.id).toBe("n1");
    expect(added.noteType).toBe("entity_lookup");
  });
});

describe("owner file outreach events (append-only)", () => {
  it("listOutreachEvents maps rows and addOutreachEvent returns the inserted row", async () => {
    const now = new Date().toISOString();
    const eventRow = {
      id: "e1",
      cluster_key: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      verification_id: "v1",
      event_type: "letter_generated",
      actor_name: "Jane Corridor Manager",
      program_ids: JSON.stringify(["nof", "sbif"]),
      outcome: null,
      notes: null,
      occurred_at: now,
    };

    const { sql: listSql } = makeSql([[eventRow]]);
    const events = await listOutreachEvents(listSql, REAL_CLUSTER_KEY);
    expect(events).toEqual([
      {
        id: "e1",
        clusterKey: REAL_CLUSTER_KEY,
        zip: REAL_ZIP,
        verificationId: "v1",
        eventType: "letter_generated",
        actorName: "Jane Corridor Manager",
        programIds: ["nof", "sbif"],
        outcome: null,
        notes: null,
        occurredAt: new Date(now).toISOString(),
      },
    ]);

    const { sql: addSql } = makeSql([[{ ...eventRow, id: "e2", event_type: "outcome_logged", outcome: "responded" }]]);
    const added = await addOutreachEvent(addSql, {
      clusterKey: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      eventType: "outcome_logged",
      outcome: "responded",
      actorName: "Jane Corridor Manager",
    });
    expect(added.id).toBe("e2");
    expect(added.eventType).toBe("outcome_logged");
    expect(added.outcome).toBe("responded");
  });
});

describe("getOwnerFile (merged view model)", () => {
  it("merges an empty human layer when no database is configured, resolving the algorithmic tier", async () => {
    const ownerFile = await getOwnerFile(REAL_ZIP, REAL_CLUSTER_KEY);
    expect(ownerFile).not.toBeNull();
    expect(ownerFile!.cluster.ownerName).toBe("U S STEEL");
    expect(ownerFile!.verification).toBeNull();
    expect(ownerFile!.notes).toEqual([]);
    expect(ownerFile!.outreachEvents).toEqual([]);
    // cluster.confidence is "High" in the static export -> algorithmic tier B.
    expect(ownerFile!.resolvedTier).toBe("B");
  });

  it("returns null when the cluster can't be resolved", async () => {
    expect(await getOwnerFile(REAL_ZIP, "mail:doesnotexist")).toBeNull();
  });

  it("merges a live verification + entity_lookup note into a Tier A resolved tier", async () => {
    const now = new Date().toISOString();
    const verificationRow = {
      id: "v1",
      cluster_key: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      pins_snapshot: [],
      owner_name_snapshot: "U S STEEL",
      owner_mailing_address_snapshot: "600 GRANT ST #1381, PITTSBURGH, PA, 15219",
      export_generated_at: now,
      verifier_name: "Jane Corridor Manager",
      confidence_tier: "A",
      registered_agent_name: null,
      registered_agent_address: null,
      il_sos_file_number: null,
      il_sos_lookup_url: null,
      taxpayer_mailing_address_confirmed: true,
      local_vs_absentee: "absentee",
      checklist_json: "[]",
      status: "verified",
      created_at: now,
      updated_at: now,
    };
    const noteRow = {
      id: "n1",
      cluster_key: REAL_CLUSTER_KEY,
      zip: REAL_ZIP,
      author_name: "Jane Corridor Manager",
      note_type: "entity_lookup",
      body: "Verified via individual IL SOS lookup.",
      source_url: "https://apps.ilsos.gov/businessentitysearch/",
      created_at: now,
    };

    // getOwnerFile calls getOwnerCluster first, which (since getSQL() is
    // mocked non-null here too) attempts a live cluster query on the SAME
    // mocked sql before falling back to the static export — simulate that
    // attempt failing with a schema-drift error (prod has no parcel data by
    // design) so the real U.S. Steel cluster comes from the static export,
    // then queue the three human-layer responses for the calls after that.
    let call = 0;
    const responses: unknown[][] = [[verificationRow], [noteRow], []];
    const mockSql = vi.fn(async () => {
      if (call === 0) {
        call += 1;
        throw Object.assign(new Error('relation "parcels" does not exist'), { code: "42P01" });
      }
      const result = responses[call - 1] ?? [];
      call += 1;
      return result;
    });
    getSQLMock.mockReturnValue(mockSql as unknown as NeonQueryFunction<false, false>);

    const ownerFile = await getOwnerFile(REAL_ZIP, REAL_CLUSTER_KEY);
    expect(ownerFile).not.toBeNull();
    expect(ownerFile!.verification?.status).toBe("verified");
    expect(ownerFile!.notes).toHaveLength(1);
    expect(ownerFile!.resolvedTier).toBe("A");
  });

  it("degrades to an empty human layer (never throws) when the human-layer tables are unmigrated", async () => {
    getSQLMock.mockReturnValue(
      vi.fn().mockRejectedValue(Object.assign(new Error('relation "owner_file_verifications" does not exist'), { code: "42P01" }))
    );
    const ownerFile = await getOwnerFile(REAL_ZIP, REAL_CLUSTER_KEY);
    expect(ownerFile).not.toBeNull();
    expect(ownerFile!.verification).toBeNull();
    expect(ownerFile!.notes).toEqual([]);
    expect(ownerFile!.outreachEvents).toEqual([]);
  });
});
