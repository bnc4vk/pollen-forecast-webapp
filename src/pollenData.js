const OPEN_METEO_POLLEN = [
  'alder_pollen',
  'birch_pollen',
  'grass_pollen',
  'mugwort_pollen',
  'olive_pollen',
  'ragweed_pollen',
];

const CATEGORY_DEFS = {
  aggregate: { label: 'Worst allergen', type: 'aggregate' },
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
const MAX_TIMELAPSE_HOURS = 8;
const FORECAST_CELL_KM = 11;
const MAX_FORECAST_CELLS = 160000;
const MAX_OPEN_METEO_FORECAST_POINTS = 280;
const OPEN_METEO_COORDINATE_BATCH_SIZE = 300;
const WEATHER_GRID_ROWS = 4;
const WEATHER_GRID_COLS = 4;
const openMeteoGridCache = new Map();

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
    return Math.max(
      values.grass,
      values.alder + values.birch + values.olive,
      values.mugwort + values.ragweed,
    );
  }
  if (category === 'tree') return values.alder + values.birch + values.olive;
  if (category === 'weed') return values.mugwort + values.ragweed;
  return values[category] ?? values.grass;
}

function openMeteoHourlyValues(hourly, index) {
  return Object.fromEntries(
    OPEN_METEO_POLLEN.map((key) => [key, Number(hourly?.[key]?.[index] ?? 0)]),
  );
}

function nearestHourlyIndex(hourly) {
  const times = hourly?.time || [];
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

  return nearestIndex;
}

function buildGridPoints(bounds, rows, cols) {
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

  return points;
}

function buildForecastCells(bounds, cellKm = FORECAST_CELL_KM) {
  const latStep = cellKm / 111.32;
  const southIndex = Math.floor((bounds.south + 90) / latStep);
  const northIndex = Math.floor((bounds.north + 90) / latStep);
  const cells = [];

  for (let latIndex = southIndex; latIndex <= northIndex; latIndex += 1) {
    const south = latIndex * latStep - 90;
    const north = south + latStep;
    const lat = (south + north) / 2;
    const lngStep = cellKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
    const westIndex = Math.floor((bounds.west + 180) / lngStep);
    const eastIndex = Math.floor((bounds.east + 180) / lngStep);

    for (let lngIndex = westIndex; lngIndex <= eastIndex; lngIndex += 1) {
      const west = lngIndex * lngStep - 180;
      const east = west + lngStep;
      const lng = (west + east) / 2;
      cells.push({
        id: `${cellKm}:${latIndex}:${lngIndex}`,
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        bounds: {
          north: Number(north.toFixed(5)),
          south: Number(south.toFixed(5)),
          east: Number(east.toFixed(5)),
          west: Number(west.toFixed(5)),
        },
      });
    }
  }

  if (cells.length > MAX_FORECAST_CELLS) {
    throw new Error(`This forecast view contains ${cells.length} cells; narrow the map area to load 11 km forecast tiles.`);
  }

  return cells;
}

function buildForecastSamplePoints(bounds, maxPoints = MAX_OPEN_METEO_FORECAST_POINTS) {
  const latSpan = Math.max(bounds.north - bounds.south, 0.0001);
  const lngSpan = Math.max(bounds.east - bounds.west, 0.0001);
  const aspect = lngSpan / latSpan;
  const cols = Math.max(2, Math.round(Math.sqrt(maxPoints * aspect)));
  const rows = Math.max(2, Math.floor(maxPoints / cols));
  const latStep = latSpan / Math.max(rows - 1, 1);
  const lngStep = lngSpan / Math.max(cols - 1, 1);
  const points = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const lat = bounds.south + latStep * row;
      const lng = bounds.west + lngStep * col;
      points.push({
        id: `sample:${row}:${col}`,
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
      });
    }
  }

  return { points, rows, cols };
}

function classifyRain({ precipitation = 0, weatherCode = 0, windGusts = 0 }) {
  const stormCode = [95, 96, 99].includes(Number(weatherCode));
  if (stormCode || (precipitation >= 2.5 && windGusts >= 28) || precipitation >= 6) {
    return {
      key: 'storm',
      label: 'Storm rain',
      multiplier: 1.12,
      guidance: 'Storm rain is treated cautiously because fragmentation and downdrafts can worsen exposure.',
    };
  }
  if (precipitation >= 0.1) {
    return {
      key: 'steady',
      label: 'Rain nearby',
      multiplier: 0.74,
      guidance: 'Rain is treated as a temporary washout input where it is falling steadily.',
    };
  }
  return {
    key: 'dry',
    label: 'No rain',
    multiplier: 1,
    guidance: 'No meaningful rain is currently reducing airborne pollen.',
  };
}

