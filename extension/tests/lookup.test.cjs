const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const lookup = require(path.join(root, 'lookup.js'));

const LAYER_KEYS = Object.keys(lookup.LAYER_LABELS);
const GEOCODE = { lat: 41.725637, lon: -87.601042, displayName: '9300 S Drexel Ave, Chicago', matchQuality: 'exact' };
const ZONES = {
  schemaVersion: 2,
  dataRevision: 'zones-v2-2026-08-13',
  checkedAt: '2026-09-16T02:54:05.569Z',
  requestedLayers: LAYER_KEYS,
  layers: Object.fromEntries(LAYER_KEYS.map(key => [key, { state: 'not_matched' }]))
};
const matchedZones = names => ({
  ...ZONES,
  layers: { ...ZONES.layers, ...Object.fromEntries(Object.entries(names).map(([k, v]) => [k, { state: 'matched', name: v }])) }
});
const PROGRAMS = {
  programs: [
    { programId: 'tif', program: { id: 'tif', name: 'TIF Districts', level: 'City', zoneKey: 'tif', url: 'https://www.chicago.gov/tif', sourceUrl: 'https://www.chicago.gov/tif' } },
    { programId: 'ssaRebate', program: { id: 'ssaRebate', name: 'SSA Rebate', level: 'City', zoneKey: 'ssa', url: 'javascript:alert(1)', sourceUrl: '' } }
  ]
};

// Records every request so the tests can assert on the POST body and the abort signal.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const route = Object.keys(routes).find(fragment => url.includes(fragment));
    if (!route) throw new Error(`Unexpected request: ${url}`);
    const value = routes[route];
    if (typeof value === 'function') return value(url, init);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(value)) };
  };
  impl.calls = calls;
  return impl;
}

test('the report deep link carries instant, coordinates, address and source', () => {
  assert.equal(
    lookup.buildReportUrl(41.7, -87.6, '639 E 90TH ST'),
    'https://chicagoincentiveexplorer.com/report?instant=true&lat=41.7&lon=-87.6&addr=639%20E%2090TH%20ST&src=extension'
  );
  assert.ok(lookup.buildReportUrl(41.7, -87.6, 'A & B <St>').includes('addr=A%20%26%20B%20%3CSt%3E'));
});

