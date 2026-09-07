import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Usage: node scripts/benchmark-map-loading.mjs http://localhost:3101 local-after 5
const base = process.argv[2] || 'http://localhost:3000';
const label = (process.argv[3] || 'map-loading').replace(/[^a-zA-Z0-9_-]/g, '-');
const runs = Number(process.argv[4] || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Runs must be an integer between 1 and 20');
await mkdir('output/performance', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const state = { status: 'completed', updatedAt: new Date().toISOString() };
        localStorage.setItem('cie:first-visit-guide', JSON.stringify({ ...state, version: 1 }));
        localStorage.setItem('cie:map-guide', JSON.stringify({ ...state, version: 2 }));
      });
      await page.route('**/api/analytics/**', r => r.fulfill({ status: 204 }));
      await page.route('**/_vercel/insights/**', r => r.fulfill({ status: 204 }));
      const requests = [];
      const errors = [];
      page.on('request', r => requests.push({ url: r.url(), type: r.resourceType(), at: Date.now() }));
      page.on('pageerror', e => errors.push(e.message));
      const start = Date.now();
      await page.goto(base + '/map', { waitUntil: 'domcontentloaded' });
      let ready = true;
      try {
        await page.locator('[data-tour="map-search"]').waitFor({ state: 'visible', timeout: 90000 });
        await page.locator('.mapboxgl-canvas').waitFor({ state: 'visible', timeout: 1000 });
      } catch { ready = false; }
      const readyMs = Date.now() - start;
      // Search also exists in the unavailable-map state. Never count that as a fast map.
      const fallback = await page.locator('[data-map-fallback]').evaluateAll(nodes => nodes[0]?.getAttribute('data-map-fallback') ?? null);
      if (fallback || errors.length) ready = false;
      const timing = await page.evaluate(() => ({
        resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, start: r.startTime, encoded: r.encodedBodySize, decoded: r.decodedBodySize, duration: r.duration })),
        paints: performance.getEntriesByType('paint').map(p => ({ name: p.name, start: p.startTime })),
      }));
      const result = { run: run + 1, ready, readyMs, fallback, requests: requests.map(r => ({ ...r, at: r.at - start })), errors, ...timing };
      results.push(result);
      console.log(JSON.stringify({ run: run + 1, ready, readyMs, fallback, requests: requests.length,
        scripts: timing.resources.filter(r => r.name.includes('/_next/static/') && r.name.endsWith('.js')).reduce((n, r) => n + r.encoded, 0), errors }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(`output/performance/${label}.json`, JSON.stringify(results, (key, value) =>
    typeof value === 'string' ? value.replace(/access_token=[^&\s]+/g, 'access_token=REDACTED') : value, 2));
}
if (results.some(result => !result.ready)) process.exitCode = 1;