function classifyWind({ windSpeed = 0, windGusts = 0 }) {
  if (windSpeed >= 24 || windGusts >= 35) {
    return {
      key: 'gusty',
      label: 'Gusty',
      multiplier: 1.28,
      guidance: 'Gusty wind can lift and redistribute pollen quickly.',
    };
  }
  if (windSpeed >= 10 || windGusts >= 18) {
    return {
      key: 'breezy',
      label: 'Breezy',
      multiplier: 1.08,
      guidance: 'Breezy conditions can move pollen farther from source areas.',
    };
  }
  return {
    key: 'calm',
    label: 'Calm',
    multiplier: 0.92,
    guidance: 'Calm air limits pollen spread.',
  };
}

function weatherProminenceFromLive(rain, wind) {
  const stormGustBoost = rain.key === 'storm' && wind.key === 'gusty' ? 1.12 : 1;
  return clamp(rain.multiplier * wind.multiplier * stormGustBoost, 0.55, 1.65);
}

function summarizeWeather(points) {
  const precipitation = Math.max(...points.map((point) => point.precipitation), 0);
  const windSpeed = points.reduce((sum, point) => sum + point.windSpeed, 0) / Math.max(points.length, 1);
  const windGusts = Math.max(...points.map((point) => point.windGusts), 0);
  const weatherCode = points.find((point) => [95, 96, 99].includes(point.weatherCode))?.weatherCode || points[0]?.weatherCode || 0;
  const rain = classifyRain({ precipitation, weatherCode, windGusts });
  const wind = classifyWind({ windSpeed, windGusts });
  const multiplier = weatherProminenceFromLive(rain, wind);

  return {
    rain,
    wind,
    multiplier,
    precipitation: Number(precipitation.toFixed(2)),
    windSpeed: Number(windSpeed.toFixed(1)),
    windGusts: Number(windGusts.toFixed(1)),
    guidance:
      rain.key === 'storm'
        ? rain.guidance
        : wind.key === 'gusty'
          ? wind.guidance
          : rain.key === 'steady'
            ? rain.guidance
            : 'Live rain and wind are applied as high-level exposure context.',
  };
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

  const dominantFamily = Object.entries(family).reduce(
    (dominant, entry) => (entry[1] > dominant[1] ? entry : dominant),
    ['grass', family.grass],
  );
  categories.aggregate = makeSignal({
    category: 'aggregate',
    value: dominantFamily[1],
    index: Math.max(...Object.values(family).map(rawConcentrationToIndex)),
    units: 'grains/m3',
    sourceDetail: `Highest Open-Meteo family severity (${categoryName(dominantFamily[0])})`,
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
    const highest = familySignals.reduce(
      (dominant, signal) => (signal.index > dominant.index ? signal : dominant),
      familySignals[0],
    );
    categories.aggregate = makeSignal({
      category: 'aggregate',
      index: highest.index,
      units: 'UPI 0-5',
      sourceDetail: `Highest Google family severity (${highest.label})`,
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
  if (import.meta.env.VITE_ENABLE_TOMORROW_POLLEN !== 'true') {
    return emptyProvider(
      'tomorrow',
      'Tomorrow.io',
      'disabled-premium',
      ['Pollen is a Tomorrow.io premium layer and is disabled until entitlement is confirmed.'],
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
    const highest = familySignals.reduce(
      (dominant, signal) => (signal.index > dominant.index ? signal : dominant),
      familySignals[0],
    );
    categories.aggregate = makeSignal({
      category: 'aggregate',
      index: highest.index,
      units: 'index 0-5',
      sourceDetail: `Highest Tomorrow.io family severity (${highest.label})`,
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
  const present = new Set();

  for (const provider of providers) {
    for (const category of Object.keys(provider.categories || {})) {
      if (category !== 'aggregate') present.add(category);
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

  const familyScores = ['grass', 'tree', 'weed']
    .map((category) => ensemble[category])
    .filter(Boolean);
  if (familyScores.length > 0) {
    const worst = familyScores.reduce(
      (highest, category) => (category.score > highest.score ? category : highest),
      familyScores[0],
    );
    ensemble.aggregate = {
      ...worst,
      key: 'aggregate',
      label: categoryName('aggregate'),
      type: 'aggregate',
      dominantCategory: worst.key,
    };
  }

  return ensemble;
}

async function buildBrowserForecast(lat, lng) {
  const settled = await Promise.allSettled([
    fetchOpenMeteo(lat, lng),
    fetchGooglePollen(lat, lng),
  ]);

  const providers = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    if (index === 0) return statusProvider('openmeteo', 'Open-Meteo / CAMS', result.reason);
    return statusProvider('google', 'Google Pollen API', result.reason);
  });
  providers.splice(
    2,
    0,
    emptyProvider(
      'polleninformation',
      'Austrian Pollen Information Service',
      'backend-required',
      ['The Austrian official feed is enabled through the API backend in its supported countries.'],
    ),
  );
  providers.splice(
    3,
    0,
    emptyProvider(
      'metoffice',
      'Met Office Pollen',
      'backend-required',
      ['The Met Office regional feed is enabled through the API backend.'],
    ),
  );

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
      'Austrian Pollen Information Service data is available through the configured API backend in its supported countries.',
      'Met Office pollen is available through the configured API backend for UK locations.',
      'Worst allergen is the highest confidence-weighted ensemble score among grass, tree, and weed.',
      'GitHub Pages is static; configure VITE_API_BASE_URL for server-side provider access.',
    ],
    staticMode: !HAS_API_BASE && !USE_LOCAL_API,
  };
}

async function fetchOpenMeteoGrid(bounds, category, horizonHours = MAX_TIMELAPSE_HOURS) {
  const safeHorizon = clamp(Number(horizonHours) || MAX_TIMELAPSE_HOURS, 1, MAX_TIMELAPSE_HOURS);
  const cacheKey = JSON.stringify({
    bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Number(value).toFixed(3)])),
    category,
    safeHorizon,
  });
  const cached = openMeteoGridCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) return cached.value;

  const cells = buildForecastCells(bounds);
  const sampled = cells.length > MAX_OPEN_METEO_FORECAST_POINTS;
  const sampleGrid = sampled ? buildForecastSamplePoints(bounds) : { points: cells, rows: null, cols: null };
  const requestPoints = sampleGrid.points;
  const batchRequests = [];

  for (let index = 0; index < requestPoints.length; index += OPEN_METEO_COORDINATE_BATCH_SIZE) {
    const batch = requestPoints.slice(index, index + OPEN_METEO_COORDINATE_BATCH_SIZE);
    const params = new URLSearchParams({
      latitude: batch.map((cell) => cell.lat.toFixed(5)).join(','),
      longitude: batch.map((cell) => cell.lng.toFixed(5)).join(','),
      hourly: OPEN_METEO_POLLEN.join(','),
      forecast_days: '2',
      timezone: 'auto',
    });
    batchRequests.push(fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`));
  }

  const payloads = (await Promise.all(batchRequests)).flatMap((data) => (Array.isArray(data) ? data : [data]));
  const startIndices = payloads.map((payload) => nearestHourlyIndex(payload.hourly || {}));

  const frames = Array.from({ length: safeHorizon + 1 }, (_, offsetHours) => {
    const gridPoints = payloads.map((payload, index) => {
      const sourceCell = requestPoints[index] || { lat: payload.latitude, lng: payload.longitude };
      const hourly = payload.hourly || {};
      const values = openMeteoHourlyValues(hourly, Math.min((startIndices[index] || 0) + offsetHours, (hourly.time?.length || 1) - 1));
      const value = openMeteoCategoryValue(values, category);
      return {
        id: sourceCell.id || `forecast:${index}`,
        lat: Number(sourceCell.lat.toFixed(5)),
        lng: Number(sourceCell.lng.toFixed(5)),
        bounds: sampled ? undefined : sourceCell.bounds,
        value: Number(value.toFixed(2)),
        score: Number(indexToScore(rawConcentrationToIndex(value)).toFixed(1)),
      };
    });
    const values = gridPoints.map((point) => point.value);
    const firstHourly = payloads[0]?.hourly || {};
    const firstTimeIndex = Math.min((startIndices[0] || 0) + offsetHours, (firstHourly.time?.length || 1) - 1);

    return {
      offsetHours,
      time: firstHourly.time?.[firstTimeIndex] || null,
      min: Number(Math.min(...values).toFixed(2)),
      max: Number(Math.max(...values).toFixed(2)),
      points: gridPoints,
    };
  });

  const firstFrame = frames[0] || { min: 0, max: 0, points: [] };
  const frameMins = frames.map((frame) => frame.min);
  const frameMaxes = frames.map((frame) => frame.max);
  const result = {
    category,
    label: categoryName(category),
    units: 'grains/m3',
    source: 'Open-Meteo / CAMS hourly coordinate-list grid',
    scaleKm: FORECAST_CELL_KM,
    scaleLabel: '11 km forecast tile',
    sampled,
    sampleRows: sampleGrid.rows,
    sampleCols: sampleGrid.cols,
    displayCellCount: cells.length,
    generatedAt: new Date().toISOString(),
    bounds,
    horizonHours: safeHorizon,
    offsetHours: firstFrame.offsetHours,
    time: firstFrame.time,
    min: Number(Math.min(...frameMins).toFixed(2)),
    max: Number(Math.max(...frameMaxes).toFixed(2)),
    points: firstFrame.points,
    frames,
  };
  openMeteoGridCache.set(cacheKey, { cachedAt: Date.now(), value: result });
  return result;
}

async function buildBrowserWeather(lat, lng, bounds) {
  const rows = WEATHER_GRID_ROWS;
  const cols = WEATHER_GRID_COLS;
  const points = bounds ? buildGridPoints(bounds, rows, cols) : [{ lat, lng }];
  const params = new URLSearchParams({
    latitude: points.map((point) => Number(point.lat).toFixed(5)).join(','),
    longitude: points.map((point) => Number(point.lng).toFixed(5)).join(','),
    current: 'precipitation,rain,showers,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    forecast_hours: '3',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const payloads = Array.isArray(data) ? data : [data];
  const weatherPoints = payloads.map((payload, index) => {
    const sourcePoint = points[index] || { lat: payload.latitude, lng: payload.longitude };
    const current = payload.current || {};
    const precipitation = Number(current.precipitation || 0);
    const windSpeed = Number(current.wind_speed_10m || 0);
    const windGusts = Number(current.wind_gusts_10m || windSpeed);
    const weatherCode = Number(current.weather_code || 0);

    return {
      lat: Number(sourcePoint.lat.toFixed(5)),
      lng: Number(sourcePoint.lng.toFixed(5)),
      precipitation: Number(precipitation.toFixed(2)),
      rain: Number(current.rain || 0),
      showers: Number(current.showers || 0),
      weatherCode,
      windSpeed: Number(windSpeed.toFixed(1)),
      windGusts: Number(windGusts.toFixed(1)),
      windDirection: Number(current.wind_direction_10m || 0),
      rainKey: classifyRain({ precipitation, weatherCode, windGusts }).key,
      windKey: classifyWind({ windSpeed, windGusts }).key,
    };
  });
  const summary = summarizeWeather(weatherPoints);

  return {
    source: 'Open-Meteo Weather Forecast',
    generatedAt: new Date().toISOString(),
    location: { lat, lng },
    bounds,
    rows,
    cols,
    points: weatherPoints,
    ...summary,
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

export function fetchRegions({ signal } = {}) {
  if (HAS_API_BASE || USE_LOCAL_API) return fetchApiJson('/api/regions', {}, signal);
  throw new Error('The regional ensemble requires the API backend.');
}

export function fetchSpatial({ bounds, zoom, signal }) {
  if (HAS_API_BASE || USE_LOCAL_API) {
    return fetchApiJson('/api/spatial', {
      ...Object.fromEntries(
        Object.entries(bounds).map(([key, value]) => [key, String(Number(value).toFixed(5))]),
      ),
      zoom: String(Number(zoom).toFixed(2)),
    }, signal);
  }
  throw new Error('Adaptive spatial pollen cells require the API backend.');
}

export function fetchGrid({ bounds, category, horizonHours = MAX_TIMELAPSE_HOURS, coverage = 'bounds', signal }) {
  if (HAS_API_BASE || USE_LOCAL_API) {
    return fetchApiJson('/api/grid', {
      ...Object.fromEntries(
        Object.entries(bounds).map(([key, value]) => [key, String(Number(value).toFixed(5))]),
      ),
      category,
      horizonHours,
      coverage,
    }, signal);
  }
  return fetchOpenMeteoGrid(bounds, category, horizonHours);
}

export function fetchWeather({ lat, lng, bounds, signal }) {
  if (HAS_API_BASE || USE_LOCAL_API) {
    return fetchApiJson('/api/weather', {
      lat,
      lng,
      ...Object.fromEntries(
        Object.entries(bounds || {}).map(([key, value]) => [key, String(Number(value).toFixed(5))]),
      ),
    }, signal);
  }
  return buildBrowserWeather(Number(lat), Number(lng), bounds);
}
