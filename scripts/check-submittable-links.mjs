#!/usr/bin/env node
// Nightly health check for the links a user actually clicks on a program.
//
// TWO link families, reported separately because they fail differently and are
// consumed differently:
//
//   portals — applicationPortals[].url where type === "submittable". The UI
//     (app/programs/page.tsx) reads these to gate the "Apply via Submittable"
//     button, keyed `${programId}:${url}`. That contract is unchanged.
//
//   sources — every program's own `url` and `sourceUrl`: the "official source"
//     link on the program card, the program detail page, and the report. These
//     went UNCHECKED until 2026-08-09, which is exactly how four primary links
//     (three chicago.gov, one irs.gov) sat at a hard 404 in production without
//     anything noticing. A dead official-source link is worse than a dead apply
//     button: it is the platform telling someone to go read a page that is not
//     there.
//
// Results are written to public/data/link-health.json.
//
// A THREE-state verdict, not two. Several agency hosts (congress.gov, eda.gov)
// answer automated clients with 403/429 while serving the page fine to a
// browser. Scoring those "broken" would publish an absence as a finding — the
// same error the zoning provenance work removed. They are `blocked`: we did not
// learn anything, and we say so rather than guessing in either direction.

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
// review5 S1: public/data/programs.json no longer exists — build-spec.md 2.2
// deleted it as part of the hard cutover to the sanitized
// public/data/programs-public.json envelope. This checker is NOT a client
// path (it's a Node script run in CI/cron, never bundled to a browser), and
// it needs fields the PublicProgramView DTO deliberately excludes —
// applicationPortals[], contacts[].url, verificationSteps[].url — to find
// every link a user can actually click. So it reads the full internal
// catalog directly rather than the public envelope, the same way the /api
// server boundary does before projecting.
const PROGRAMS_PATH = resolve(ROOT, "data/programs-internal.json");
const HEALTH_PATH = resolve(ROOT, "public/data/link-health.json");

const TIMEOUT_MS = 15000;

/** HTTP codes that mean "a bot filter stopped us", not "the page is gone". */
const BOT_BLOCK_CODES = new Set([401, 403, 405, 406, 429]);

// chicago.gov's WAF returns 403 to any non-browser User-Agent, including
// "Mozilla/5.0 (compatible; <our-name>)". Since the City publishes most of the
// programs in this catalog, an honest-but-rejected UA left ~19 of 91 source
// links permanently `blocked` — the checker could not see the surfaces that
// matter most. These are public pages, fetched once per link per night, with no
// authentication, paywall, or rate limit being circumvented.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function ping(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** ok | blocked | broken — `blocked` is "we did not find out", never a defect. */
export function classify({ ok, status }) {
  if (ok) return "ok";
  if (BOT_BLOCK_CODES.has(status)) return "blocked";
  return "broken";
}

function tally(results) {
  return {
    checked: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    broken: results.filter((r) => r.status === "broken").length,
  };
}

async function main() {
  const programs = JSON.parse(await readFile(PROGRAMS_PATH, "utf-8"));
  const checkedAt = new Date().toISOString();

  const portals = [];
  for (const program of programs) {
    const list = program.applicationPortals || [];
    for (const portal of list) {
      if (portal.type !== "submittable") continue;
      portals.push({ programId: program.id, portal });
    }
  }

  // EVERY link a program points a user at, not just the two top-level ones.
  //
  // The first version of this sweep covered only `url` and `sourceUrl`, and the
  // gap cost something immediately: chips48d's top-level url was repaired on
  // 2026-08-09 while `contacts[0].url` kept pointing at the same dead IRS page,
  // because nothing looked inside the arrays. A user clicking "IRS" on the
  // program card still got a 404. Contact and verification links are what a
  // person clicks when they are ready to act — the last place a dead link
  // should be allowed to sit.
  //
  // Deduped per program by URL: `sourceUrl` is frequently the same string as
  // `url`, and a contact often points at the program page, so each distinct URL
  // is pinged once and counted once.
  const sources = [];
  for (const program of programs) {
    const seen = new Set();
    const add = (field, url) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      sources.push({ programId: program.id, field, url });
    };
    add("url", program.url);
    add("sourceUrl", program.sourceUrl);
    (program.contacts || []).forEach((c, i) => add(`contacts[${i}].url`, c?.url));
    (program.verificationSteps || []).forEach((s, i) =>
      add(`verificationSteps[${i}].url`, s?.url),
    );
    (program.applicationPortals || []).forEach((p, i) =>
      add(`applicationPortals[${i}].url`, p?.url),
    );
  }

  console.log(
    `Checking ${portals.length} Submittable portals and ${sources.length} official-source links…`,
  );

  const results = await Promise.all(
    portals.map(async ({ programId, portal }) => {
      const r = await ping(portal.url);
      const status = classify(r);
      console.log(
        `[${status.padEnd(7)}] portal ${programId} ${portal.language || "en"}  ${
          r.status
        }  ${portal.url}`,
      );
      return {
        programId,
        url: portal.url,
        language: portal.language || "en",
        status,
        httpStatus: r.status,
        finalUrl: r.finalUrl ?? null,
        error: r.error ?? null,
        checkedAt,
      };
    }),
  );

  const sourceResults = await Promise.all(
    sources.map(async ({ programId, field, url }) => {
      const r = await ping(url);
      const status = classify(r);
      console.log(
        `[${status.padEnd(7)}] source ${programId}.${field}  ${r.status}  ${url}`,
      );
      return {
        programId,
        field,
        url,
        status,
        httpStatus: r.status,
        finalUrl: r.finalUrl ?? null,
        error: r.error ?? null,
        checkedAt,
      };
    }),
  );

  // `totals` stays the PORTAL tally it has always been — app/programs/page.tsx
  // and the workflow's warn step both read it. Source health is its own key.
  const portalTotals = tally(results);
  const out = {
    checkedAt,
    totals: portalTotals,
    sourceTotals: tally(sourceResults),
    portals: results,
    sources: sourceResults,
  };

  await writeFile(HEALTH_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(
    `Wrote ${HEALTH_PATH} — portals ${portalTotals.ok}/${portalTotals.checked} ok, ` +
      `sources ${out.sourceTotals.ok}/${out.sourceTotals.checked} ok ` +
      `(${out.sourceTotals.broken} broken, ${out.sourceTotals.blocked} blocked)`,
  );
}

// Only sweep the network when this file is RUN. `classify` is imported by
// scripts/__tests__/check-program-links.test.ts, and an unguarded main() meant
// importing the module fired ~100 live requests at city, county, state, and
// federal hosts as a side effect of running the unit tests.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
