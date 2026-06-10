const OPEN_METEO_POLLEN = [
  'alder_pollen',
  'birch_pollen',
  'grass_pollen',
  'mugwort_pollen',
  'olive_pollen',
  'ragweed_pollen',
];

const CATEGORY_DEFS = {
  aggregate: { label: 'All pollen', type: 'aggregate' },
  grass: { label: 'Grass', type: 'family' },
  tree: { label: 'Tree', type: 'family' },
  weed: { label: 'Weed', type: 'family' },
  alder: { label: 'Alder', type: 'plant' },
  birch: { label: 'Birch', type: 'plant' },
  mugwort: { label: 'Mugwort', type: 'plant' },
  olive: { label: 'Olive', type: 'plant' },
  ragweed: { label: 'Ragweed', type: 'plant' },
};

const GOOGLE_TYPE_MAP = {
  GRASS: 'grass',
  TREE: 'tree',
  WEED: 'weed',
};

const GOOGLE_PLANT_MAP = {
  ALDER: 'alder',
  BIRCH: 'birch',
  GRAMINALES: 'grass',
  MUGWORT: 'mugwort',
  OLIVE: 'olive',
  RAGWEED: 'ragweed',
};

const TOMORROW_FIELD_MAP = {
  grassIndex: 'grass',
  treeIndex: 'tree',
  weedIndex: 'weed',
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
const HAS_API_BASE = Boolean(API_BASE_URL);
const IS_LOCALHOST = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname);
const USE_LOCAL_API = IS_LOCALHOST && !HAS_API_BASE;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function categoryName(key) {
  return CATEGORY_DEFS[key]?.label || key;
}

function rawConcentrationToIndex(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 5) return 1;
  if (value < 20) return 2;
  if (value < 50) return 3;
  if (value < 100) return 4;
  return 5;
}

function indexToScore(index) {
  return clamp((Number(index) || 0) * 20, 0, 100);
}

function makeSignal({ category, value, index, units, sourceDetail, confidence = 0.8 }) {
  const normalizedIndex = clamp(Number(index ?? rawConcentrationToIndex(value)), 0, 5);
  return {
    category,
    label: categoryName(category),
    value: Number.isFinite(value) ? Number(value.toFixed(2)) : null,
    units,
    index: Number(normalizedIndex.toFixed(2)),
    score: Number(indexToScore(normalizedIndex).toFixed(1)),
    sourceDetail,
    confidence,
  };
}

function emptyProvider(id, name, status, notes = [], error = '') {
  return {
    id,
    name,
    status,
    notes,
    error,
    modelFamily: id,
    categories: {},
    receivedAt: new Date().toISOString(),
  };
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    return JSON.parse(text);
  } finally {
    window.clearTimeout(timeout);
  }
}

function findCurrentOpenMeteoValues(data) {
  if (data.current) return data.current;
  const hourly = data.hourly || {};
  const times = hourly.time || [];
  const now = Date.now();
  let nearestIndex = 0;
  let nearestDistance = Infinity;

  times.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - now);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });

  return Object.fromEntries(
    OPEN_METEO_POLLEN.map((key) => [key, Number(hourly[key]?.[nearestIndex] ?? 0)]),
  );
}

function openMeteoCategoryValue(current, category) {
  const values = {
    alder: Number(current.alder_pollen || 0),
    birch: Number(current.birch_pollen || 0),
    grass: Number(current.grass_pollen || 0),
    mugwort: Number(current.mugwort_pollen || 0),
    olive: Number(current.olive_pollen || 0),
    ragweed: Number(current.ragweed_pollen || 0),
  };

  if (category === 'aggregate') {
    return values.alder + values.birch + values.grass + values.mugwort + values.olive + values.ragweed;
  }
  if (category === 'tree') return values.alder + values.birch + values.olive;
  if (category === 'weed') return values.mugwort + values.ragweed;
  return values[category] ?? values.grass;
}

async function fetchOpenMeteo(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: OPEN_METEO_POLLEN.join(','),
    hourly: OPEN_METEO_POLLEN.join(','),
    forecast_days: '1',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  const values = findCurrentOpenMeteoValues(data);
  const categories = {};

  const species = {
    alder: Number(values.alder_pollen || 0),
    birch: Number(values.birch_pollen || 0),
    grass: Number(values.grass_pollen || 0),
    mugwort: Number(values.mugwort_pollen || 0),
    olive: Number(values.olive_pollen || 0),
    ragweed: Number(values.ragweed_pollen || 0),
  };

  const family = {
    grass: species.grass,
    tree: species.alder + species.birch + species.olive,
    weed: species.mugwort + species.ragweed,
  };

  for (const [category, value] of Object.entries({ ...family, ...species })) {
    categories[category] = makeSignal({
      category,
      value,
      units: 'grains/m3',
      sourceDetail: 'Open-Meteo current CAMS pollen concentration',
      confidence: 0.82,
    });
  }

  categories.aggregate = makeSignal({
    category: 'aggregate',
    value: family.grass + family.tree + family.weed,
    units: 'grains/m3',
    sourceDetail: 'Sum of Open-Meteo grass, tree, and weed pollen',
    confidence: 0.82,
  });

  return {
    id: 'openmeteo',
    name: 'Open-Meteo / CAMS',
    status: 'ok',
    modelFamily: 'CAMS',
    categories,
    receivedAt: new Date().toISOString(),
    notes: ['Hourly raw pollen concentrations from the CAMS model family.'],
  };
}

