// The whole lookup pipeline, as pure functions over an injected fetch.
// Loaded by the service worker with importScripts and by the Node tests with require.
(() => {
  const ORIGIN = "https://chicagoincentiveexplorer.com";
  const TIMEOUT_MS = 10000;
  // Anything outside the city cannot be covered by the Explorer, so it never reaches the zone APIs.
  const CHICAGO_BOUNDS = { south: 41.6445, west: -87.9401, north: 42.0231, east: -87.5237 };
  const NOT_FOUND_MESSAGE = "We couldn't find that Chicago address.";
  const UNAVAILABLE_MESSAGE = "The address service is temporarily unavailable. Try again in a minute.";

  // Display order of the panel and the popup follows this object.
  const LAYER_LABELS = {
    tif: "TIF District",
    federalOZ: "Opportunity Zone",
    enterprise: "Enterprise Zone",
    stateIncentiveZones: "State Incentive Zone",
    ssa: "Special Service Area",
    highUnemployment: "High-Unemployment Area",
    ccsa: "Community Catalyst / CCSA",
    industrialCorridors: "Industrial Corridor",
    microMarketRecovery: "Micro Market Recovery",
    nof: "Neighborhood Opportunity Fund",
    nmtcEligible: "NMTC Eligible",
    qct: "Qualified Census Tract",
    landmarkDistricts: "Landmark District",
    nrhpDistricts: "National Register District",
    energyCommunities: "Energy Community",
    hubzone: "HUBZone"
  };

  const collapse = value => String(value === undefined || value === null ? "" : value).trim().replace(/\s+/g, " ");

  // Cache key: one entry per address, however the user happened to type it.
  const normalizeAddress = address => collapse(address).toLowerCase();

  // The Explorer only covers Chicago, so the city is always part of the geocode query.
  const buildGeocodeQuery = address => {
    const clean = collapse(address);
    return /chicago/i.test(clean) ? clean : `${clean}, Chicago, IL`;
  };

  const buildReportUrl = (lat, lon, address) =>
    `${ORIGIN}/report?instant=true&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    `&addr=${encodeURIComponent(collapse(address))}&src=extension`;

  // Only http(s) links are ever rendered; anything else (javascript:, data:) becomes plain text.
  function safeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  const insideChicago = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= CHICAGO_BOUNDS.south && lat <= CHICAGO_BOUNDS.north &&
    lon >= CHICAGO_BOUNDS.west && lon <= CHICAGO_BOUNDS.east;

  // One row per requested layer, in label order; any state but the two documented ones is unknown.
  function normalizeLayers(payload) {
    const layers = payload && typeof payload.layers === "object" && payload.layers ? payload.layers : {};
    const requested = Array.isArray(payload && payload.requestedLayers) && payload.requestedLayers.length
      ? payload.requestedLayers.filter(key => typeof key === "string")
      : Object.keys(LAYER_LABELS);
    const known = Object.keys(LAYER_LABELS).filter(key => requested.includes(key));
    const extra = requested.filter(key => !LAYER_LABELS[key] && !known.includes(key));
    return [...known, ...extra].map(key => {
      const entry = layers[key] && typeof layers[key] === "object" ? layers[key] : {};
      const state = entry.state === "matched" || entry.state === "not_matched" ? entry.state : "unknown";
      return {
        key,
        label: LAYER_LABELS[key] || key,
        state,
        name: state === "matched" ? collapse(entry.name) : ""
      };
    });
  }

  // The match endpoint wants a flag for every requested layer and a name for the matched ones.
  function layersToZones(layers) {
    const zones = {};
    const zoneNames = {};
    for (const layer of Array.isArray(layers) ? layers : []) {
      zones[layer.key] = layer.state === "matched";
      if (layer.state === "matched" && layer.name) zoneNames[layer.key] = layer.name;
    }
    return { zones, zoneNames };
  }

  function normalizePrograms(payload) {
    const programs = Array.isArray(payload && payload.programs) ? payload.programs : [];
    return programs.slice(0, 3).map(entry => {
      const program = entry && typeof entry.program === "object" && entry.program ? entry.program : {};
      return {
        id: collapse(program.id || (entry && entry.programId)),
        name: collapse(program.name),
        level: collapse(program.level),
        zoneKey: collapse(program.zoneKey),
        url: safeHttpUrl(program.url) || ""
      };
    }).filter(program => program.name);
  }

  // acceptStatuses lets a documented failure (the geocoder's 404 for a non-match)
  // come back as data instead of an exception.
  async function requestJson(fetchImpl, url, init, acceptStatuses) {
    const accept = Array.isArray(acceptStatuses) ? acceptStatuses : [];
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
      const response = await fetchImpl(url, Object.assign({}, init, controller ? { signal: controller.signal } : {}));
      if (!response) throw new Error(`Request failed: ${url}`);
      const failed = response.ok === false;
      if (failed && !accept.includes(response.status)) throw new Error(`Request failed: ${url}`);
      let body = null;
      try {
        body = await response.json();
      } catch (error) {
        if (!failed) throw error;
      }
      return failed ? Object.assign({ httpStatus: response.status }, body || {}) : body;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const unavailable = () => ({ status: "unavailable", message: UNAVAILABLE_MESSAGE });
  const notFound = () => ({ status: "not_found", message: NOT_FOUND_MESSAGE });

  async function lookupAddress(fetchImpl, address) {
    const display = collapse(address);
    if (!display) return notFound();

    let geocode;
    try {
      geocode = await requestJson(fetchImpl, `${ORIGIN}/api/geocode?address=${encodeURIComponent(buildGeocodeQuery(display))}`, undefined, [404]);
    } catch {
      return unavailable();
    }
    if (!geocode || typeof geocode !== "object") return unavailable();
    // The live geocoder answers a non-match with 404 and {error, status:"not_found"}.
    if (geocode.httpStatus === 404 || geocode.status === "not_found") return notFound();
    if (geocode.status === "unavailable" || geocode.error) return unavailable();

    const lat = Number(geocode.lat);
    const lon = Number(geocode.lon);
    if (!insideChicago(lat, lon)) return notFound();

    let zonePayload;
    try {
      zonePayload = await requestJson(fetchImpl, `${ORIGIN}/api/zones/check/v2?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    } catch {
      return unavailable();
    }
    const layers = normalizeLayers(zonePayload);
    if (!layers.length) return unavailable();
    const { zones, zoneNames } = layersToZones(layers);

    let matchPayload;
    try {
      matchPayload = await requestJson(fetchImpl, `${ORIGIN}/api/programs/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones, zoneNames })
      });
    } catch {
      return unavailable();
    }

    return {
      status: "ok",
      address: display,
      displayName: collapse(geocode.displayName),
      matchQuality: collapse(geocode.matchQuality),
      lat,
      lon,
      dataRevision: collapse(zonePayload && zonePayload.dataRevision),
      checkedAt: collapse(zonePayload && zonePayload.checkedAt),
      layers,
      matched: layers.filter(layer => layer.state === "matched"),
      programs: normalizePrograms(matchPayload),
      reportUrl: buildReportUrl(lat, lon, display)
    };
  }

  const api = {
    ORIGIN,
    TIMEOUT_MS,
    CHICAGO_BOUNDS,
    LAYER_LABELS,
    NOT_FOUND_MESSAGE,
    UNAVAILABLE_MESSAGE,
    normalizeAddress,
    buildGeocodeQuery,
    buildReportUrl,
    insideChicago,
    safeHttpUrl,
    normalizeLayers,
    layersToZones,
    normalizePrograms,
    lookupAddress
  };

  globalThis.CieLookup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
