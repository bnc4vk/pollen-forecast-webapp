import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ChevronDown,
  CloudRain,
  Database,
  Info,
  Pause,
  Play,
  Search,
  Navigation,
  Wind,
} from 'lucide-react';
import { fetchForecast, fetchGrid, fetchWeather } from './pollenData.js';
import './styles.css';

const LONDON = { lat: 51.5074, lng: -0.1278 };
const DEFAULT_ZOOM = 12;
const INITIAL_BOUNDS = {
  north: 51.7,
  south: 51.3,
  east: 0.15,
  west: -0.35,
};
const SEARCH_RESULTS_LIMIT = 3;
const LOW_COLOR_THRESHOLD = 10;
const TIMELAPSE_HORIZONS = [1, 3, 8];
const DEFAULT_WEATHER = {
  rain: { key: 'dry', label: 'No rain', multiplier: 1 },
  wind: { key: 'calm', label: 'Calm', multiplier: 0.92 },
  multiplier: 0.92,
  precipitation: 0,
  windSpeed: 0,
  windGusts: 0,
  guidance: 'Live rain and wind will appear when weather data loads.',
  points: [],
};
const FALLBACK_LOCATIONS = [
  { id: 'fallback-london', label: 'London, England', lat: 51.5074, lng: -0.1278, aliases: ['london'] },
  { id: 'fallback-paris', label: 'Paris, France', lat: 48.8566, lng: 2.3522, aliases: ['paris'] },
  { id: 'fallback-new-york', label: 'New York, United States', lat: 40.7128, lng: -74.006, aliases: ['new york'] },
  { id: 'fallback-los-angeles', label: 'Los Angeles, California', lat: 34.0522, lng: -118.2437, aliases: ['los angeles'] },
  { id: 'fallback-toronto', label: 'Toronto, Ontario', lat: 43.6532, lng: -79.3832, aliases: ['toronto'] },
  { id: 'fallback-mexico-city', label: 'Mexico City, Mexico', lat: 19.4326, lng: -99.1332, aliases: ['mexico city'] },
  { id: 'fallback-sao-paulo', label: 'Sao Paulo, Brazil', lat: -23.5558, lng: -46.6396, aliases: ['sao paulo', 'são paulo'] },
  { id: 'fallback-buenos-aires', label: 'Buenos Aires, Argentina', lat: -34.6037, lng: -58.3816, aliases: ['buenos aires'] },
  { id: 'fallback-lagos', label: 'Lagos, Lagos State', lat: 6.5244, lng: 3.3792, aliases: ['lagos'] },
  { id: 'fallback-cairo', label: 'Cairo, Egypt', lat: 30.0444, lng: 31.2357, aliases: ['cairo'] },
  { id: 'fallback-nairobi', label: 'Nairobi, Kenya', lat: -1.2921, lng: 36.8219, aliases: ['nairobi'] },
  { id: 'fallback-johannesburg', label: 'Johannesburg, Gauteng', lat: -26.2041, lng: 28.0473, aliases: ['johannesburg'] },
  { id: 'fallback-mumbai', label: 'Mumbai, Maharashtra', lat: 19.076, lng: 72.8777, aliases: ['mumbai'] },
  { id: 'fallback-delhi', label: 'Delhi, India', lat: 28.6139, lng: 77.209, aliases: ['delhi', 'new delhi'] },
  { id: 'fallback-bangkok', label: 'Bangkok, Thailand', lat: 13.7563, lng: 100.5018, aliases: ['bangkok'] },
  { id: 'fallback-singapore', label: 'Singapore, Singapore', lat: 1.3521, lng: 103.8198, aliases: ['singapore'] },
  { id: 'fallback-tokyo', label: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503, aliases: ['tokyo'] },
  { id: 'fallback-seoul', label: 'Seoul, South Korea', lat: 37.5665, lng: 126.978, aliases: ['seoul'] },
  { id: 'fallback-beijing', label: 'Beijing, China', lat: 39.9042, lng: 116.4074, aliases: ['beijing'] },
  { id: 'fallback-sydney', label: 'Sydney, New South Wales', lat: -33.8688, lng: 151.2093, aliases: ['sydney'] },
  { id: 'fallback-auckland', label: 'Auckland, New Zealand', lat: -36.8509, lng: 174.7645, aliases: ['auckland'] },
  { id: 'fallback-dubai', label: 'Dubai, United Arab Emirates', lat: 25.2048, lng: 55.2708, aliases: ['dubai'] },
  { id: 'fallback-istanbul', label: 'Istanbul, Turkey', lat: 41.0082, lng: 28.9784, aliases: ['istanbul'] },
  { id: 'fallback-berlin', label: 'Berlin, Germany', lat: 52.52, lng: 13.405, aliases: ['berlin'] },
  { id: 'fallback-reykjavik', label: 'Reykjavik, Iceland', lat: 64.1466, lng: -21.9426, aliases: ['reykjavik'] },
  { id: 'fallback-leeds', label: 'Leeds, England', lat: 53.8008, lng: -1.5491, aliases: ['leeds'] },
  { id: 'fallback-manchester', label: 'Manchester, England', lat: 53.4808, lng: -2.2426, aliases: ['manchester'] },
  { id: 'fallback-angel', label: 'Angel, Greater London, England', lat: 51.5319, lng: -0.1058, aliases: ['angel', 'angel london'] },
  { id: 'fallback-islington', label: 'Islington, Greater London, England', lat: 51.5386, lng: -0.1022, aliases: ['islington', 'islington london'] },
  { id: 'fallback-shoreditch', label: 'Shoreditch, Greater London, England', lat: 51.5267, lng: -0.0799, aliases: ['shoreditch'] },
  { id: 'fallback-heathrow', label: 'Heathrow Airport, Greater London, England', lat: 51.47, lng: -0.4543, aliases: ['heathrow', 'heathrow airport'] },
];
const CATEGORY_LABELS = {
  aggregate: 'All pollen',
  grass: 'Grass',
  tree: 'Tree',
  weed: 'Weed',
  alder: 'Alder',
  birch: 'Birch',
  mugwort: 'Mugwort',
  olive: 'Olive',
  ragweed: 'Ragweed',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blendChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function scoreColor(score, alpha = 0.62) {
  if (!Number.isFinite(score) || score <= LOW_COLOR_THRESHOLD) {
    return 'rgba(72, 155, 111, 0)';
  }
  const stops = [
    { t: 0, color: [72, 155, 111] },
    { t: 0.22, color: [178, 198, 78] },
    { t: 0.45, color: [237, 175, 73] },
    { t: 0.7, color: [218, 92, 70] },
    { t: 1, color: [116, 73, 143] },
  ];
  const t = clamp((score - LOW_COLOR_THRESHOLD) / (100 - LOW_COLOR_THRESHOLD), 0, 1);
  const upperIndex = stops.findIndex((stop) => stop.t >= t);
  const upper = stops[upperIndex === -1 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, (upperIndex === -1 ? stops.length - 1 : upperIndex) - 1)];
  const localT = upper.t === lower.t ? 0 : (t - lower.t) / (upper.t - lower.t);
  const color = lower.color.map((channel, index) => blendChannel(channel, upper.color[index], localT));
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function boundsFromLeaflet(bounds) {
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };
}

