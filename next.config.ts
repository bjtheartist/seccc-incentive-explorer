import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
          { key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600' },
        ],
      },
    ];
  },
};

export default nextConfig;