async function fetchGooglePollen(lat, lng) {
  const key = import.meta.env.VITE_GOOGLE_POLLEN_API_KEY;
  if (!key) {
    return emptyProvider(
      'google',
      'Google Pollen API',
      'needs-backend',
      ['Google Pollen needs VITE_API_BASE_URL on GitHub Pages so the API key stays server-side.'],
      'Google Pollen is disabled on this static deployment until an API backend is configured.',
    );
  }

  const params = new URLSearchParams({
    key,
    'location.longitude': String(lng),
    'location.latitude': String(lat),
    days: '1',
    plantsDescription: 'false',
  });
  const data = await fetchJson(`https://pollen.googleapis.com/v1/forecast:lookup?${params}`);
  const day = data.dailyInfo?.[0] || {};
  const categories = {};

  for (const typeInfo of day.pollenTypeInfo || []) {
    const category = GOOGLE_TYPE_MAP[typeInfo.code];
    const value = typeInfo.indexInfo?.value;
    if (!category || !Number.isFinite(Number(value))) continue;
    categories[category] = makeSignal({
      category,
      index: Number(value),
      units: 'UPI 0-5',
      sourceDetail: `${typeInfo.displayName || typeInfo.code} ${typeInfo.indexInfo?.category || ''}`.trim(),
      confidence: typeInfo.inSeason === false ? 0.64 : 0.78,
    });
  }

  for (const plantInfo of day.plantInfo || []) {
    const category = GOOGLE_PLANT_MAP[plantInfo.code];
    const value = plantInfo.indexInfo?.value;
    if (!category || !Number.isFinite(Number(value)) || categories[category]) continue;
    categories[category] = makeSignal({
      category,
      index: Number(value),
      units: 'UPI 0-5',
      sourceDetail: `${plantInfo.displayName || plantInfo.code} ${plantInfo.indexInfo?.category || ''}`.trim(),
      confidence: plantInfo.inSeason === false ? 0.58 : 0.72,
    });
  }

  const familySignals = ['grass', 'tree', 'weed'].map((keyName) => categories[keyName]).filter(Boolean);
  if (familySignals.length > 0) {
    const avg = familySignals.reduce((sum, signal) => sum + signal.index, 0) / familySignals.length;
    categories.aggregate = makeSignal({
      category: 'aggregate',
      index: avg,
      units: 'UPI 0-5',
      sourceDetail: 'Average of Google grass, tree, and weed UPI signals',
      confidence: 0.76,
    });
  }

  return {
    id: 'google',
    name: 'Google Pollen API',
    status: 'ok',
    modelFamily: 'Google',
    categories,
    receivedAt: new Date().toISOString(),
    notes: [`Region ${data.regionCode || 'unknown'}; daily UPI forecast.`],
  };
}

async function fetchTomorrow(lat, lng) {
  const key = import.meta.env.VITE_TOMORROW_API_KEY;
  if (!key) {
    return emptyProvider(
      'tomorrow',
      'Tomorrow.io',
      'needs-backend',
      ['Tomorrow.io needs VITE_API_BASE_URL on GitHub Pages so the API key stays server-side.'],
      'Tomorrow.io is disabled on this static deployment until an API backend is configured.',
    );
  }

  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    fields: Object.keys(TOMORROW_FIELD_MAP).join(','),
    timesteps: '1d',
    units: 'metric',
    apikey: key,
  });
  const data = await fetchJson(`https://api.tomorrow.io/v4/timelines?${params}`);
  const values = data.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const categories = {};

  for (const [field, category] of Object.entries(TOMORROW_FIELD_MAP)) {
    const value = Number(values[field]);
    if (!Number.isFinite(value)) continue;
    categories[category] = makeSignal({
      category,
      index: value,
      units: 'index 0-5',
      sourceDetail: `Tomorrow.io ${field}`,
      confidence: 0.72,
    });
  }

  const familySignals = ['grass', 'tree', 'weed'].map((keyName) => categories[keyName]).filter(Boolean);
  if (familySignals.length > 0) {
    const avg = familySignals.reduce((sum, signal) => sum + signal.index, 0) / familySignals.length;
    categories.aggregate = makeSignal({
      category: 'aggregate',
      index: avg,
      units: 'index 0-5',
      sourceDetail: 'Average of Tomorrow.io grass, tree, and weed indices',
      confidence: 0.72,
    });
  }

  return {
    id: 'tomorrow',
    name: 'Tomorrow.io',
    status: 'ok',
    modelFamily: 'Tomorrow.io',
    categories,
    receivedAt: new Date().toISOString(),
    notes: ['Daily pollen index fields; availability may depend on account entitlement.'],
  };
}

