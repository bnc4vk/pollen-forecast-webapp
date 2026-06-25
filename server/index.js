import 'dotenv/config';
import express from 'express';
import { iso1A2Code } from '@rapideditor/country-coder';

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const OPEN_METEO_POLLEN = [
  'alder_pollen',
  'birch_pollen',
  'grass_pollen',
  'mugwort_pollen',
  'olive_pollen',
  'ragweed_pollen',
];

const CATEGORY_DEFS = {
  aggregate: { label: 'Worst', type: 'aggregate' },
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
const MET_OFFICE_POLLEN_URL =
  'https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/pollen-forecast';
const POLLENINFORMATION_URL = 'https://www.polleninformation.at/api/forecast/public';
const POLLENINFORMATION_CACHE_MS = 4 * 60 * 60 * 1000;
const POLLENINFORMATION_COUNTRIES = new Set([
  'AT',
  'CH',
  'DE',
  'ES',
  'FR',
  'GB',
  'IT',
  'LV',
  'LT',
  'PL',
  'SE',
  'TR',
  'UA',
]);
const POLLENINFORMATION_SPECIES = {
  1: 'alder',
  2: 'birch',
  5: 'grass',
  6: 'ragweed',
  7: 'mugwort',
  18: 'olive',
};
const POLLENINFORMATION_FAMILIES = {
  grass: [5, 291],
  tree: [1, 2, 3, 4, 16, 17, 18, 326, 355, 1107],
  weed: [6, 7, 15, 320, 356],
};
const MET_OFFICE_REGIONS = [
  { id: 'os', name: 'Orkney & Shetland', lat: 59.26, lng: -2.57 },
  { id: 'he', name: 'Highlands & Eilean Siar', lat: 57.521, lng: -5.152 },
  { id: 'gr', name: 'Grampian', lat: 57.436, lng: -2.449 },
  { id: 'ta', name: 'Central, Tayside & Fife', lat: 56.462, lng: -3.68 },
  { id: 'st', name: 'Strathclyde', lat: 56.133, lng: -5.311 },
  { id: 'dg', name: 'Dumfries, Galloway, Lothian & Borders', lat: 55.668, lng: -2.85 },
  { id: 'ne', name: 'North East England', lat: 55.057, lng: -1.845 },
  { id: 'ni', name: 'Northern Ireland', lat: 54.786, lng: -6.652 },
  { id: 'yh', name: 'Yorkshire & Humber', lat: 54.062, lng: -1.142 },
  { id: 'nw', name: 'North West England', lat: 53.904, lng: -2.944 },
  { id: 'em', name: 'East Midlands', lat: 53.082, lng: -0.716 },
  { id: 'wm', name: 'West Midlands', lat: 52.551, lng: -2.296 },
  { id: 'wl', name: 'Wales', lat: 52.462, lng: -3.749 },
  { id: 'ee', name: 'East of England', lat: 52.31, lng: 0.895 },
  { id: 'se', name: 'London & South East England', lat: 51.086, lng: -0.409 },
  { id: 'sw', name: 'South West England', lat: 50.899, lng: -3.444 },
];
const MAX_TIMELAPSE_HOURS = 8;
const WEATHER_GRID_ROWS = 4;
const WEATHER_GRID_COLS = 4;
const SPATIAL_11KM_ZOOM = 9.5;
const SPATIAL_1KM_ZOOM = 13;
const MAX_SPATIAL_CELLS = 144;
const SPATIAL_SCALE_CONFIG = {
  regional: {
    cellKm: null,
    label: 'Met Office region',
    weights: { metoffice: 1, polleninformation: 1, openmeteo: 1, google: 1 },
  },
  '11km': {
    cellKm: 11,
    label: '11 km cell',
    weights: { metoffice: 0.45, polleninformation: 0.55, openmeteo: 1, google: 1.05 },
  },
  '1km': {
    cellKm: 1,
    label: '1 km cell',
    weights: { metoffice: 0.18, polleninformation: 0.25, openmeteo: 0.45, google: 1.2 },
  },
};

const cache = new Map();
const pollenInformationCache = new Map();
const pollenInformationPending = new Map();
const regionalForecastContexts = new Map();
const regionalForecastContextPending = new Map();
const spatialCellForecastCache = new Map();
let metOfficePageCache = null;
let metOfficePolygonsCache = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseCoord(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
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

function categoryName(key) {
  return CATEGORY_DEFS[key]?.label || key;
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

function emptyProvider(id, name, status, notes = []) {
  return {
    id,
    name,
    status,
    notes,
    modelFamily: id,
    categories: {},
    receivedAt: new Date().toISOString(),
  };
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'pollen-forecast-webapp/1.0' },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMetOfficePage() {
  if (metOfficePageCache && Date.now() - metOfficePageCache.created < 30 * 60 * 1000) {
    return metOfficePageCache.html;
  }
  const html = await fetchText(MET_OFFICE_POLLEN_URL);
  metOfficePageCache = { created: Date.now(), html };
  return html;
}

function parseMetOfficeGeoJson(script) {
  const marker = 'globalThis.metoffice.pollenForecast.polygonsGeoJson=';
  const start = script.indexOf(marker);
  const end = script.indexOf(';', start + marker.length);
  if (start < 0 || end < 0) throw new Error('Met Office region polygons were not found');

  const json = script
    .slice(start + marker.length, end)
    .replace(/([{,])\s*([A-Za-z]+):/g, '$1"$2":')
    .replace(/([\[,])(-?)\.(\d)/g, '$1$20.$3')
    .replace(/\\x26/g, '&');
  const geojson = JSON.parse(json);
  geojson.features = geojson.features.filter((feature) =>
    ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type),
  );
  return geojson;
}

async function fetchMetOfficePolygons() {
  if (metOfficePolygonsCache) return metOfficePolygonsCache;
  const html = await fetchMetOfficePage();
  const scriptPath = html.match(/src="([^"]+\/js\/pollen-forecast\/pollen-forecast\.js)"/)?.[1];
  if (!scriptPath) throw new Error('Met Office pollen map script was not found');
  const script = await fetchText(new URL(scriptPath, MET_OFFICE_POLLEN_URL).toString());
  metOfficePolygonsCache = parseMetOfficeGeoJson(script);
  return metOfficePolygonsCache;
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

function metOfficeIndex(label) {
  return {
    low: 1,
    moderate: 2.5,
    high: 4,
    'very high': 5,
  }[label.toLowerCase()];
}

function nearestMetOfficeRegion(lat, lng) {
  if (lat < 49 || lat > 61 || lng < -9 || lng > 2.2) return null;
  const lngScale = Math.cos((lat * Math.PI) / 180);
  return MET_OFFICE_REGIONS.reduce((nearest, region) => {
    const distance = (lat - region.lat) ** 2 + ((lng - region.lng) * lngScale) ** 2;
    return !nearest || distance < nearest.distance ? { ...region, distance } : nearest;
  }, null);
}

function metOfficeCard(html, regionId) {
  const startMarker = `<div id="${regionId}" class="pollen-forecast-card"`;
  const start = html.indexOf(startMarker);
  if (start < 0) return '';
  const next = html.indexOf('class="pollen-forecast-card"', start + startMarker.length);
  return html.slice(start, next < 0 ? html.length : html.lastIndexOf('<div id="', next));
}

function pollenInformationCountry(lat, lng) {
  const country = iso1A2Code([Number(lng), Number(lat)]);
  return POLLENINFORMATION_COUNTRIES.has(country) ? country : null;
}

function pollenInformationCacheKey(country, lat, lng) {
  return `${country}:${Number(lat).toFixed(1)}:${Number(lng).toFixed(1)}`;
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

function summarizeWeather(points) {
  const precipitation = Math.max(...points.map((point) => point.precipitation), 0);
  const windSpeed = points.reduce((sum, point) => sum + point.windSpeed, 0) / Math.max(points.length, 1);
  const windGusts = Math.max(...points.map((point) => point.windGusts), 0);
  const weatherCode = points.find((point) => [95, 96, 99].includes(point.weatherCode))?.weatherCode || points[0]?.weatherCode || 0;
  const rain = classifyRain({ precipitation, weatherCode, windGusts });
  const wind = classifyWind({ windSpeed, windGusts });
  const stormGustBoost = rain.key === 'storm' && wind.key === 'gusty' ? 1.12 : 1;
  const multiplier = clamp(rain.multiplier * wind.multiplier * stormGustBoost, 0.55, 1.65);

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

async function fetchOpenMeteoGrid(bounds, category, horizonHours = MAX_TIMELAPSE_HOURS) {
  const rows = 8;
  const cols = 8;
  const safeHorizon = clamp(Number(horizonHours) || MAX_TIMELAPSE_HOURS, 1, MAX_TIMELAPSE_HOURS);
  const points = buildGridPoints(bounds, rows, cols);

  const params = new URLSearchParams({
    latitude: points.map((point) => point.lat.toFixed(5)).join(','),
    longitude: points.map((point) => point.lng.toFixed(5)).join(','),
    hourly: OPEN_METEO_POLLEN.join(','),
    forecast_days: '2',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  const payloads = Array.isArray(data) ? data : [data];
  const startIndices = payloads.map((payload) => nearestHourlyIndex(payload.hourly || {}));

  const frames = Array.from({ length: safeHorizon + 1 }, (_, offsetHours) => {
    const gridPoints = payloads.map((payload, index) => {
      const sourcePoint = points[index] || { lat: payload.latitude, lng: payload.longitude };
      const hourly = payload.hourly || {};
      const values = openMeteoHourlyValues(hourly, Math.min((startIndices[index] || 0) + offsetHours, (hourly.time?.length || 1) - 1));
      const value = openMeteoCategoryValue(values, category);
      return {
        lat: Number(sourcePoint.lat.toFixed(5)),
        lng: Number(sourcePoint.lng.toFixed(5)),
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
  return {
    category,
    label: categoryName(category),
    units: 'grains/m3',
    source: 'Open-Meteo / CAMS hourly coordinate-list grid',
    generatedAt: new Date().toISOString(),
    bounds,
    rows,
    cols,
    horizonHours: safeHorizon,
    offsetHours: firstFrame.offsetHours,
    time: firstFrame.time,
    min: Number(Math.min(...frameMins).toFixed(2)),
    max: Number(Math.max(...frameMaxes).toFixed(2)),
    points: firstFrame.points,
    frames,
  };
}

async function fetchOpenMeteoWeather(lat, lng, bounds) {
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

  return {
    source: 'Open-Meteo Weather Forecast',
    generatedAt: new Date().toISOString(),
    location: { lat, lng },
    bounds,
    rows,
    cols,
    points: weatherPoints,
    ...summarizeWeather(weatherPoints),
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
  const key = process.env.GOOGLE_POLLEN_API_KEY;
  if (!key) return emptyProvider('google', 'Google Pollen API', 'missing-key');

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

  const familySignals = ['grass', 'tree', 'weed'].map((key) => categories[key]).filter(Boolean);
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

async function fetchPollenInformation(lat, lng) {
  const key = process.env.POLLENINFORMATION_API_KEY;
  if (!key) {
    return emptyProvider('polleninformation', 'Austrian Pollen Information Service', 'missing-key', [
      'POLLENINFORMATION_API_KEY is not set.',
    ]);
  }
  const country = pollenInformationCountry(lat, lng);
  if (!country) {
    return emptyProvider('polleninformation', 'Austrian Pollen Information Service', 'outside-coverage', [
      'This location is outside the countries supported by the Pollen Information API.',
    ]);
  }

  const cacheKey = pollenInformationCacheKey(country, lat, lng);
  const cached = pollenInformationCache.get(cacheKey);
  let data;
  let cacheStatus = 'fresh';

  if (cached && Date.now() - cached.created < POLLENINFORMATION_CACHE_MS) {
    data = cached.data;
    cacheStatus = 'four-hour cache';
  } else {
    let pending = pollenInformationPending.get(cacheKey);
    if (!pending) {
      const params = new URLSearchParams({
        country,
        lang: 'en',
        latitude: Number(lat).toFixed(5),
        longitude: Number(lng).toFixed(5),
        apikey: key,
      });
      pending = fetchJson(`${POLLENINFORMATION_URL}?${params}`, { timeoutMs: 12000 })
        .then((nextData) => {
          if (nextData.error) throw new Error(`Austrian pollen API: ${nextData.error}`);
          pollenInformationCache.set(cacheKey, { created: Date.now(), data: nextData });
          return nextData;
        })
        .finally(() => pollenInformationPending.delete(cacheKey));
      pollenInformationPending.set(cacheKey, pending);
    } else {
      cacheStatus = 'shared request';
    }
    data = await pending;
  }

  const loads = new Map(
    (data.contamination || []).map((item) => [
      Number(item.poll_id),
      {
        load: clamp(Number(item.contamination_1) || 0, 0, 4),
        title: item.poll_title || `Allergen ${item.poll_id}`,
      },
    ]),
  );
  const categories = {};

  for (const [pollId, category] of Object.entries(POLLENINFORMATION_SPECIES)) {
    const allergen = loads.get(Number(pollId));
    if (!allergen) continue;
    categories[category] = makeSignal({
      category,
      value: allergen.load,
      index: allergen.load * 1.25,
      units: 'load 0-4',
      sourceDetail: `${allergen.title}: ${allergen.load}/4`,
      confidence: 0.88,
    });
  }

  for (const [category, pollIds] of Object.entries(POLLENINFORMATION_FAMILIES)) {
    const allergens = pollIds.map((pollId) => loads.get(pollId)).filter(Boolean);
    if (allergens.length === 0) continue;
    const dominant = allergens.reduce(
      (highest, allergen) => (allergen.load > highest.load ? allergen : highest),
      allergens[0],
    );
    categories[category] = makeSignal({
      category,
      value: dominant.load,
      index: dominant.load * 1.25,
      units: 'load 0-4',
      sourceDetail: `${dominant.title}: ${dominant.load}/4`,
      confidence: 0.9,
    });
  }

  const familySignals = ['grass', 'tree', 'weed'].map((category) => categories[category]).filter(Boolean);
  if (familySignals.length > 0) {
    const dominant = familySignals.reduce(
      (highest, signal) => (signal.index > highest.index ? signal : highest),
      familySignals[0],
    );
    categories.aggregate = makeSignal({
      category: 'aggregate',
      value: dominant.value,
      index: dominant.index,
      units: 'load 0-4',
      sourceDetail: `Highest Austrian family severity (${dominant.label}: ${dominant.value}/4)`,
      confidence: 0.9,
    });
  }

  const allergyRisk = clamp(Number(data.allergyrisk?.allergyrisk_1) || 0, 0, 10);
  return {
    id: 'polleninformation',
    name: 'Austrian Pollen Information Service',
    status: 'ok',
    modelFamily: 'Austrian Pollen Information Service',
    categories,
    receivedAt: new Date().toISOString(),
    notes: [
      `Country ${country}; today’s allergy risk: ${allergyRisk}/10; response: ${cacheStatus}.`,
      'Source: Austrian Pollen Information Service, www.polleninformation.at.',
      'Licensed for non-commercial use; upstream retrieval is limited to once per four hours per cached area.',
    ],
  };
}

async function fetchMetOfficePollen(lat, lng) {
  const region = nearestMetOfficeRegion(lat, lng);
  if (!region) {
    return emptyProvider(
      'metoffice',
      'Met Office Pollen',
      'outside-coverage',
      ['The Met Office pollen model covers the United Kingdom only.'],
    );
  }

  const html = await fetchMetOfficePage();
  const card = metOfficeCard(html, region.id);
  const description = decodeHtml(
    card.match(/<div class="paragraph-block[^"]*">\s*<p>([\s\S]*?)<\/p>/i)?.[1] || '',
  );
  const levelCode = card.match(/data-category="(l|m|h|vh)"/i)?.[1]?.toLowerCase();
  const levelLabel = { l: 'Low', m: 'Moderate', h: 'High', vh: 'Very High' }[levelCode];
  const issued = decodeHtml(card.match(/<p class="last-issued[^"]*">([\s\S]*?)<\/p>/i)?.[1] || '');

  if (!description || !levelLabel) {
    throw new Error(`Could not parse the Met Office pollen card for region ${region.id}`);
  }

  const categories = {};
  for (const match of description.matchAll(/\b(Very High|High|Moderate|Low)\s+(grass|tree|weed)\s+pollen\b/gi)) {
    const category = match[2].toLowerCase();
    categories[category] = makeSignal({
      category,
      index: metOfficeIndex(match[1]),
      units: 'regional severity',
      sourceDetail: `${region.name}: ${match[1]} ${category} pollen`,
      confidence: 0.68,
    });
  }

  categories.aggregate = makeSignal({
    category: 'aggregate',
    index: metOfficeIndex(levelLabel),
    units: 'regional severity',
    sourceDetail: `${region.name}: ${description}`,
    confidence: 0.66,
  });

  return {
    id: 'metoffice',
    name: 'Met Office Pollen',
    status: 'ok',
    modelFamily: 'Met Office',
    categories,
    receivedAt: new Date().toISOString(),
    notes: [
      `Nearest published region: ${region.name}.`,
      issued || 'Five-day regional forecast from the Met Office pollen model.',
    ],
  };
}

async function fetchTomorrow(lat, lng) {
  const key = process.env.TOMORROW_API_KEY;
  if (!key) return emptyProvider('tomorrow', 'Tomorrow.io', 'missing-key');
  if (process.env.ENABLE_TOMORROW_POLLEN !== 'true') {
    return emptyProvider('tomorrow', 'Tomorrow.io', 'disabled-premium', [
      'Pollen is a Tomorrow.io premium layer. Set ENABLE_TOMORROW_POLLEN=true only after the account is entitled.',
    ]);
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

  const familySignals = ['grass', 'tree', 'weed'].map((key) => categories[key]).filter(Boolean);
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
    ...emptyProvider(id, name, 'error', [error.message]),
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
          baseConfidence: signal.confidence,
          confidence: Number((signal.confidence * (provider.weightMultiplier ?? 1)).toFixed(3)),
          weightMultiplier: provider.weightMultiplier ?? 1,
          spatialRole: provider.spatialRole || 'direct',
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

function spatialTierForZoom(zoom) {
  if (zoom >= SPATIAL_1KM_ZOOM) return '1km';
  if (zoom >= SPATIAL_11KM_ZOOM) return '11km';
  return 'regional';
}

function cloneProviderWithWeight(provider, tier, spatialRole) {
  const weightMultiplier = SPATIAL_SCALE_CONFIG[tier].weights[provider.id] ?? 0;
  return {
    ...provider,
    weightMultiplier,
    spatialRole,
    notes: [
      ...(provider.notes || []),
      `${SPATIAL_SCALE_CONFIG[tier].label}: ${Math.round(weightMultiplier * 100)}% scale weight; ${spatialRole}.`,
    ],
  };
}

function pointInRing([lng, lat], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    const intersects =
      y > lat !== previousY > lat &&
      lng < ((previousX - x) * (lat - y)) / (previousY - y || Number.EPSILON) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function featureContainsPoint(feature, point) {
  const polygons =
    feature?.geometry?.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [];
  return polygons.some(
    (polygon) =>
      pointInRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => pointInRing(point, hole)),
  );
}

function regionForPoint(geojson, lat, lng) {
  const feature = geojson.features.find((candidate) => featureContainsPoint(candidate, [lng, lat]));
  return MET_OFFICE_REGIONS.find((region) => region.id === feature?.properties?.id) || null;
}

function buildSpatialCells(bounds, cellKm, geojson) {
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
      const region = regionForPoint(geojson, lat, lng);
      if (!region) continue;
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
        regionId: region.id,
        regionName: region.name,
      });
    }
  }

  if (cells.length > MAX_SPATIAL_CELLS) {
    throw new Error(`This view contains ${cells.length} cells; zoom in to load ${cellKm} km data.`);
  }
  return cells;
}

function spatialCellForPoint(lat, lng, cellKm) {
  const latStep = cellKm / 111.32;
  const latIndex = Math.floor((lat + 90) / latStep);
  const south = latIndex * latStep - 90;
  const north = south + latStep;
  const centerLat = (south + north) / 2;
  const lngStep = cellKm / (111.32 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.2));
  const lngIndex = Math.floor((lng + 180) / lngStep);
  const west = lngIndex * lngStep - 180;
  const east = west + lngStep;
  return {
    id: `${cellKm}:${latIndex}:${lngIndex}`,
    lat: Number(centerLat.toFixed(5)),
    lng: Number(((west + east) / 2).toFixed(5)),
    bounds: { north, south, east, west },
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function regionalForecastContext(region) {
  if (regionalForecastContexts.has(region.id)) return regionalForecastContexts.get(region.id);
  if (!regionalForecastContextPending.has(region.id)) {
    regionalForecastContextPending.set(
      region.id,
      buildForecast(region.lat, region.lng)
        .then((forecast) => {
          regionalForecastContexts.set(region.id, forecast);
          return forecast;
        })
        .finally(() => regionalForecastContextPending.delete(region.id)),
    );
  }
  return regionalForecastContextPending.get(region.id);
}

async function buildSpatialCellForecast(cell, tier) {
  const cacheKey = `${tier}:${cell.id}`;
  const cached = spatialCellForecastCache.get(cacheKey);
  if (cached && Date.now() - cached.created < 4 * 60 * 60 * 1000) return cached.value;
  const region = MET_OFFICE_REGIONS.find((candidate) => candidate.id === cell.regionId);
  const regional = await regionalForecastContext(region);
  const coarseProviders = regional.providers.filter((provider) =>
    ['metoffice', 'polleninformation'].includes(provider.id),
  );

  let directProviders;
  if (tier === '11km') {
    const settled = await Promise.allSettled([
      fetchOpenMeteo(cell.lat, cell.lng),
      fetchGooglePollen(cell.lat, cell.lng),
    ]);
    directProviders = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : statusProvider(
            index === 0 ? 'openmeteo' : 'google',
            index === 0 ? 'Open-Meteo / CAMS' : 'Google Pollen API',
            result.reason,
          ),
    );
  } else {
    const parent = spatialCellForPoint(cell.lat, cell.lng, 11);
    const settled = await Promise.allSettled([
      fetchOpenMeteo(parent.lat, parent.lng),
      fetchGooglePollen(cell.lat, cell.lng),
    ]);
    directProviders = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : statusProvider(
            index === 0 ? 'openmeteo' : 'google',
            index === 0 ? 'Open-Meteo / CAMS' : 'Google Pollen API',
            result.reason,
          ),
    );
  }

  const providers = [
    ...coarseProviders.map((provider) =>
      cloneProviderWithWeight(provider, tier, `inherited from ${cell.regionName}`),
    ),
    ...directProviders.map((provider) =>
      cloneProviderWithWeight(
        provider,
        tier,
        tier === '1km' && provider.id === 'openmeteo'
          ? 'inherited from containing 11 km CAMS cell'
          : `requested at ${SPATIAL_SCALE_CONFIG[tier].label} center`,
      ),
    ),
  ];
  const ensemble = synthesize(providers);
  const scores = Object.fromEntries(
    Object.entries(ensemble).map(([category, value]) => [
      category,
      {
        label: value.label,
        score: value.score,
        index: value.index,
        signalCount: value.signalCount,
        signals: value.signals,
      },
    ]),
  );

  const value = {
    ...cell,
    scale: tier,
    scaleLabel: SPATIAL_SCALE_CONFIG[tier].label,
    scores,
    providerStatus: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      status: provider.status,
      weightMultiplier: provider.weightMultiplier,
      spatialRole: provider.spatialRole,
      notes: provider.notes,
    })),
  };
  spatialCellForecastCache.set(cacheKey, { created: Date.now(), value });
  return value;
}

async function buildSpatialForecast(bounds, zoom) {
  const tier = spatialTierForZoom(zoom);
  if (tier === 'regional') {
    throw new Error('Regional zoom uses the Met Office region ensemble.');
  }
  const geojson = await fetchMetOfficePolygons();
  const cells = buildSpatialCells(bounds, SPATIAL_SCALE_CONFIG[tier].cellKm, geojson);
  const forecasts = await mapWithConcurrency(cells, 8, (cell) => buildSpatialCellForecast(cell, tier));
  return {
    mode: 'adaptive-spatial-ensemble',
    tier,
    scaleKm: SPATIAL_SCALE_CONFIG[tier].cellKm,
    scaleLabel: SPATIAL_SCALE_CONFIG[tier].label,
    generatedAt: new Date().toISOString(),
    cells: forecasts,
    weighting: SPATIAL_SCALE_CONFIG[tier].weights,
    notes: [
      'Met Office and Austrian signals are inherited from the containing regional context.',
      tier === '11km'
        ? 'Open-Meteo and Google are requested at each 11 km cell center.'
        : 'Google is requested at each 1 km cell center; Open-Meteo is inherited from the containing 11 km cell.',
    ],
  };
}

async function buildForecast(lat, lng) {
  const settled = await Promise.allSettled([
    fetchOpenMeteo(lat, lng),
    fetchGooglePollen(lat, lng),
    fetchPollenInformation(lat, lng),
    fetchMetOfficePollen(lat, lng),
  ]);

  const providers = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    if (index === 0) return statusProvider('openmeteo', 'Open-Meteo / CAMS', result.reason);
    if (index === 1) return statusProvider('google', 'Google Pollen API', result.reason);
    if (index === 2) {
      return statusProvider('polleninformation', 'Austrian Pollen Information Service', result.reason);
    }
    return statusProvider('metoffice', 'Met Office Pollen', result.reason);
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
      'Austrian Pollen Information Service data is used in its documented supported countries, cached for four hours by country and area, and licensed for non-commercial use.',
      'Met Office pollen is an independent UK-only regional model and is weighted below the location-specific sources.',
      'Worst is the highest confidence-weighted ensemble score among grass, tree, and weed.',
      'Provider indices are normalized onto a 0-100 score for blending; raw Open-Meteo concentrations are retained in signal details.',
    ],
  };
}

async function buildRegionalForecast() {
  await fetchMetOfficePage();
  const geojson = await fetchMetOfficePolygons();
  const forecasts = await Promise.all(
    MET_OFFICE_REGIONS.map(async (region) => {
      const forecast = await buildForecast(region.lat, region.lng);
      regionalForecastContexts.set(region.id, forecast);
      const scores = Object.fromEntries(
        Object.entries(forecast.ensemble).map(([category, value]) => [
          category,
          {
            label: value.label,
            score: value.score,
            index: value.index,
            signalCount: value.signalCount,
            signals: value.signals,
          },
        ]),
      );
      return {
        ...region,
        scores,
        providerStatus: forecast.providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          status: provider.status,
          weightMultiplier: 1,
          spatialRole: 'requested at Met Office region center',
          notes: provider.notes,
        })),
      };
    }),
  );

  return {
    mode: 'met-office-regional-ensemble',
    generatedAt: new Date().toISOString(),
    category: 'aggregate',
    regions: forecasts,
    geojson,
    notes: [
      'Region boundaries are the GeoJSON polygons published by the Met Office pollen map.',
      'Each region score blends Met Office regional pollen with Open-Meteo, Google Pollen, and Austrian Pollen Information data requested at that region’s representative center.',
    ],
  };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'pollen-forecast-api',
    time: new Date().toISOString(),
  });
});

app.get('/api/regions', async (_req, res) => {
  const cacheKey = 'regional-forecast:v2';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.created < 4 * 60 * 60 * 1000) {
    res.json({ ...cached.value, cached: true });
    return;
  }

  try {
    const value = await buildRegionalForecast();
    cache.set(cacheKey, { created: Date.now(), value });
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/forecast', async (req, res) => {
  const lat = clamp(parseCoord(req.query.lat, 51.5074), -90, 90);
  const lng = clamp(parseCoord(req.query.lng, -0.1278), -180, 180);
  const cacheKey = `forecast:${roundCoord(lat)}:${roundCoord(lng)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.created < 5 * 60 * 1000) {
    res.json({ ...cached.value, cached: true });
    return;
  }

  try {
    const value = await buildForecast(lat, lng);
    cache.set(cacheKey, { created: Date.now(), value });
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/spatial', async (req, res) => {
  const bounds = {
    north: clamp(parseCoord(req.query.north, 51.7), -90, 90),
    south: clamp(parseCoord(req.query.south, 51.3), -90, 90),
    east: clamp(parseCoord(req.query.east, 0.15), -180, 180),
    west: clamp(parseCoord(req.query.west, -0.35), -180, 180),
  };
  const zoom = clamp(parseCoord(req.query.zoom, 5), 0, 20);
  if (bounds.south > bounds.north || bounds.west > bounds.east) {
    res.status(400).json({ error: 'Invalid map bounds' });
    return;
  }
  const tier = spatialTierForZoom(zoom);
  const cacheKey = [
    'spatial-v1',
    tier,
    roundCoord(bounds.north),
    roundCoord(bounds.south),
    roundCoord(bounds.east),
    roundCoord(bounds.west),
  ].join(':');
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.created < 4 * 60 * 60 * 1000) {
    res.json({ ...cached.value, cached: true });
    return;
  }

  try {
    const value = await buildSpatialForecast(bounds, zoom);
    cache.set(cacheKey, { created: Date.now(), value });
    res.json(value);
  } catch (error) {
    res.status(error.message.includes('zoom in') ? 400 : 502).json({ error: error.message });
  }
});

app.get('/api/grid', async (req, res) => {
  const bounds = {
    north: clamp(parseCoord(req.query.north, 51.7), -90, 90),
    south: clamp(parseCoord(req.query.south, 51.3), -90, 90),
    east: clamp(parseCoord(req.query.east, 0.15), -180, 180),
    west: clamp(parseCoord(req.query.west, -0.35), -180, 180),
  };
  const category = CATEGORY_DEFS[req.query.category] ? req.query.category : 'aggregate';
  const horizonHours = clamp(parseCoord(req.query.horizonHours, MAX_TIMELAPSE_HOURS), 1, MAX_TIMELAPSE_HOURS);
  if (bounds.south > bounds.north || bounds.west > bounds.east) {
    res.status(400).json({ error: 'Invalid map bounds' });
    return;
  }

  const cacheKey = [
    'grid',
    category,
    roundCoord(bounds.north),
    roundCoord(bounds.south),
    roundCoord(bounds.east),
    roundCoord(bounds.west),
    horizonHours,
  ].join(':');
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.created < 5 * 60 * 1000) {
    res.json({ ...cached.value, cached: true });
    return;
  }

  try {
    const value = await fetchOpenMeteoGrid(bounds, category, horizonHours);
    cache.set(cacheKey, { created: Date.now(), value });
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/weather', async (req, res) => {
  const lat = clamp(parseCoord(req.query.lat, 51.5074), -90, 90);
  const lng = clamp(parseCoord(req.query.lng, -0.1278), -180, 180);
  const bounds = {
    north: clamp(parseCoord(req.query.north, lat + 0.18), -90, 90),
    south: clamp(parseCoord(req.query.south, lat - 0.18), -90, 90),
    east: clamp(parseCoord(req.query.east, lng + 0.25), -180, 180),
    west: clamp(parseCoord(req.query.west, lng - 0.25), -180, 180),
  };

  if (bounds.south > bounds.north || bounds.west > bounds.east) {
    res.status(400).json({ error: 'Invalid map bounds' });
    return;
  }

  const cacheKey = [
    'weather',
    roundCoord(lat),
    roundCoord(lng),
    roundCoord(bounds.north),
    roundCoord(bounds.south),
    roundCoord(bounds.east),
    roundCoord(bounds.west),
  ].join(':');
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.created < 2 * 60 * 1000) {
    res.json({ ...cached.value, cached: true });
    return;
  }

  try {
    const value = await fetchOpenMeteoWeather(lat, lng, bounds);
    cache.set(cacheKey, { created: Date.now(), value });
    res.json(value);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.listen(port, host, () => {
  console.log(`Pollen API listening on http://${host}:${port}`);
});
