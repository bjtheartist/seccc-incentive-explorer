import { z } from "zod";

/**
 * Request schemas for POST /api/report/generate (R2 finding 2).
 *
 * The route used to accept `state` and `ctx` on a single check —
 * `isPlainObject(body.state)` — and then CAST both straight into
 * `WizardState` and `ReportContext`:
 *
 *     const state = body.state as unknown as WizardState;
 *     const ctx = (isPlainObject(body.ctx) ? body.ctx : {}) as ReportContext;
 *
 * Its doc comment justified this as "matching the trust level every other
 * request body in this app already gets", which was true and is exactly the
 * problem. `{ state: { projectGoals: 5 } }` reached `generateReportData` and
 * failed somewhere deep in the engine as a 500; a megabyte of nested junk in
 * `ctx` was walked in full; and the whole body was read with no size ceiling
 * at all.
 *
 * ── The governing constraint ──
 *
 * app/report/page.tsx belongs to another round's fence and CANNOT be edited.
 * It sends `JSON.stringify({ state, ctx })` with correctly-typed values, so
 * these schemas must accept everything that page legitimately sends today. If
 * validation would force a client change, the validation is wrong.
 *
 * That shapes the design:
 * - Every field is OPTIONAL. The client sends a full WizardState, but the
 *   route already tolerated partial ones and the engine defaults throughout.
 * - `.passthrough()` everywhere. Unknown keys survive rather than being
 *   stripped, so a field added on the client side later cannot be silently
 *   dropped on the way to the engine — a stripped field would be a much
 *   quieter bug than a rejected request.
 * - `ctx` is validated by CONTAINER KIND, not contents. Its members are large
 *   nested structures (census, parcel, districts, locationContext…) that the
 *   engine reads defensively. Pinning their interiors here would duplicate the
 *   engine's contract in a second place and break the client the first time
 *   either drifted. What is enforced is that an object is an object, an array
 *   is an array, and neither is absurdly large.
 *
 * So: wrong SHAPES and absurd SIZES are rejected. Contents are the engine's
 * business, as before.
 */

/** Free text on the wizard. 500 is far above any real value. */
const text = (max = 500) => z.string().max(max).optional();

/** Coordinates arrive as `number | null` and must never be NaN/Infinity. */
const coordinate = z.number().finite().nullable().optional();

/**
 * A wizard multi-select. The largest real option list has 13 entries; 64 is
 * generous headroom that still bounds the array.
 */
const idList = z.array(z.string().max(200)).max(64).optional();

export const WizardStateRequestSchema = z
  .object({
    /**
     * Not pinned to the ReportType union on purpose: the engine's own switch
     * has a default branch and legacy type names still appear on old shared
     * links. A wrong TYPE (a number, an object) is still rejected.
     */
    reportType: z.string().max(64).nullable().optional(),
    address: text(),
    lat: coordinate,
    lon: coordinate,
    neighborhood: text(200),
    industry: text(200),
    budgetRange: text(200),
    projectGoals: idList,
    projectType: text(200),
    customGoal: text(),
    proposedUse: text(),
    fundingCommitted: text(200),
    remainingGap: text(200),
    timeline: text(200),
    siteControl: text(200),
    documentsAvailable: idList,
    jobsImpact: text(200),
    supportNeeded: idList,
    creditsToAnalyze: idList,
    compareAddress: text(),
    compareLat: coordinate,
    compareLon: coordinate,
  })
  .passthrough();

/** An object whose interior belongs to the report engine, not to this schema. */
const opaqueObject = z.record(z.string(), z.unknown()).nullable().optional();

/** An array whose elements belong to the engine; only the count is bounded. */
const opaqueArray = (max: number) => z.array(z.unknown()).max(max).optional();

export const ReportContextRequestSchema = z
  .object({
    zones: z.record(z.string(), z.unknown()).optional(),
    zoneNames: z.record(z.string(), z.unknown()).optional(),
    unknownZones: z.array(z.string().max(200)).max(128).optional(),
    zoneCheckedAt: z.string().max(64).optional(),
    census: opaqueObject,
    cityZoning: opaqueObject,
    parcel: opaqueObject,
    districts: opaqueObject,
    stackingRules: opaqueArray(2000),
    communityAssets: opaqueArray(2000),
    /**
     * The ONE ctx field this route reads itself — it looks up
     * `localBusinessSupport.communityArea` to resolve the FFIEC CRA series. So
     * that one property is typed; the rest of the object passes through.
     */
    localBusinessSupport: z
      .object({ communityArea: z.string().max(200).optional() })
      .passthrough()
      .nullable()
      .optional(),
    stats: opaqueObject,
    corridorMetrics: opaqueObject,
    reportZip: z.string().max(32).nullable().optional(),
    corridorOwnerClusters: opaqueArray(2000),
    neighborhoodEconomics: opaqueObject,
    siteSignals: opaqueObject,
    transport: opaqueObject,
    mobilityAccess: opaqueObject,
    locationContext: opaqueObject,
    capitalContext: opaqueObject,
  })
  .passthrough();

export const GenerateReportRequestSchema = z.object({
  state: WizardStateRequestSchema,
  /** Absent `ctx` is legal and means "no context" — the route defaults to {}. */
  ctx: ReportContextRequestSchema.optional(),
});

/**
 * Ceiling on the raw request body, checked BEFORE JSON.parse.
 *
 * The route had none: it called `await request.json()` on whatever arrived, so
 * an arbitrarily large body was buffered and parsed before anything looked at
 * it. A real `ctx` — every zone layer, census tract, parcel record, district,
 * stacking rule and community asset for one address — runs to tens of
 * kilobytes; 1MB is a wide margin over that and still refuses a payload sent
 * to make the server do work.
 */
export const MAX_GENERATE_BODY_BYTES = 1_000_000;

/** The first schema failure, rendered for an honest 400. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid request body";
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}