function statusProvider(id, name, error) {
  return {
    ...emptyProvider(id, name, 'error', [error.message], error.message),
    error: error.message,
  };
}

function synthesize(providers) {
  const ensemble = {};
  const present = new Set(['aggregate']);

  for (const provider of providers) {
    for (const category of Object.keys(provider.categories || {})) {
      present.add(category);
    }
  }

  for (const category of present) {
    const signals = providers
      .map((provider) => {
        const signal = provider.categories?.[category];
        if (!signal) return null;
        return {
          providerId: provider.id,
          providerName: provider.name,
          modelFamily: provider.modelFamily,
          ...signal,
        };
      })
      .filter(Boolean);

    if (signals.length === 0) continue;

    const totalWeight = signals.reduce((sum, signal) => sum + signal.confidence, 0);
    const weightedScore =
      signals.reduce((sum, signal) => sum + signal.score * signal.confidence, 0) / totalWeight;
    const weightedIndex =
      signals.reduce((sum, signal) => sum + signal.index * signal.confidence, 0) / totalWeight;

    ensemble[category] = {
      key: category,
      label: categoryName(category),
      type: CATEGORY_DEFS[category]?.type || 'plant',
      score: Number(weightedScore.toFixed(1)),
      index: Number(weightedIndex.toFixed(2)),
      signalCount: signals.length,
      signals,
    };
  }

  return ensemble;
}

async function buildBrowserForecast(lat, lng) {
  const settled = await Promise.allSettled([
    fetchOpenMeteo(lat, lng),
    fetchGooglePollen(lat, lng),
    fetchTomorrow(lat, lng),
  ]);

  const providers = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    if (index === 0) return statusProvider('openmeteo', 'Open-Meteo / CAMS', result.reason);
    if (index === 1) return statusProvider('google', 'Google Pollen API', result.reason);
    return statusProvider('tomorrow', 'Tomorrow.io', result.reason);
  });

  const ensemble = synthesize(providers);
  const categories = Object.values(ensemble).sort((a, b) => {
    if (a.key === 'aggregate') return -1;
    if (b.key === 'aggregate') return 1;
    return a.label.localeCompare(b.label);
  });

  return {
    location: { lat, lng },
    generatedAt: new Date().toISOString(),
    categories,
    ensemble,
    providers,
    caveats: [
      'Open-Meteo uses the CAMS model family, so CAMS is not counted as a separate ensemble member.',
      'GitHub Pages is static; configure VITE_API_BASE_URL for server-side Google and Tomorrow.io provider access.',
    ],
    staticMode: !HAS_API_BASE && !USE_LOCAL_API,
  };
}

async function fetchOpenMeteoGrid(bounds, category) {
  const rows = 8;
  const cols = 8;
  const latStep = (bounds.north - bounds.south) / Math.max(rows - 1, 1);
  const lngStep = (bounds.east - bounds.west) / Math.max(cols - 1, 1);
  const points = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        lat: bounds.south + latStep * row,
        lng: bounds.west + lngStep * col,
      });
    }
  }

  const params = new URLSearchParams({
    latitude: points.map((point) => point.lat.toFixed(5)).join(','),
    longitude: points.map((point) => point.lng.toFixed(5)).join(','),
    current: OPEN_METEO_POLLEN.join(','),
    forecast_days: '1',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  const payloads = Array.isArray(data) ? data : [data];

  const gridPoints = payloads.map((payload, index) => {
    const sourcePoint = points[index] || { lat: payload.latitude, lng: payload.longitude };
    const value = openMeteoCategoryValue(payload.current || {}, category);
    return {
      lat: Number(sourcePoint.lat.toFixed(5)),
      lng: Number(sourcePoint.lng.toFixed(5)),
      value: Number(value.toFixed(2)),
      score: Number(indexToScore(rawConcentrationToIndex(value)).toFixed(1)),
    };
  });

  const values = gridPoints.map((point) => point.value);
  return {
    category,
    label: categoryName(category),
    units: 'grains/m3',
    source: 'Open-Meteo / CAMS coordinate-list grid',
    generatedAt: new Date().toISOString(),
    bounds,
    rows,
    cols,
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
    points: gridPoints,
  };
}

function apiUrl(path, params) {
  const query = new URLSearchParams(params).toString();
  return `${API_BASE_URL}${path}?${query}`;
}

async function fetchApiJson(path, params, signal) {
  const response = await fetch(apiUrl(path, params), { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Unable to load ${path}`);
  return data;
}

export function fetchForecast({ lat, lng, signal }) {
  if (HAS_API_BASE || USE_LOCAL_API) return fetchApiJson('/api/forecast', { lat, lng }, signal);
  return buildBrowserForecast(lat, lng);
}

export function fetchGrid({ bounds, category, signal }) {
  if (HAS_API_BASE || USE_LOCAL_API) {
    return fetchApiJson('/api/grid', {
      ...Object.fromEntries(
        Object.entries(bounds).map(([key, value]) => [key, String(Number(value).toFixed(5))]),
      ),
      category,
    }, signal);
  }
  return fetchOpenMeteoGrid(bounds, category);
}
