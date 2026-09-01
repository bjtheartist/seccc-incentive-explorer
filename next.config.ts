import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The Site Shortlist canonical universe files
  // (data/exports/shortlist-universe/*.json) live outside public/ on
  // purpose (server-only — see lib/shortlist-universe.ts) so they are never
  // publicly downloadable, but that means Vercel's build-time file tracing
  // does not include them by default: a `readFileSync` against a path
  // outside public/ that isn't reachable from any statically-analyzable
  // import can silently 404 in the deployed function even though it works
  // locally. Declared now, even though PR2 wires the actual consumer route
  // (/vacancy/[zip]/shortlist) — see lib/__tests__/shortlist-universe-
  // bundling.test.ts, which proves this via a real production build.
  // data/programs-internal.json (the eligibility-claims-overhaul internal
  // catalog — build-spec.md 1.2) is server-only for the same reason as the
  // shortlist universe above. No PR1 route reads it at request time yet
  // (PR2 wires the actual consumer routes), so "/**" declares it for every
  // route rather than guessing which ones PR2 will add — see
  // lib/__tests__/programs-internal-bundling.test.ts.
  outputFileTracingIncludes: {
    "/vacancy/[zip]/shortlist": ["./data/exports/shortlist-universe/**"],
    // The enrichment route reads the parcel-identity sidecars (precomputed
    // County parcel facts) from data/exports/ via process.cwd() — the SAME
    // outside-public/, not-statically-analyzable pattern the shortlist page
    // needs tracing for. Without its own entry the deployed function has no
    // manifest, every PIN misses, and the route silently falls back to a
    // per-PIN County ArcGIS call: a pure performance regression with no
    // error to notice. See lib/__tests__/shortlist-universe-bundling.test.ts.
    "/api/shortlist/enrich": ["./data/exports/shortlist-universe/parcel-identity/**"],
    "/**": ["./data/programs-internal.json"],

    // ── data/private/** and data/curated/** (R2 finding 1) ──────────────
    //
    // The warning above was written for data/exports/ and data/programs-
    // internal.json, and then the SAME server-only convention spread to
    // data/private/ and data/curated/ without anyone extending this map.
    // Six modules read those two trees with `readFileSync(path.join(
    // process.cwd(), …))` at REQUEST time, none of it reachable by static
    // import analysis, none of it declared here — so on Vercel every one of
    // them hits the `existsSync` guard, returns null, and the surface
    // degrades silently to "no data" with nothing in the logs to notice.
    //
    // Declared per file, not as `data/private/**` / `data/curated/**`,
    // because these are big: community-investment.json alone is 42MB,
    // data/curated/investment-inputs/ is 36MB and data/curated/zoning/ is
    // 26MB. A blanket tree glob would push ~113MB into every listed
    // function for files it never opens, against Vercel's 250MB
    // uncompressed function ceiling. Each entry below is the file the route
    // can actually reach at runtime.
    //
    // Pinned by lib/__tests__/data-private-curated-bundling.test.ts.

    // lib/community-investment.ts:1454 (community-investment.json) and
    // lib/investment-analysis.ts:837 (capital-context.json). /investment and
    // /investment/[area] are DISTINCT route ids in Next's matcher — a
    // "/investment/**" glob would not cover the bare index page — so each
    // one is spelled out. /investment/[area] also reaches
    // community-investment.ts a second way, through
    // components/investment/FunderFlowSankey -> lib/investment-sankey.
    "/investment": [
      "./data/private/community-investment.json",
      "./data/private/capital-context.json",
    ],
    "/investment/[area]": [
      "./data/private/community-investment.json",
      "./data/private/capital-context.json",
    ],
    "/investment/compare": [
      "./data/private/community-investment.json",
      "./data/private/capital-context.json",
    ],
    "/print/investment/[area]": [
      "./data/private/community-investment.json",
      "./data/private/capital-context.json",
    ],

    // The CORE report path. app/api/report/generate/route.ts calls
    // loadCapitalContextForArea() (lib/investment-analysis.ts:837) to
    // resolve the FFIEC CRA series for the report's community area. Without
    // this the file is absent in the deployed function, the loader's
    // existsSync guard returns null, and every report silently drops its
    // corridor-investment chart — the failure mode is a missing section, not
    // an error. capital-context.json ONLY: the route reaches
    // loadCapitalContextForArea and nothing else in that module that opens
    // the 42MB community-investment.json, so shipping that file here would
    // be 42MB of dead weight on the hottest function in the app.
    "/api/report/generate": ["./data/private/capital-context.json"],

    // app/api/owner-file/investment/route.ts:265 reads foundation-hqs.csv
    // for the 12 funder headquarters, and value-imports
    // lib/community-investment.ts for the dataset itself.
    "/api/owner-file/investment": [
      "./data/private/community-investment.json",
      "./data/curated/foundation-hqs.csv",
    ],

    // lib/exemption-anomalies.ts:46, reached from app/vacancy/[zip]/report.
    "/vacancy/[zip]/report": ["./data/private/exemption-anomalies.json"],

    // app/api/site-activity/route.ts:27 reads four CSVs out of the
    // site-activity directory; the whole directory is 4.4MB, small enough
    // to take as a tree rather than four brittle filenames.
    "/api/site-activity": ["./data/curated/site-activity/**"],

    // ── Same defect, found while verifying the six above ────────────────
    // Not in the original finding, but identical in kind: a request-time
    // process.cwd() read of a server-only tree with no tracing entry. Left
    // out, each would keep failing silently in exactly the way this whole
    // block exists to stop.

    // lib/owner-cluster-geo.ts, reached only from app/api/owner-file/geo.
    "/api/owner-file/geo": ["./data/private/owner-clusters-geo.json"],

    // lib/zoning-legislation-data.ts reads five named files out of
    // data/curated/zoning/ (~26MB together). Named individually rather than
    // as a tree so the 6KB README and any future sibling stay out.
    "/admin/zoning-changes": [
      "./data/curated/zoning/zoning-legislation.json",
      "./data/curated/zoning/zoning-map-snapshot.json",
      "./data/curated/zoning/zoning-map-latest-delta.json",
      "./data/curated/zoning/zoning-zba-snapshot.json",
      "./data/curated/zoning/zoning-zba-latest-delta.json",
    ],

    // lib/permit-exhibit.ts's defaultReadZoningArchiveVintageRange() reads
    // data/archive/zoning/index.json (874 bytes) whenever an exhibit is
    // actually BUILT, and its catch returns an empty range instead of
    // throwing — so an untraced file costs the exhibit its zoning-archive
    // vintage line with no error anywhere. Only the three routes that call
    // buildPermitExhibit need it; the other three permit-exhibit routes
    // import the module for label constants and never touch the filesystem.
    "/permit-exhibit/[pin]": ["./data/archive/zoning/index.json"],
    "/print/permit-exhibit/[pin]": ["./data/archive/zoning/index.json"],
    "/api/permit-exhibit-snapshots": ["./data/archive/zoning/index.json"],
  },
  async redirects() {
    return [
      {
        source: "/corridors",
        destination: "/map",
        permanent: true,
      },
      {
        source: "/corridors/:path*",
        destination: "/map",
        permanent: true,
      },
      // The /qualify Program Fit Questions surface was sunset (owner's
      // ruling: the product boundary is discovery, not compliance) —
      // permanent redirect so old links (bookmarks, external references)
      // don't 404.
      {
        source: "/qualify",
        destination: "/",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/data/:path*.geojson',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, s-maxage=604800, immutable' },
          { key: 'Content-Type', value: 'application/geo+json' },
        ],
      },
      {
        source: '/data/:path*.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/data/programs.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' },
        ],
      },
    ];
  },
};

export default nextConfig;
