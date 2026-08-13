/**
 * build-spec.md 2.2 (hard cutover): public/data/programs.json is deleted;
 * GET /api/programs must serve from data/programs-internal.json instead —
 * this is the one server boundary every client surface (ProgramsCatalog,
 * MapView, etc.) now fetches from.
 *
 * No DB connection (Hard Rules): mocked at the getSQL boundary to null, so
 * this exercises the static-fallback path deterministically.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getSQL: () => null,
}));

import { GET } from "./route";

describe("GET /api/programs", () => {
  it("returns programs sourced from data/programs-internal.json (not the deleted public file)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Spot-check a known catalog record with PR1's structured status fields
    // (data/programs-internal.json only, not a stale copy anywhere else).
    const nof = body.find((p: { id: string }) => p.id === "nof");
    expect(nof).toBeDefined();
    expect(nof.intakeStatus).toBeDefined();
  });
});
