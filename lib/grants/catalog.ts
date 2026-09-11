import "server-only";
import { createHash } from "node:crypto";
import { query, GrantsStore, type Query, type Row } from "./store";
import { GrantsError } from "./auth";
import {
  applicantSchema,
  programSchema,
  roundSchema,
  type Member,
  type Applicant,
} from "./model";
import {
  catalogMatchCriteria,
  catalogTiming,
  safeCatalogUrl,
  type CatalogItem,
  type CatalogQuery,
  type CatalogPage,
  type CatalogSuggestions,
} from "./catalog-model";

const day = `(now() AT TIME ZONE 'America/Chicago')::date`;
export const timingSQL = `CASE WHEN g.closes_at<${day} OR g.status IN ('closed','archived') THEN 'closed' WHEN g.record_type<>'opportunity' OR g.verified_at IS NULL OR g.next_review_date IS NULL OR g.next_review_date<=${day} THEN 'unconfirmed' WHEN g.opens_at>${day} OR g.status='scheduled' THEN 'upcoming' WHEN g.status IN ('open','rolling') THEN 'current' ELSE 'unconfirmed' END`;
const columns = `g.*, r.id AS linked_round_id, r.program_id AS linked_program_id`;
const joined = `grants_active g LEFT JOIN grants_rounds r ON r.data->>'catalogId'=g.id`;
const date = (v: unknown) =>
  v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
function item(row: Row, details = false): CatalogItem {
  const payload = obj(row.payload),
    uses = obj(payload.uses);
  const result = {
    id: String(row.id),
    name: String(row.name),
    sponsor: String(row.sponsor || ""),
    source: String(row.source),
    recordType: String(row.record_type),
    relevance: String(row.chicago_relevance),
    amount: String(row.amount_display || "Amount needs review"),
    fundingType: String(row.instrument || "unknown"),
    sourceStatus: String(row.status),
    deadline: date(row.closes_at),
    opensAt: date(row.opens_at),
    checkedAt: date(row.verified_at),
    reviewAt: date(row.next_review_date),
    sourceUrl: safeCatalogUrl(row.source_url),
    complete: row.match_readiness === "ready",
    missing: strings(row.missing_fields),
    entities: strings(row.entity_types),
    geography: String(row.geography || "Unconfirmed"),
    uses: strings(row.uses_eligible),
    purpose: String(
      uses.summary || strings(uses.observedPurposes).join("; ") || "",
    ),
    linkedProgramId: row.linked_program_id
      ? String(row.linked_program_id)
      : null,
    linkedRoundId: row.linked_round_id ? String(row.linked_round_id) : null,
  };
  return {
    ...result,
    timing: catalogTiming(result, today()),
    ...(details ? { payload } : {}),
  };
}

