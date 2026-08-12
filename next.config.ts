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
  outputFileTracingIncludes: {
    "/vacancy/[zip]/shortlist": ["./data/exports/shortlist-universe/**"],
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