function categoryLabel(key) {
  return CATEGORY_LABELS[key] || key;
}

function weatherProminence(weather, score) {
  const liveWeather = weather || DEFAULT_WEATHER;
  const rain = liveWeather.rain || DEFAULT_WEATHER.rain;
  const wind = liveWeather.wind || DEFAULT_WEATHER.wind;
  const multiplier = clamp(Number(liveWeather.multiplier ?? rain.multiplier * wind.multiplier) || 1, 0.55, 1.65);
  const adjustedScore = Number(clamp((Number(score) || 0) * multiplier, 0, 100).toFixed(1));
  const direction = multiplier < 0.9 ? 'lower' : multiplier > 1.12 ? 'higher' : 'similar';

  return {
    rain,
    wind,
    multiplier,
    adjustedScore,
    direction,
    guidance: liveWeather.guidance || DEFAULT_WEATHER.guidance,
  };
}

function frameScore(frame) {
  if (!frame?.points?.length) return null;
  const visiblePoints = frame.points.filter((point) => Number.isFinite(point.score));
  if (!visiblePoints.length) return null;
  const average = visiblePoints.reduce((sum, point) => sum + point.score, 0) / visiblePoints.length;
  return Number(average.toFixed(1));
}

function interpolatedFrameFor(gridData, progress) {
  if (!gridData?.frames?.length) return null;
  const maxOffset = gridData.frames.length - 1;
  const safeProgress = clamp(Number(progress) || 0, 0, maxOffset);
  const lowerIndex = Math.floor(safeProgress);
  const upperIndex = Math.min(Math.ceil(safeProgress), maxOffset);
  const mix = safeProgress - lowerIndex;
  const lower = gridData.frames[lowerIndex];
  const upper = gridData.frames[upperIndex] || lower;
  const points = lower.points.map((point, index) => {
    const nextPoint = upper.points[index] || point;
    return {
      lat: point.lat,
      lng: point.lng,
      value: point.value + (nextPoint.value - point.value) * mix,
      score: point.score + (nextPoint.score - point.score) * mix,
    };
  });
  const values = points.map((point) => point.value);
  const lowerTime = lower.time ? new Date(lower.time).getTime() : null;
  const upperTime = upper.time ? new Date(upper.time).getTime() : lowerTime;
  const interpolatedTime =
    Number.isFinite(lowerTime) && Number.isFinite(upperTime)
      ? new Date(lowerTime + (upperTime - lowerTime) * mix).toISOString()
      : lower.time;

  return {
    offsetHours: safeProgress,
    time: interpolatedTime,
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
    points,
  };
}