export class GrantsCatalog {
  constructor(private sql: Query = query) {}
  async list(filters: CatalogQuery): Promise<CatalogPage> {
    const params: unknown[] = [],
      conditions: string[] = [];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filters.q) {
      const p = add(filters.q);
      conditions.push(
        `(g.search @@ websearch_to_tsquery('english',${p}) OR g.name ILIKE '%' || ${p} || '%')`,
      );
    }
    if (filters.source) conditions.push(`g.source=${add(filters.source)}`);
    if (filters.type) conditions.push(`g.record_type=${add(filters.type)}`);
    if (filters.timing)
      conditions.push(`(${timingSQL})=${add(filters.timing)}`);
    if (filters.scope === "chicago")
      conditions.push(`g.chicago_relevance IN ('high','medium')`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const pageSize = 25;
    const [rows, count, totals] = await Promise.all([
      this.sql(
        `SELECT ${columns} FROM ${joined} ${where} ORDER BY CASE WHEN g.source='curated' THEN 0 ELSE 1 END, g.name, g.id LIMIT 25 OFFSET $${params.length + 1}`,
        [...params, (filters.page - 1) * pageSize],
      ),
      this.sql(
        `SELECT count(*)::int AS total FROM grants_active g ${where}`,
        params,
      ),
      this.sql(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE source='curated')::int AS curated,count(*) FILTER(WHERE record_type='opportunity')::int AS opportunities,count(*) FILTER(WHERE record_type='foundation')::int AS foundations,count(*) FILTER(WHERE record_type='standing_program')::int AS standing FROM grants_active`,
      ),
    ]);
    return {
      items: rows.map((r) => item(r)),
      total: Number(count[0].total),
      page: filters.page,
      pageSize,
      counts: totals[0] as unknown as CatalogPage["counts"],
    };
  }
  async get(id: string) {
    const rows = await this.sql(
      `SELECT ${columns} FROM ${joined} WHERE g.id=$1`,
      [id],
    );
    if (!rows[0]) throw new GrantsError("Source record not found", 404);
    return item(rows[0], true);
  }
  async suggest(applicantId: string): Promise<CatalogSuggestions> {
    const record = await new GrantsStore(this.sql).get<Applicant>(
      "applicants",
      applicantId,
    );
    const a = applicantSchema.parse(record.data),
      c = catalogMatchCriteria(a);
    const response = {
      applicantId,
      applicantVersion: record.version,
      explanation:
        "Research leads selected using recorded funding types, applicant category, stage and project keywords. Broad cost categories and geographic relevance are leads for review, not eligibility findings.",
    };
    if (a.archived || !c.funding.length || (!c.costs.length && !c.terms.length))
      return { ...response, items: [] };
    const params: unknown[] = [
      c.costs,
      c.terms.map((t) => `${t}:*`).join(" | "),
      c.funding,
      c.entities,
      a.role,
      a.stage,
    ];
    const rows = await this.sql(
      `SELECT ${columns} FROM ${joined}
      WHERE g.chicago_relevance IN ('high','medium') AND (${timingSQL})<>'closed'
      AND g.instrument=ANY($3::text[]) AND g.legitimacy='official'
      AND (cardinality($4::text[])=0 OR g.entity_types && $4::text[] OR cardinality(g.entity_types)=0)
      AND ($5<>'landlord' OR 'property_owner'=ANY(g.entity_types) OR g.landlord_or_tenant IN ('owner','either'))
      AND ($6<>'pre_opening' OR g.operating_stage IS NULL OR g.operating_stage IN ('any','pre_revenue_ok'))
      AND (g.uses_eligible && $1::text[] OR ($2<>'' AND g.search @@ to_tsquery('english',$2)))
      AND r.id IS NULL
      ORDER BY CASE WHEN g.source='curated' THEN 0 ELSE 1 END, CASE WHEN (${timingSQL})='current' THEN 0 ELSE 1 END,
      CASE WHEN g.uses_eligible && $1::text[] THEN 0 ELSE 1 END,
      ts_rank(g.search,to_tsquery('english',CASE WHEN $2='' THEN 'zzzzzz' ELSE $2 END)) DESC, g.closes_at ASC NULLS LAST, g.id LIMIT 30`,
      params,
    );
    const seen = new Set<string>();
    const items = rows
      .map((r) => item(r))
      .filter((r) => {
        // A program page often represents multiple imported rows. Directory URLs
        // represent many distinct programs and cannot be used as a duplicate key.
        const url = r.sourceUrl ? new URL(r.sourceUrl) : null;
        const key =
          url && url.pathname !== "/" && !/OpportunityList/i.test(url.pathname)
            ? url.origin + url.pathname + url.search
            : r.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
    return { ...response, items };
  }
  async promote(id: string, member: Member) {
    const source = await this.get(id);
    if (source.linkedRoundId)
      return {
        programId: source.linkedProgramId,
        roundId: source.linkedRoundId,
      };
    const payload = source.payload!,
      p = obj(payload.program),
      a = obj(payload.applicants),
      f = obj(payload.funding),
      v = obj(payload.verification),
      u = obj(payload.uses);
    const fundingMap: Record<
      string,
      "grant" | "reimbursement" | "in_kind" | "loan" | "tax_benefit"
    > = {
      grant: "grant",
      reimbursement: "reimbursement",
      rebate: "reimbursement",
      in_kind: "in_kind",
      loan: "loan",
      forgivable_loan: "loan",
      tax_benefit: "tax_benefit",
    };
    if (!fundingMap[source.fundingType])
      throw new GrantsError(
        "This funding form needs manual classification before creating a reviewed program. Keep the original source record for reference.",
      );
    const url = safeCatalogUrl(p.officialUrl) || source.sourceUrl;
    if (!url)
      throw new GrantsError(
        "A valid official HTTPS program URL is needed before review.",
      );
    const canonical = new URL(url);
    canonical.hash = "";
    ["utm_source", "utm_campaign", "utm_medium"].forEach((k) =>
      canonical.searchParams.delete(k),
    );
    const sourceUrl = canonical.href.replace(/\/$/, "");
    const programId =
      "catalog-" +
      createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
    const program = programSchema.parse({
      name: source.name.slice(0, 200),
      sponsor: (source.sponsor || "Funder to confirm").slice(0, 200),
      sponsorType:
        p.fundingSource === "philanthropic"
          ? "philanthropic"
          : ["corporate", "utility"].includes(String(p.fundingSource))
            ? "corporate"
            : "public",
      fundingType: fundingMap[source.fundingType],
      cadence:
        source.sourceStatus === "rolling"
          ? "recurring"
          : obj(payload.window).recurs === "one_time"
            ? "time_bound"
            : "hybrid",
      sourceUrl,
      description: (source.purpose || String(a.summary || "")).slice(0, 4000),
      ownerId: member.userId,
      notes: `Imported source ${id}. Source checked ${source.checkedAt || "unknown"}; staff verification still required.`,
      tags: [source.source, "imported"],
    });
    // Explicit known program identities avoid duplicate programs across official
    // City/funder URL aliases; generic SSA identifiers are deliberately not mapped.
    const aliases: Record<string, string> = {
      "chicago-sbif": "starter-sbif",
      "chicago-nof": "starter-nof",
      "chicago-cdg-small": "starter-cdg-small",
      "chicago-workforce-solutions": "starter-workforce",
      "ssa50-facade-enhancement-grant": "starter-ssa50",
      "verizon-digital-ready-grant-2026": "starter-verizon",
      "nase-growth-grant": "starter-nase",
    };
    const lookup = () =>
      this.sql(
        `SELECT id FROM grants_programs WHERE rtrim(data->>'sourceUrl','/')=$1 OR id=$2 ORDER BY created_at,id LIMIT 1`,
        [sourceUrl, aliases[id] || ""],
      );
    let existing = await lookup();
    if (!existing.length) {
      await this.sql(
        `INSERT INTO grants_programs(id,data,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`,
        [programId, JSON.stringify(program), member.userId],
      );
      existing = await lookup();
    }
    if (!existing[0])
      throw new GrantsError(
        "Program changed during import. Retry to preserve existing edits.",
        409,
      );
    const actualId = String(existing[0].id),
      roundId =
        "catalog-round-" +
        createHash("sha256").update(id).digest("hex").slice(0, 24);
    const terms = JSON.stringify({
      applicants: a,
      uses: u,
      requirements: payload.requirements,
      funding: f,
      window: payload.window,
    });
    const tags = (x: unknown) =>
      strings(x)
        .map((s) => s.slice(0, 100))
        .slice(0, 30);
    const entities = source.entities.flatMap((e) =>
      e === "unrestricted"
        ? ["any"]
        : e === "small_business"
          ? ["for_profit"]
          : ["for_profit", "nonprofit", "individual"].includes(e)
            ? [e]
            : [],
    );
    const round = roundSchema.parse({
      catalogId: id,
      programId: actualId,
      name: `Imported review — ${id}`.slice(0, 200),
      availability: "unknown",
      review: "unverified",
      amount: source.amount.slice(0, 300),
      evidenceUrl: source.sourceUrl || sourceUrl,
      evidence:
        `Source checked ${source.checkedAt || "unknown"} by ${String(v.checkedBy || source.source)}. ${String(v.evidence || "")}`.slice(
          0,
          4000,
        ),
      notes:
        `Staff review required. Dates from the source are retained here, without inventing a deadline time or timezone. Full source record: ${id}. ${terms}`.slice(
          0,
          4000,
        ),
      rules: {
        roles: [],
        entities: [...new Set(entities)],
        stages:
          a.operatingStage === "any"
            ? ["any"]
            : a.operatingStage === "pre_revenue_ok"
              ? ["pre_opening", "operating"]
              : [],
        industries: tags(a.industriesIncluded),
        businessTypes: [],
        geography: [],
        costs: tags(u.eligible),
        exclusions: strings(u.exclusions).join("\n").slice(0, 4000),
        requirements:
          `Review complete source criteria, dates, eligible cost categories, geography and cash needs before verification. ${JSON.stringify(payload.requirements || {})}`.slice(
            0,
            4000,
          ),
      },
      ownerId: member.userId,
      tags: [source.source, "imported"],
    });
    await this.sql(
      `INSERT INTO grants_rounds(id,data,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`,
      [roundId, JSON.stringify(round), member.userId],
    );
    return { programId: actualId, roundId };
  }
}