test('only http(s) links survive safeHttpUrl', () => {
  assert.equal(lookup.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(lookup.safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(lookup.safeHttpUrl('chrome-extension://abc/popup.html'), null);
  assert.equal(lookup.safeHttpUrl('  not a url  '), null);
  assert.equal(lookup.safeHttpUrl(''), null);
  assert.equal(lookup.safeHttpUrl(undefined), null);
  assert.equal(lookup.safeHttpUrl('https://www.chicago.gov/tif'), 'https://www.chicago.gov/tif');
  assert.equal(lookup.safeHttpUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(lookup.safeHttpUrl(lookup.buildReportUrl(41.7, -87.6, '639 E 90TH ST')), lookup.buildReportUrl(41.7, -87.6, '639 E 90TH ST'));
});

test('addresses normalize for the cache and always geocode against Chicago', () => {
  assert.equal(lookup.normalizeAddress('  9300   S Drexel   Ave '), '9300 s drexel ave');
  assert.equal(lookup.buildGeocodeQuery('639 E 90TH ST'), '639 E 90TH ST, Chicago, IL');
  assert.equal(lookup.buildGeocodeQuery('639 E 90TH ST, Chicago, IL'), '639 E 90TH ST, Chicago, IL');
});

test('layers keep label order, unknown states are unknown, and zones carry every requested key', () => {
  const layers = lookup.normalizeLayers(matchedZones({ tif: '87th/Cottage Grove', ssa: 'Chatham (SSA #51)' }));
  assert.equal(layers.length, LAYER_KEYS.length);
  assert.deepEqual(layers[0], { key: 'tif', label: 'TIF District', state: 'matched', name: '87th/Cottage Grove' });
  assert.equal(layers.find(l => l.key === 'ssa').label, 'Special Service Area');

  const odd = lookup.normalizeLayers({ requestedLayers: ['tif', 'brandNew'], layers: { tif: { state: 'pending' }, brandNew: { state: 'matched', name: 'X' } } });
  assert.deepEqual(odd.map(l => [l.key, l.state, l.label]), [['tif', 'unknown', 'TIF District'], ['brandNew', 'matched', 'brandNew']]);

  const { zones, zoneNames } = lookup.layersToZones(layers);
  assert.equal(Object.keys(zones).length, LAYER_KEYS.length);
  assert.equal(zones.tif, true);
  assert.equal(zones.federalOZ, false);
  assert.deepEqual(zoneNames, { tif: '87th/Cottage Grove', ssa: 'Chatham (SSA #51)' });
});

test('a Chicago address returns matched zones, up to three programs and a report link', async () => {
  const fetchImpl = fakeFetch({
    '/api/geocode': GEOCODE,
    '/api/zones/check/v2': matchedZones({ tif: '87th/Cottage Grove', ssa: 'Chatham (SSA #51)' }),
    '/api/programs/match': PROGRAMS
  });
  const result = await lookup.lookupAddress(fetchImpl, '  9300 S  Drexel Ave ');
  assert.equal(result.status, 'ok');
  assert.equal(result.address, '9300 S Drexel Ave');
  assert.deepEqual(result.matched.map(l => [l.key, l.name]), [['tif', '87th/Cottage Grove'], ['ssa', 'Chatham (SSA #51)']]);
  assert.equal(result.layers.length, LAYER_KEYS.length);
  assert.equal(result.dataRevision, 'zones-v2-2026-08-13');
  assert.deepEqual(result.programs[0], { id: 'tif', name: 'TIF Districts', level: 'City', zoneKey: 'tif', url: 'https://www.chicago.gov/tif' });
  assert.equal(result.programs[1].url, '', 'a non-https program link is dropped');
  assert.ok(result.reportUrl.includes('addr=9300%20S%20Drexel%20Ave'));

  assert.ok(fetchImpl.calls[0].url.includes('address=9300%20S%20Drexel%20Ave%2C%20Chicago%2C%20IL'));
  const body = JSON.parse(fetchImpl.calls[2].init.body);
  assert.equal(fetchImpl.calls[2].init.method, 'POST');
  assert.equal(Object.keys(body.zones).length, LAYER_KEYS.length);
  assert.deepEqual(body.zoneNames, { tif: '87th/Cottage Grove', ssa: 'Chatham (SSA #51)' });
  for (const call of fetchImpl.calls) assert.ok(call.init.signal, 'every request is abortable');
});

test('addresses outside Chicago never reach the zone APIs', async () => {
  for (const point of [{ lat: 42.0584, lon: -87.6843 }, { lat: 41.6, lon: -87.6 }, { lat: 41.8, lon: -87.95 }, { lat: 41.8, lon: -87.5 }]) {
    const fetchImpl = fakeFetch({ '/api/geocode': { ...point, displayName: 'Evanston' } });
    const result = await lookup.lookupAddress(fetchImpl, '1600 Orrington Ave');
    assert.equal(result.status, 'not_found');
    assert.equal(result.message, "We couldn't find that Chicago address.");
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test('missing coordinates read as a non-match; blank input never calls out', async () => {
  const fetchImpl = fakeFetch({ '/api/geocode': { displayName: 'nothing' } });
  assert.equal((await lookup.lookupAddress(fetchImpl, 'zzzz')).status, 'not_found');
  // What the live geocoder actually answers for an address it cannot place: 404 + a body.
  const bodies = [
    () => ({ ok: false, status: 404, json: async () => ({ error: 'Address not found', status: 'not_found' }) }),
    () => ({ ok: false, status: 404, json: async () => { throw new Error('not json'); } }),
    { error: 'Address not found', status: 'not_found' }
  ];
  for (const geocode of bodies) {
    const missed = fakeFetch({ '/api/geocode': geocode });
    const result = await lookup.lookupAddress(missed, 'zzzzqqq nowhere st');
    assert.equal(result.status, 'not_found');
    assert.equal(result.message, "We couldn't find that Chicago address.");
    assert.equal(missed.calls.length, 1, 'a non-match never reaches the zone APIs');
  }
  const unused = fakeFetch({});
  assert.equal((await lookup.lookupAddress(unused, '   ')).status, 'not_found');
  assert.equal(unused.calls.length, 0);
});

test('service failures at any hop map to the temporary-outage copy', async () => {
  const outage = 'The address service is temporarily unavailable. Try again in a minute.';
  const cases = [
    { '/api/geocode': { status: 'unavailable' } },
    { '/api/geocode': { error: 'geocoder down' } },
    { '/api/geocode': () => ({ ok: false, status: 500, json: async () => ({}) }) },
    { '/api/geocode': () => { throw new Error('network'); } },
    { '/api/geocode': GEOCODE, '/api/zones/check/v2': () => ({ ok: false, status: 404, json: async () => ({}) }) },
    { '/api/geocode': GEOCODE, '/api/zones/check/v2': ZONES, '/api/programs/match': () => { throw new Error('network'); } }
  ];
  for (const routes of cases) {
    const result = await lookup.lookupAddress(fakeFetch(routes), '9300 S Drexel Ave');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.message, outage);
  }
});

// --- service worker -------------------------------------------------------

function worker(storage, fetchImpl) {
  let listener;
  const sandbox = vm.createContext({
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Date,
    JSON,
    Object,
    Number,
    Array,
    Promise,
    chrome: {
      runtime: { id: 'cie-test', onMessage: { addListener: callback => { listener = callback; } } },
      storage: {
        local: {
          get: async key => {
            await new Promise(resolve => setImmediate(resolve));
            return storage[key] ? { [key]: JSON.parse(JSON.stringify(storage[key])) } : {};
          },
          set: async update => {
            await new Promise(resolve => setImmediate(resolve));
            Object.assign(storage, JSON.parse(JSON.stringify(update)));
          }
        }
      }
    }
  });
  sandbox.globalThis = sandbox;
  sandbox.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), sandbox);
  const send = message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'cie-test' }, resolve), true);
  });
  return { listener, send };
}