function formatFrameTime(time, intervalMinutes = 1) {
  if (!time) return '';
  const date = new Date(time);
  if (intervalMinutes > 1) {
    const intervalMs = intervalMinutes * 60 * 1000;
    date.setTime(Math.round(date.getTime() / intervalMs) * intervalMs);
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function displayStatus(status) {
  if (status === 'ok') return 'ok';
  if (status === 'not-covered') return 'location not covered';
  return 'no data';
}

function providerDisplayStatus(provider) {
  if (provider.status === 'ok') return 'ok';
  if (provider.status === 'location-not-covered' || provider.status === 'not-covered') {
    return 'not-covered';
  }
  return 'no-data';
}

function normalizeSearchText(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function fallbackLocations(query) {
  const normalizedQuery = normalizeSearchText(query);
  return FALLBACK_LOCATIONS.filter((location) =>
    location.aliases.some((alias) => normalizeSearchText(alias).startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizeSearchText(alias))),
  ).slice(0, SEARCH_RESULTS_LIMIT);
}

function uniqueLocations(locations) {
  const seen = new Set();
  return locations.filter((location) => {
    const key = normalizeSearchText(location.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstDistinct(address = {}, keys = [], existing = []) {
  const normalizedExisting = new Set(existing.filter(Boolean).map(normalizeSearchText));
  return keys.map((key) => address[key]).find((value) => value && !normalizedExisting.has(normalizeSearchText(value)));
}

function areaName(address = {}) {
  return firstDistinct(address, ['neighbourhood', 'suburb', 'city_district', 'quarter', 'borough']);
}

function localityName(address = {}) {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.locality
  );
}

function isPlaceSearchResult(result) {
  const address = result.address || {};
  if (areaName(address) || localityName(address)) return true;
  if (
    result.addresstype &&
    ['neighbourhood', 'suburb', 'city_district', 'quarter', 'borough', 'city', 'town', 'village', 'hamlet', 'municipality', 'locality'].includes(
      result.addresstype,
    )
  ) {
    return true;
  }
  return Boolean(result.name && !/\bcounty\b/i.test(result.name));
}

function formatSearchResult(result) {
  const address = result.address || {};
  const primary = areaName(address) || localityName(address) || result.name;
  const context = firstDistinct(address, ['city', 'town', 'village', 'municipality', 'county', 'state_district', 'state', 'region'], [primary]);
  const region = firstDistinct(address, ['state', 'region', 'country'], [primary, context]);
  const components = [primary, context, region].filter(Boolean).slice(0, 3);

  return components.length ? components.join(', ') : result.display_name?.split(',').slice(0, 3).join(', ') || 'Unknown location';
}

async function searchLocations(query, signal) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(SEARCH_RESULTS_LIMIT),
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Location search unavailable');
    const data = await response.json();
    const liveResults = data
      .filter(isPlaceSearchResult)
      .map((result) => ({
        id: result.place_id,
        label: formatSearchResult(result),
        lat: Number(result.lat),
        lng: Number(result.lon),
      }))
      .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
    const fallbackResults = fallbackLocations(trimmed).filter(
      (fallback) => !liveResults.some((result) => normalizeSearchText(result.label) === normalizeSearchText(fallback.label)),
    );
    return uniqueLocations([...fallbackResults, ...liveResults]).slice(0, SEARCH_RESULTS_LIMIT);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return fallbackLocations(trimmed);
  }
}

function useUserLocation() {
  const [location, setLocation] = useState({
    ...LONDON,
    source: 'pending',
    label: 'Requesting precise location...',
    guidance: 'Your browser should ask whether this site can use your location.',
  });

  const requestLocation = async () => {
    if (!navigator.geolocation) {
      setLocation({
        ...LONDON,
        source: 'fallback',
        label: 'Browser location unavailable. Showing London, UK.',
        guidance: 'This browser does not expose geolocation, so the map starts in London.',
      });
      return;
    }

    let permissionState = 'unknown';
    if (navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        permissionState = permission.state;
      } catch {
        permissionState = 'unknown';
      }
    }

    if (permissionState === 'denied') {
      setLocation({
        ...LONDON,
        source: 'blocked',
        label: 'Location blocked. Showing London, UK.',
        guidance:
          'Location permission is blocked in this browser. Enable site location permissions, then use the location control.',
      });
      return;
    }

    setLocation((current) => ({
      ...current,
      source: 'pending',
      label: 'Waiting for location permission...',
      guidance: 'Choose Allow in the browser permission prompt to center the map precisely.',
    }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'precise',
          label: 'Using your current location',
          guidance: 'Map centered on the precise location returned by the browser.',
        });
      },
      (error) => {
        const blocked = error.code === error.PERMISSION_DENIED;
        setLocation({
          ...LONDON,
          source: blocked ? 'blocked' : 'fallback',
          label: blocked
            ? 'Location permission denied. Showing London, UK.'
            : 'Location unavailable. Showing London, UK.',
          guidance: blocked
            ? 'Enable location for this site in browser settings, then use the location control.'
            : 'The browser could not resolve a location before timeout, so London is shown.',
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 300000,
      },
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  return { location, requestLocation };
}

function PollenMap({
  location,
  selectedPlaceLabel,
  searchLocation,
  onSearchSelect,
  onSearchLocationSettled,
  onRequestLocation,
  onCenterChange,
  onBoundsChange,
  selectedCategory,
  selectedCategoryData,
  gridData,
  gridLoading,
  timeProgress,
  weather,
}) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const accuracyRef = useRef(null);
  const overlayRef = useRef(null);
  const weatherOverlayRef = useRef(null);
  const [legendHelpOpen, setLegendHelpOpen] = useState(false);
  const activeFrame = useMemo(
    () => interpolatedFrameFor(gridData, timeProgress),
    [gridData, timeProgress],
  );
  const mapScore = useMemo(() => frameScore(activeFrame), [activeFrame]);
  const activeGridData = useMemo(() => {
    if (!gridData) return null;
    if (!activeFrame) return gridData;
    return {
      ...gridData,
      ...activeFrame,
      min: activeFrame.min,
      max: activeFrame.max,
      frameMax: activeFrame.max,
      frameMin: activeFrame.min,
    };
  }, [gridData, activeFrame]);
  const gridIsCurrent = gridData?.category === selectedCategory;
  const gridIsFlatZero = gridIsCurrent && activeGridData && activeGridData.min === 0 && activeGridData.frameMax === 0;
  const hasEnsembleScore = Number(selectedCategoryData?.score) > 0;
  const hasVisibleLayer =
    gridIsCurrent &&
    activeGridData?.points?.some((point) => Number(point.score) > LOW_COLOR_THRESHOLD);
  const legendTooltip = selectedCategoryData
    ? `The top tile is the current-location composite (${selectedCategoryData.score}/100). This map number is the area-average CAMS forecast for the selected time. Map colors use the same fixed 0-100 scale: green is low, amber moderate, red high, and purple very high. ${
        gridLoading || !gridIsCurrent
          ? 'Updating map layer.'
          : gridIsFlatZero && hasEnsembleScore
            ? `No map color is shown because raw ${categoryLabel(selectedCategory).toLowerCase()} pollen amount is unavailable for this area.`
            : activeGridData
              ? `Current map average: ${mapScore ?? 0}/100.`
              : 'No concentration grid.'
      }`
    : 'The category score and map scale will appear when forecast data loads.';

  const centerOnUser = () => {
    const map = mapRef.current;
    if (map && location.source === 'precise') {
      map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 14), { duration: 0.55 });
      return;
    }
    onRequestLocation?.();
  };

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    const map = L.map(mapNode.current, {
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
    }).setView([location.lat, location.lng], DEFAULT_ZOOM);

    map.attributionControl.setPrefix(false);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const PollenLayer = L.Layer.extend({
      onAdd(activeMap) {
        this._map = activeMap;
        this._canvas = L.DomUtil.create('canvas', 'pollen-canvas');
        this._canvas.setAttribute('aria-hidden', 'true');
        activeMap.getPanes().overlayPane.appendChild(this._canvas);
        activeMap.on('move zoom resize viewreset', this._draw, this);
        this._draw();
      },
      onRemove(activeMap) {
        activeMap.off('move zoom resize viewreset', this._draw, this);
        this._canvas?.remove();
      },
      setData(data) {
        this._data = data;
        this._draw();
      },
      _draw() {
        if (!this._map || !this._canvas) return;
        const mapSize = this._map.getSize();
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        const canvas = this._canvas;
        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(mapSize.x * dpr);
        const pixelHeight = Math.round(mapSize.y * dpr);

        L.DomUtil.setPosition(canvas, topLeft);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
          canvas.style.width = `${mapSize.x}px`;
          canvas.style.height = `${mapSize.y}px`;
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, mapSize.x, mapSize.y);
        const data = this._data;
        if (!data?.points?.length) return;

        const radius =
          Math.max(mapSize.x / (data.cols || 8), mapSize.y / (data.rows || 8)) * 1.45;
        for (const point of data.points) {
          if (point.score <= LOW_COLOR_THRESHOLD) continue;
          const pixel = this._map.latLngToContainerPoint([point.lat, point.lng]);
          const gradient = ctx.createRadialGradient(
            pixel.x,
            pixel.y,
            0,
            pixel.x,
            pixel.y,
            radius,
          );
          gradient.addColorStop(0, scoreColor(point.score, 0.62));
          gradient.addColorStop(0.58, scoreColor(point.score, 0.3));
          gradient.addColorStop(1, scoreColor(point.score, 0));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(pixel.x, pixel.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });

    overlayRef.current = new PollenLayer().addTo(map);

    const emitMapState = () => {
      const next = map.getCenter();
      const nextCenter = { lat: next.lat, lng: next.lng };
      onCenterChange?.(nextCenter);
      onBoundsChange?.(boundsFromLeaflet(map.getBounds()));
    };

    map.on('move', emitMapState);
    map.on('moveend', emitMapState);
    map.whenReady(emitMapState);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.setView([location.lat, location.lng], location.source === 'precise' ? 14 : DEFAULT_ZOOM, {
      animate: true,
    });
    onCenterChange?.({ lat: location.lat, lng: location.lng });
    onBoundsChange?.(boundsFromLeaflet(map.getBounds()));

    const latLng = [location.lat, location.lng];
    if (accuracyRef.current) {
      accuracyRef.current.remove();
      accuracyRef.current = null;
    }

    if (location.source === 'precise' && location.accuracy) {
      accuracyRef.current = L.circle(latLng, {
        radius: Math.min(location.accuracy, 1200),
        color: '#2f6f5e',
        weight: 1,
        fillColor: '#76b39d',
        fillOpacity: 0.14,
      }).addTo(map);
    }
  }, [location]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchLocation) return;

    const nextCenter = { lat: searchLocation.lat, lng: searchLocation.lng };
    map.flyTo([searchLocation.lat, searchLocation.lng], 12, { duration: 0.8 });
    onCenterChange?.(nextCenter);
    onBoundsChange?.(boundsFromLeaflet(map.getBounds()));
    onSearchLocationSettled?.();
  }, [searchLocation]);

  useEffect(() => {
    overlayRef.current?.setData(gridIsCurrent ? activeGridData : null);
  }, [activeGridData, gridIsCurrent]);

  useEffect(() => {
    const map = mapRef.current;
    const weatherPoints = weather?.points || [];
    const activePoints = weatherPoints.filter(
      (point) => point.precipitation >= 0.1 || point.windSpeed >= 10 || point.windGusts >= 18,
    );
    if (!map) return undefined;

    if (weatherOverlayRef.current) {
      weatherOverlayRef.current.remove();
      weatherOverlayRef.current = null;
    }

    if (!activePoints.length) return undefined;

    const WeatherLayer = L.Layer.extend({
      onAdd(activeMap) {
        this._map = activeMap;
        this._canvas = L.DomUtil.create('canvas', 'weather-canvas');
        this._canvas.setAttribute('aria-hidden', 'true');
        activeMap.getPanes().overlayPane.appendChild(this._canvas);
        activeMap.on('move zoom resize viewreset', this._draw, this);
        this._animate = () => {
          this._draw();
          this._raf = window.requestAnimationFrame(this._animate);
        };
        this._animate();
      },
      onRemove(activeMap) {
        activeMap.off('move zoom resize viewreset', this._draw, this);
        if (this._raf) window.cancelAnimationFrame(this._raf);
        this._canvas?.remove();
      },
      _draw() {
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        const canvas = this._canvas;
        const dpr = window.devicePixelRatio || 1;
        const tick = Date.now() / 1000;

        L.DomUtil.setPosition(canvas, topLeft);
        canvas.width = size.x * dpr;
        canvas.height = size.y * dpr;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.x, size.y);
        ctx.lineCap = 'round';

        for (const point of activePoints) {
          const pixel = map.latLngToContainerPoint([point.lat, point.lng]);
          const rainIntensity = clamp(point.precipitation / 5, 0, 1);
          const windIntensity = clamp(Math.max(point.windSpeed, point.windGusts * 0.72) / 42, 0, 1);

          if (point.precipitation >= 0.1) {
            const dropCount = 3 + Math.round(rainIntensity * 5);
            ctx.strokeStyle = `rgba(61, 126, 177, ${0.22 + rainIntensity * 0.32})`;
            ctx.lineWidth = 1 + rainIntensity;
            for (let index = 0; index < dropCount; index += 1) {
              const phase = (tick * (34 + rainIntensity * 28) + index * 17) % 44;
              const x = pixel.x + ((index % 4) - 1.5) * 9 + Math.sin(tick + index) * 2;
              const y = pixel.y - 20 + phase;
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x - 2, y + 10 + rainIntensity * 7);
              ctx.stroke();
            }
          }

          if (point.windSpeed >= 10 || point.windGusts >= 18) {
            const angle = ((point.windDirection || 0) - 90) * (Math.PI / 180);
            const length = 24 + windIntensity * 36;
            const offset = ((tick * (18 + windIntensity * 18)) % length) - length / 2;
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            ctx.strokeStyle = `rgba(236, 250, 242, ${0.28 + windIntensity * 0.36})`;
            ctx.lineWidth = 1.4 + windIntensity * 1.2;
            for (let index = 0; index < 3; index += 1) {
              const side = (index - 1) * 11;
              const startX = pixel.x - dx * length * 0.45 + dx * offset - dy * side;
              const startY = pixel.y - dy * length * 0.45 + dy * offset + dx * side;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(startX + dx * length, startY + dy * length);
              ctx.stroke();
            }
          }
        }
      },
    });

    weatherOverlayRef.current = new WeatherLayer().addTo(map);

    return () => {
      weatherOverlayRef.current?.remove();
      weatherOverlayRef.current = null;
    };
  }, [weather]);

  return (
    <section className="map-section" aria-label="Pollen forecast map">
      <div className="map-search-panel">
        <LocationSearch onSelect={onSearchSelect} />
      </div>
      <div className="map-toolbar">
        <button
          className={`location-badge ${location.source}`}
          type="button"
          onClick={centerOnUser}
          aria-label={location.source === 'precise' ? 'Center map on your location' : 'Request location'}
          title={location.source === 'precise' ? 'Center map on your location' : location.guidance}
        >
          <Navigation size={16} />
        </button>
      </div>
      {location.source !== 'precise' && !selectedPlaceLabel && (
        <div className="permission-panel" role="status" aria-live="polite">
          <p>{location.label}</p>
          <span>{location.guidance}</span>
        </div>
      )}
      <div ref={mapNode} className="leaflet-host" />
      <div className="map-dock">
        <div
          className={`map-legend ${legendHelpOpen ? 'tooltip-open' : ''}`}
          aria-label={legendTooltip}
          data-tooltip={legendTooltip}
          title={legendTooltip}
          tabIndex={0}
          onMouseEnter={() => setLegendHelpOpen(true)}
          onMouseLeave={() => setLegendHelpOpen(false)}
          onFocus={() => setLegendHelpOpen(true)}
          onBlur={() => setLegendHelpOpen(false)}
          onClick={() => setLegendHelpOpen((value) => !value)}
        >
          <div>
            <p className="toolbar-value">
              {selectedCategoryData
                ? `${categoryLabel(selectedCategory)} map ${mapScore ?? '—'}/100`
                : `${categoryLabel(selectedCategory)} score pending`}
            </p>
          </div>
          <span className={`legend-ramp ${!hasVisibleLayer ? 'flat' : ''}`} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

function TimelapseControls({
  horizon,
  progress,
  playing,
  loading,
  frame,
  onHorizonChange,
  onOffsetChange,
  onPlayingChange,
}) {
  const roundedMinutes = Math.round((progress * 60) / 15) * 15;
  const offsetLabel =
    roundedMinutes === 0
      ? 'Now'
      : roundedMinutes < 60
        ? `+${roundedMinutes}m`
      : roundedMinutes % 60 === 0
        ? `+${roundedMinutes / 60}h`
        : `+${Math.floor(roundedMinutes / 60)}h ${roundedMinutes % 60}m`;
  const progressPercent = horizon > 0 ? clamp((progress / horizon) * 100, 0, 100) : 0;
  return (
    <div className="timelapse-panel" aria-label="Timelapse forecast controls">
      <div className="panel-title">
        <span>Timelapse</span>
        <strong>
          {offsetLabel}
          {frame?.time ? ` · ${formatFrameTime(frame.time, 15)}` : ''}
        </strong>
      </div>
      <div className="timelapse-actions">
        <button
          className="icon-button"
          type="button"
          onClick={() => onPlayingChange(!playing)}
          disabled={loading}
          aria-label={playing ? 'Pause timelapse' : 'Play timelapse'}
          title={playing ? 'Pause timelapse' : 'Play timelapse'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="segmented-control" aria-label="Timelapse duration">
          {TIMELAPSE_HORIZONS.map((hours) => (
            <button
              className={horizon === hours ? 'active' : ''}
              type="button"
              key={hours}
              onClick={() => onHorizonChange(hours)}
            >
              {hours}h
            </button>
          ))}
        </div>
      </div>
      <label className="time-scrubber">
        <span className="sr-only">Forecast hour</span>
        <span className="scrubber-rail" aria-hidden="true">
          <span className="scrubber-fill" style={{ width: `${progressPercent}%` }} />
          <span className="scrubber-thumb" style={{ left: `${progressPercent}%` }} />
        </span>
        <input
          type="range"
          min="0"
          max={horizon}
          step="0.05"
          value={Math.min(progress, horizon)}
          onChange={(event) => onOffsetChange(Number(event.target.value))}
          disabled={loading}
        />
      </label>
    </div>
  );
}

function WeatherPanel({ weather, impact, loading, error }) {
  const liveWeather = weather || DEFAULT_WEATHER;
  const rain = liveWeather.rain || DEFAULT_WEATHER.rain;
  const wind = liveWeather.wind || DEFAULT_WEATHER.wind;
  const weatherTime = liveWeather.generatedAt ? formatFrameTime(liveWeather.generatedAt) : '';

  return (
    <section className="weather-panel" aria-label="Live rain and wind guidance">
      <div className="weather-head">
        <span>Live weather</span>
        <strong>{loading ? 'Updating' : weatherTime || 'Pending'}</strong>
      </div>
      <div className="weather-metrics">
        <div>
          <CloudRain size={15} aria-hidden="true" />
          <span>{rain.label}</span>
          <strong>{liveWeather.precipitation ?? 0} mm/h</strong>
        </div>
        <div>
          <Wind size={15} aria-hidden="true" />
          <span>{wind.label}</span>
          <strong>{liveWeather.windSpeed ?? 0} km/h</strong>
        </div>
      </div>
      <p>{error || `${impact.guidance} Weather-adjusted prominence: ${impact.adjustedScore}/100.`}</p>
    </section>
  );
}

function scoreLabel(score) {
  if (!Number.isFinite(score)) return 'No data';
  if (score < 10) return 'Very low';
  if (score < 30) return 'Low';
  if (score < 55) return 'Moderate';
  if (score < 78) return 'High';
  return 'Very high';
}

function ForecastSnapshot({ forecast, loading, error, selectedCategory }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const aggregate = forecast?.ensemble?.aggregate;
  const selected = forecast?.ensemble?.[selectedCategory] || aggregate;
  const providers = forecast?.providers || [];
  const statusCounts = providers.reduce(
    (counts, provider) => {
      const status = providerDisplayStatus(provider);
      counts[status] += 1;
      return counts;
    },
    { ok: 0, 'not-covered': 0, 'no-data': 0 },
  );
  const summaryStatus =
    statusCounts.ok > 0 ? 'ok' : statusCounts['not-covered'] > 0 ? 'not-covered' : 'no-data';

  return (
    <section className="forecast-snapshot" aria-label="Pollen forecast data">
      <button
        className={`sources-toggle ${sourcesExpanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setSourcesExpanded((value) => !value)}
        aria-expanded={sourcesExpanded}
      >
        <span>
          <strong>Data sources</strong>
          {sourcesExpanded && (
            <small>
              {providers.length ? displayStatus(summaryStatus) : loading ? 'no data' : displayStatus(summaryStatus)}
            </small>
          )}
        </span>
        <ChevronDown size={18} />
      </button>
      {sourcesExpanded && (
        <>
          <div className="source-summary">
            <p>
              {selected
                ? `${selected.label}: ${selected.score}/100, ${scoreLabel(selected.score).toLowerCase()}, from ${selected.signalCount} composite input${selected.signalCount === 1 ? '' : 's'}.`
                : error || 'Move the map or search a location to request a forecast.'}
            </p>
            {selected && aggregate && selected.key !== 'aggregate' && (
              <p>All pollen: {aggregate.score}/100, {scoreLabel(aggregate.score).toLowerCase()}.</p>
            )}
          </div>
          <div className="provider-row" aria-label="Provider status">
            {providers.length === 0 && (
              <div className="provider-pill pending">
                <Database size={16} />
                <span>Providers pending</span>
                <strong>{displayStatus('no-data')}</strong>
              </div>
            )}
            {providers.map((provider) => (
              <div
                className={`provider-pill ${providerDisplayStatus(provider)}`}
                key={provider.id}
                title={provider.notes?.join(' ')}
              >
                <Database size={16} />
                <span>{provider.name}</span>
                <strong>{displayStatus(providerDisplayStatus(provider))}</strong>
              </div>
            ))}
          </div>
          <div className="ensemble-details" aria-label="Composite data inputs">
            {selected?.signals?.length ? (
              selected.signals.map((signal) => (
              <article className="signal-card" key={`${signal.providerId}-${signal.category}`}>
                <div title={signal.sourceDetail}>
                  <p>{signal.providerName}</p>
                </div>
                <dl>
                  <div>
                    <dt>Score</dt>
                    <dd>{signal.score}/100</dd>
                  </div>
                  <div>
                    <dt>Index</dt>
                    <dd>{signal.index}/5</dd>
                  </div>
                  <div>
                    <dt>Raw</dt>
                    <dd>{signal.value === null ? signal.units : `${signal.value} ${signal.units}`}</dd>
                  </div>
                </dl>
              </article>
              ))
            ) : (
              <p className="empty-detail">No provider signals are available for this category at the current map center.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function LocationSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const trimmedQuery = query.trim();
      if (trimmedQuery.length < 2) {
        setResults([]);
        setOpen(false);
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const nextResults = await searchLocations(trimmedQuery, controller.signal);
        setResults(nextResults);
        setOpen(nextResults.length > 0);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setResults([]);
          setOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const chooseResult = (result) => {
    setQuery(result.label);
    setOpen(false);
    onSelect(result);
  };

  const updateQuery = (value) => {
    const fallbackResults = value.trim().length >= 2 ? fallbackLocations(value) : [];
    setQuery(value);
    setResults(fallbackResults);
    setOpen(fallbackResults.length > 0);
    setSearching(value.trim().length >= 2);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    if (results[0]) chooseResult(results[0]);
  };

  return (
    <form className="location-search" role="search" onSubmit={submitSearch}>
      <Search size={16} aria-hidden="true" />
      <label className="sr-only" htmlFor="location-search">
        Search location
      </label>
      <input
        id="location-search"
        type="search"
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        onFocus={() => setOpen(results.length > 0)}
        placeholder="Search location"
        aria-controls="location-search-results"
        aria-expanded={open}
        autoComplete="off"
      />
      <button type="submit" disabled={!results.length}>
        {searching ? 'Searching' : 'Search'}
      </button>
      {open && (
        <div className="search-results" id="location-search-results" role="listbox">
          {results.map((result) => (
            <button type="button" role="option" key={result.id} onClick={() => chooseResult(result)}>
              {result.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function CategoryTiles({ categories, selectedCategory, onSelect }) {
  const [aggregateHelpOpen, setAggregateHelpOpen] = useState(false);
  const aggregateExplanation =
    'All pollen uses the highest grass, tree, or weed severity from each source, then confidence-weights those source scores. This avoids diluting one high allergen or inflating the result by adding unlike concentrations.';
  if (!categories?.length) {
    return (
      <section className="category-tiles" aria-label="Pollen category filters">
        <button className="category-tile active" type="button">
          <span>All pollen</span>
          <strong>Loading</strong>
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="category-tiles" aria-label="Pollen category filters">
        {categories.map((category) => (
          <button
            className={`category-tile ${selectedCategory === category.key ? 'active' : ''}`}
            type="button"
            key={category.key}
            onClick={(event) => {
              if (category.key === 'aggregate' && event.target.closest('.score-info')) {
                event.stopPropagation();
                setAggregateHelpOpen((open) => !open);
                return;
              }
              setAggregateHelpOpen(false);
              onSelect(category.key);
            }}
            aria-describedby={category.key === 'aggregate' ? 'aggregate-score-explanation' : undefined}
          >
            <span className="category-label">
              {category.label}
              {category.key === 'aggregate' && (
                <span
                  className="score-info"
                  aria-hidden="true"
                  title="How the All pollen score is calculated"
                  onMouseEnter={() => setAggregateHelpOpen(true)}
                  onMouseLeave={() => setAggregateHelpOpen(false)}
                >
                  <Info size={13} aria-hidden="true" />
                </span>
              )}
            </span>
            <strong>{category.score}/100</strong>
          </button>
        ))}
        <span className="sr-only" id="aggregate-score-explanation">
          {aggregateExplanation}
        </span>
      </section>
      {aggregateHelpOpen && (
        <div className="aggregate-score-tooltip" role="tooltip">
          <strong>How All pollen is calculated</strong>
          <span>{aggregateExplanation}</span>
        </div>
      )}
    </>
  );
}

function App() {
  const { location, requestLocation } = useUserLocation();
  const [forecastPoint, setForecastPoint] = useState(LONDON);
  const [mapBounds, setMapBounds] = useState(INITIAL_BOUNDS);
  const [selectedCategory, setSelectedCategory] = useState('aggregate');
  const [forecast, setForecast] = useState(null);
  const [forecastError, setForecastError] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [gridData, setGridData] = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState('');
  const [searchLocation, setSearchLocation] = useState(null);
  const [selectedPlaceLabel, setSelectedPlaceLabel] = useState('');
  const [timelapseHorizon, setTimelapseHorizon] = useState(3);
  const [visualTimeOffset, setVisualTimeOffset] = useState(0);
  const [timelapsePlaying, setTimelapsePlaying] = useState(false);
  const [weather, setWeather] = useState(DEFAULT_WEATHER);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const visualTimeOffsetRef = useRef(0);

  const activeFrame = useMemo(
    () => interpolatedFrameFor(gridData, visualTimeOffset),
    [gridData, visualTimeOffset],
  );
  const selectedCategoryData = forecast?.ensemble?.[selectedCategory];
  const weatherImpact = useMemo(
    () => weatherProminence(weather, selectedCategoryData?.score),
    [weather, selectedCategoryData?.score],
  );

  const selectSearchLocation = (locationResult) => {
    setSelectedPlaceLabel(locationResult.label);
    setSearchLocation(locationResult);
  };

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setForecastLoading(true);
      setForecastError('');
      try {
        const data = await fetchForecast({
          lat: String(forecastPoint.lat),
          lng: String(forecastPoint.lng),
          signal: controller.signal,
        });
        setForecast(data);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setForecastError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setForecastLoading(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [forecastPoint]);

  useEffect(() => {
    if (!mapBounds) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setGridLoading(true);
      setGridError('');
      try {
        const data = await fetchGrid({
          bounds: mapBounds,
          category: selectedCategory,
          horizonHours: 8,
          signal: controller.signal,
        });
        setGridData(data);
      } catch (error) {
        if (error.name !== 'AbortError') setGridError(error.message);
      } finally {
        if (!controller.signal.aborted) setGridLoading(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [mapBounds, selectedCategory]);

  useEffect(() => {
    if (!mapBounds || !forecastPoint) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setWeatherLoading(true);
      setWeatherError('');
      try {
        const data = await fetchWeather({
          lat: String(forecastPoint.lat),
          lng: String(forecastPoint.lng),
          bounds: mapBounds,
          signal: controller.signal,
        });
        setWeather(data);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setWeatherError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setWeatherLoading(false);
      }
    }, 650);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [forecastPoint, mapBounds]);

  useEffect(() => {
    setVisualTimeOffset(0);
  }, [selectedCategory, timelapseHorizon]);

  useEffect(() => {
    visualTimeOffsetRef.current = visualTimeOffset;
  }, [visualTimeOffset]);

  useEffect(() => {
    if (!timelapsePlaying) {
      return undefined;
    }

    const millisecondsPerHour = 1200;
    const endHoldMs = 500;
    let startTime = window.performance.now();
    let startOffset = clamp(visualTimeOffsetRef.current, 0, timelapseHorizon);
    let frameId = 0;

    const tick = (now) => {
      const elapsed = now - startTime;
      const travelMs = Math.max((timelapseHorizon - startOffset) * millisecondsPerHour, 1);
      let progress = startOffset + elapsed / millisecondsPerHour;

      if (elapsed >= travelMs) {
        progress = timelapseHorizon;
        if (elapsed >= travelMs + endHoldMs) {
          startTime = now;
          startOffset = 0;
          progress = 0;
        }
      }

      setVisualTimeOffset(progress);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [timelapsePlaying, timelapseHorizon]);

  return (
    <main className="app-shell">
      <CategoryTiles
        categories={forecast?.categories}
        selectedCategory={selectedCategory}
        onSelect={(category) => {
          setTimelapsePlaying(false);
          setSelectedCategory(category);
        }}
      />
      <PollenMap
        location={location}
        selectedPlaceLabel={selectedPlaceLabel}
        searchLocation={searchLocation}
        onSearchSelect={selectSearchLocation}
        onSearchLocationSettled={() => setSearchLocation(null)}
        onRequestLocation={requestLocation}
        onCenterChange={setForecastPoint}
        onBoundsChange={setMapBounds}
        selectedCategory={selectedCategory}
        selectedCategoryData={selectedCategoryData}
        gridData={gridData}
        gridLoading={gridLoading}
        timeProgress={visualTimeOffset}
        weather={weather}
      />
      <section className="map-control-panel" aria-label="Forecast playback and live weather">
        <TimelapseControls
          horizon={timelapseHorizon}
          progress={visualTimeOffset}
          playing={timelapsePlaying}
          loading={gridLoading || gridData?.category !== selectedCategory}
          frame={activeFrame}
          onHorizonChange={(hours) => {
            setTimelapsePlaying(false);
            setTimelapseHorizon(hours);
          }}
          onOffsetChange={(offset) => {
            setTimelapsePlaying(false);
            setVisualTimeOffset(offset);
          }}
          onPlayingChange={setTimelapsePlaying}
        />
        <WeatherPanel
          weather={weather}
          impact={weatherImpact}
          loading={weatherLoading}
          error={weatherError}
        />
      </section>
      <ForecastSnapshot
        forecast={forecast}
        loading={forecastLoading}
        error={forecastError || gridError}
        selectedCategory={selectedCategory}
      />
    </main>
  );
}

const rootElement = document.getElementById('root');
const root = globalThis.__pollenForecastRoot || createRoot(rootElement);
globalThis.__pollenForecastRoot = root;
root.render(<App />);
