import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { fetchSource, parseSource, canonicalUrl } from "./fetch-source";
import { query, type Query } from "./store";
import type { GrantSource } from "./model";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export async function scanSources(sql: Query = query, fetcher = fetchSource) {
  const lease = randomUUID();
  // Atomic claim makes manual runs and cron safe to overlap. Expired leases retry.
  const sources = await sql(
    `WITH due AS (
    SELECT id FROM grants_sources WHERE data->>'enabled'='true' AND next_scan_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_scan_at LIMIT 6 FOR UPDATE SKIP LOCKED
    ) UPDATE grants_sources s SET lease_until=now()+interval '5 minutes',lease_token=$1
      FROM due WHERE s.id=due.id RETURNING s.*`,
    [lease],
  );
  const results: {
    id: string;
    name: string;
    status: string;
    error?: string;
  }[] = [];
  for (const source of sources) {
    const config = source.data as GrantSource;
    try {
      const page = await fetcher(config.url);
      const parsed = parseSource(page.html, page.url);
      const hash = digest(parsed.text + JSON.stringify(parsed.links));
      const changed = source.last_hash !== hash;
      const snapshotId = randomUUID();
      const previous =
        changed && source.last_hash
          ? await sql(
              "SELECT content FROM grants_snapshots WHERE source_id=$1 ORDER BY fetched_at DESC LIMIT 1",
              [source.id],
            )
          : [];
      const findings = changed
        ? [
            {
              id: randomUUID(),
              url: canonicalUrl(page.url),
              title: config.name,
              kind: "changed",
              excerpt: parsed.text.slice(0, 8000),
              previous_excerpt: previous[0]?.content
                ? String(previous[0].content).slice(0, 8000)
                : null,
              dedupe_key: `change:${source.id}:${hash}`,
            },
            ...(config.kind === "directory"
              ? parsed.links.map((link) => ({
                  id: randomUUID(),
                  ...link,
                  kind: "discovered",
                  excerpt: `Discovered on ${config.name}. Link text is a lead; application dates and eligibility have not been verified.`,
                  previous_excerpt: null,
                  dedupe_key: `discovery:${digest(link.url)}`,
                }))
              : []),
          ]
        : [];
      await sql(
        `WITH updated AS (
        UPDATE grants_sources SET checked_at=now(),next_scan_at=now()+($4::int*interval '1 day'),last_status='ok',last_error=NULL,last_hash=$3,lease_until=NULL,lease_token=NULL
          WHERE id=$1 AND lease_token=$2 AND version=$5 RETURNING id,program_id
      ), snap AS (
        INSERT INTO grants_snapshots(id,source_id,url,content_hash,content)
          SELECT $6,id,$7,$3,$8 FROM updated WHERE $9::boolean RETURNING id
      ), invalidate AS (
        UPDATE grants_rounds r SET data=jsonb_set(data,'{review}','"unverified"'),version=version+1,updated_at=now(),updated_by='scanner'
          FROM updated WHERE $9::boolean AND r.program_id=updated.program_id AND r.data->>'review'='verified'
      ) INSERT INTO grants_findings(id,source_id,url,title,kind,excerpt,previous_excerpt,snapshot_id,dedupe_key)
        SELECT f.id,$1,f.url,f.title,f.kind,f.excerpt,f.previous_excerpt,snap.id,f.dedupe_key
        FROM jsonb_to_recordset($10::jsonb) AS f(id text,url text,title text,kind text,excerpt text,previous_excerpt text,dedupe_key text) CROSS JOIN snap
        ON CONFLICT(dedupe_key) DO UPDATE SET state=CASE WHEN EXCLUDED.kind='changed' THEN 'pending' ELSE grants_findings.state END,
          snapshot_id=EXCLUDED.snapshot_id,excerpt=EXCLUDED.excerpt,previous_excerpt=EXCLUDED.previous_excerpt`,
        [
          source.id,
          lease,
          hash,
          config.intervalDays,
          source.version,
          snapshotId,
          page.url,
          parsed.text,
          changed,
          JSON.stringify(findings),
        ],
      );
      results.push({
        id: String(source.id),
        name: config.name,
        status: changed ? "review_needed" : "unchanged",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 300) : "Scan failed";
      await sql(
        "UPDATE grants_sources SET checked_at=now(),next_scan_at=now()+interval '1 day',last_status='error',last_error=$3,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",
        [source.id, lease, message],
      );
      results.push({
        id: String(source.id),
        name: config.name,
        status: "error",
        error: message,
      });
    }
  }
  return { scanned: sources.length, results };
}