const okRoutes = () => fakeFetch({
  '/api/geocode': GEOCODE,
  '/api/zones/check/v2': matchedZones({ tif: '87th/Cottage Grove' }),
  '/api/programs/match': PROGRAMS
});

test('repeated lookups are served from the 24h cache and drive the recent list', async () => {
  const storage = { unrelated: 'keep me' };
  const fetchImpl = okRoutes();
  const service = worker(storage, fetchImpl);
  const first = await service.send({ type: 'cie_lookup', address: '9300 S Drexel Ave' });
  assert.equal(first.result.status, 'ok');
  assert.equal(fetchImpl.calls.length, 3);

  const again = await service.send({ type: 'cie_lookup', address: '  9300   s drexel ave ' });
  assert.equal(again.result.address, '9300 S Drexel Ave');
  assert.equal(fetchImpl.calls.length, 3, 'a cache hit makes no network calls');

  assert.deepEqual(Object.keys(storage.cie_lookup_cache_v1), ['9300 s drexel ave']);
  assert.equal(storage.unrelated, 'keep me');
  const recent = await service.send({ type: 'cie_recent' });
  assert.deepEqual(recent.items.map(i => [i.address, i.matchedCount]), [['9300 S Drexel Ave', 1]]);
});

test('the cache keeps 20 entries, evicts least-recently-used, and drops stale ones', async () => {
  const now = Date.now();
  const storage = {
    cie_lookup_cache_v1: Object.fromEntries([
      ['expired', { savedAt: now - 25 * 3600 * 1000, usedAt: now - 25 * 3600 * 1000, result: { address: 'Expired', matched: [] } }],
      ...Array.from({ length: 20 }, (_, i) => [`addr ${i}`, { savedAt: now - 1000, usedAt: now - (30 - i) * 1000, result: { address: `Addr ${i}`, matched: [] } }])
    ])
  };
  const service = worker(storage, okRoutes());
  await service.send({ type: 'cie_lookup', address: '9300 S Drexel Ave' });
  const keys = Object.keys(storage.cie_lookup_cache_v1);
  assert.equal(keys.length, 20);
  assert.ok(keys.includes('9300 s drexel ave'));
  assert.ok(!keys.includes('expired'), 'entries older than 24h are gone');
  assert.ok(!keys.includes('addr 0'), 'the least recently used entry is evicted');

  const recent = await service.send({ type: 'cie_recent' });
  assert.equal(recent.items.length, 8);
  assert.equal(recent.items[0].address, '9300 S Drexel Ave');
});

test('simultaneous popup and content-script lookups are serialized', async () => {
  const storage = {};
  const fetchImpl = okRoutes();
  const service = worker(storage, fetchImpl);
  const responses = await Promise.all(Array.from({ length: 6 }, () => service.send({ type: 'cie_lookup', address: '9300 S Drexel Ave' })));
  assert.ok(responses.every(r => r.result.status === 'ok'));
  assert.equal(fetchImpl.calls.length, 3, 'only the first request goes to the network');
  assert.equal(Object.keys(storage.cie_lookup_cache_v1).length, 1);
});

test('a failed lookup answers with copy and is not cached', async () => {
  const storage = {};
  const service = worker(storage, fakeFetch({ '/api/geocode': { status: 'unavailable' } }));
  const response = await service.send({ type: 'cie_lookup', address: '9300 S Drexel Ave' });
  assert.equal(response.result, undefined);
  assert.equal(response.error, 'The address service is temporarily unavailable. Try again in a minute.');
  assert.deepEqual(storage.cie_lookup_cache_v1, undefined);
});

test('other extensions and unrelated messages are ignored', () => {
  const service = worker({}, okRoutes());
  const unexpected = () => assert.fail('unexpected response');
  assert.equal(service.listener({ type: 'cie_lookup', address: 'x' }, { id: 'someone-else' }, unexpected), false);
  assert.equal(service.listener({ type: 'unrelated' }, { id: 'cie-test' }, unexpected), false);
});

// --- packaging ------------------------------------------------------------

test('the manifest is valid JSON and every file it names exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.0');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://chicagoincentiveexplorer.com/*']);
  assert.equal(manifest.minimum_chrome_version, '116');

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])])
  ];
  for (const file of referenced) {
    assert.ok(fs.existsSync(path.join(root, file)), `manifest references a missing file: ${file}`);
  }
  // popup.html and the worker pull in files the manifest does not name.
  for (const file of ['lookup.js', 'popup.js', 'popup.css', 'privacy.html']) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
  const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.ok(popupHtml.indexOf('lookup.js') < popupHtml.indexOf('popup.js'), 'popup.html loads lookup.js first');
  assert.deepEqual(manifest.content_scripts[0].js, ['lookup.js', 'site-parsers.js', 'content.js']);
  assert.ok(fs.readFileSync(path.join(root, 'background.js'), 'utf8').includes('importScripts("lookup.js")'));
  assert.match(manifest.content_scripts[0].matches[0], /cookcountyassessor\.com/);
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
});
