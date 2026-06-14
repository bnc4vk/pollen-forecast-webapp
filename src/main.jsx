import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ChevronDown,
  Database,
  Search,
  Navigation,
} from 'lucide-react';
import { fetchForecast, fetchGrid } from './pollenData.js';
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

function concentrationColor(value, max, alpha = 0.62) {
  const stops = [
    { t: 0, color: [72, 155, 111] },
    { t: 0.22, color: [178, 198, 78] },
    { t: 0.45, color: [237, 175, 73] },
    { t: 0.7, color: [218, 92, 70] },
    { t: 1, color: [116, 73, 143] },
  ];
  const t = max > 0 ? clamp(value / Math.max(max, 12), 0, 1) : 0;
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
}) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const accuracyRef = useRef(null);
  const overlayRef = useRef(null);
  const [legendHelpOpen, setLegendHelpOpen] = useState(false);
  const gridIsCurrent = gridData?.category === selectedCategory;
  const gridIsFlatZero = gridIsCurrent && gridData && gridData.min === 0 && gridData.max === 0;
  const hasEnsembleScore = Number(selectedCategoryData?.score) > 0;
  const legendTooltip = selectedCategoryData
    ? `${selectedCategoryData.score}/100 is a normalized exposure score from the available forecast sources. The color ramp maps that same score: green 0-24, yellow 25-49, orange 50-74, red 75-100. ${
        gridLoading || !gridIsCurrent
          ? 'Updating map layer.'
          : gridIsFlatZero && hasEnsembleScore
            ? `No map color is shown because raw ${categoryLabel(selectedCategory).toLowerCase()} pollen amount is unavailable for this area.`
            : gridData
              ? `Map color range: ${gridData.min}-${gridData.max} ${gridData.units}.`
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

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

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
    const map = mapRef.current;
    if (!map) return;

    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    if (!gridData?.points?.length || gridData.max <= 0) return;

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
      _draw() {
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        const canvas = this._canvas;
        const dpr = window.devicePixelRatio || 1;

        L.DomUtil.setPosition(canvas, topLeft);
        canvas.width = size.x * dpr;
        canvas.height = size.y * dpr;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.x, size.y);
        ctx.globalCompositeOperation = 'source-over';

        const radius = Math.max(size.x / (gridData.cols || 8), size.y / (gridData.rows || 8)) * 1.45;
        const max = Math.max(gridData.max || 0, 12);

        for (const point of gridData.points) {
          const pixel = map.latLngToContainerPoint([point.lat, point.lng]);
          const gradient = ctx.createRadialGradient(pixel.x, pixel.y, 0, pixel.x, pixel.y, radius);
          gradient.addColorStop(0, concentrationColor(point.value, max, 0.58));
          gradient.addColorStop(0.58, concentrationColor(point.value, max, 0.28));
          gradient.addColorStop(1, concentrationColor(point.value, max, 0));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(pixel.x, pixel.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });

    overlayRef.current = new PollenLayer().addTo(map);

    return () => {
      overlayRef.current?.remove();
      overlayRef.current = null;
    };
  }, [gridData]);

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
              ? `${categoryLabel(selectedCategory)} ${selectedCategoryData.score}/100`
              : `${categoryLabel(selectedCategory)} score pending`}
          </p>
        </div>
        <span className={`legend-ramp ${gridIsFlatZero ? 'flat' : ''}`} aria-hidden="true" />
      </div>
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
    <section className="category-tiles" aria-label="Pollen category filters">
      {categories.map((category) => (
        <button
          className={`category-tile ${selectedCategory === category.key ? 'active' : ''}`}
          type="button"
          key={category.key}
          onClick={() => onSelect(category.key)}
        >
          <span>{category.label}</span>
          <strong>{category.score}/100</strong>
        </button>
      ))}
    </section>
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

  return (
    <main className="app-shell">
      <CategoryTiles
        categories={forecast?.categories}
        selectedCategory={selectedCategory}
        onSelect={setSelectedCategory}
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
        selectedCategoryData={forecast?.ensemble?.[selectedCategory]}
        gridData={gridData}
        gridLoading={gridLoading}
      />
      <ForecastSnapshot
        forecast={forecast}
        loading={forecastLoading}
        error={forecastError || gridError}
        selectedCategory={selectedCategory}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
