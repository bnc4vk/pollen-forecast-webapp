import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  ChevronDown,
  Database,
  LocateFixed,
  MapPinned,
  Navigation,
  Wind,
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

function formatCoord(value, axis) {
  const direction = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(4)}°${direction}`;
}

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
          'Location permission is blocked in this browser. Enable site location permissions, then recheck location.',
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
            ? 'Enable location for this site in browser settings, then recheck location.'
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

function PollenMap({ location, onCenterChange, onBoundsChange, selectedCategory, gridData, gridLoading }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const accuracyRef = useRef(null);
  const overlayRef = useRef(null);
  const [center, setCenter] = useState(location);

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
      setCenter(nextCenter);
      onCenterChange?.(nextCenter);
      onBoundsChange?.(boundsFromLeaflet(map.getBounds()));
    };

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
    setCenter({ lat: location.lat, lng: location.lng });
    onCenterChange?.({ lat: location.lat, lng: location.lng });
    onBoundsChange?.(boundsFromLeaflet(map.getBounds()));

    const latLng = [location.lat, location.lng];
    if (!markerRef.current) {
      markerRef.current = L.circleMarker(latLng, {
        radius: 8,
        color: '#25352e',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(latLng);
    }

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
    if (!map) return;

    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    if (!gridData?.points?.length) return;

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
      <div className="map-toolbar">
        <div>
          <p className="toolbar-label">Map center</p>
          <p className="toolbar-value">
            {formatCoord(center.lat, 'lat')} {formatCoord(center.lng, 'lng')}
          </p>
        </div>
        <div className={`location-badge ${location.source}`}>
          <Navigation size={16} />
          <span>{location.source === 'pending' ? 'Locating' : location.source}</span>
        </div>
      </div>
      {location.source !== 'precise' && (
        <div className="permission-panel" role="status" aria-live="polite">
          <p>{location.label}</p>
          <span>{location.guidance}</span>
        </div>
      )}
      <div ref={mapNode} className="leaflet-host" />
      <div className="map-legend" aria-label="Pollen overlay legend">
        <div>
          <p className="toolbar-label">{gridData?.label || categoryLabel(selectedCategory)} overlay</p>
          <p className="toolbar-value">
            {gridLoading ? 'Updating grid...' : gridData ? `${gridData.min}-${gridData.max} ${gridData.units}` : 'No grid'}
          </p>
        </div>
        <span className="legend-ramp" aria-hidden="true" />
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
  const [expanded, setExpanded] = useState(false);
  const aggregate = forecast?.ensemble?.aggregate;
  const selected = forecast?.ensemble?.[selectedCategory] || aggregate;
  const providers = forecast?.providers || [];
  const okProviders = providers.filter((provider) => provider.status === 'ok').length;
  const providerIssues = providers.filter((provider) => provider.status !== 'ok');

  return (
    <section className="forecast-snapshot" aria-label="Pollen forecast data">
      <div className="snapshot-primary">
        <p className="toolbar-label">Synthesized pollen forecast</p>
        <h2>{loading ? 'Updating forecast...' : aggregate ? scoreLabel(aggregate.score) : 'Waiting for data'}</h2>
        <p>
          {error
            ? error
            : aggregate
              ? `${aggregate.score}/100 ensemble score from ${aggregate.signalCount} contributing signals`
              : 'Move the map or enable location to request a forecast.'}
        </p>
      </div>
      <div className="provider-row" aria-label="Provider status">
        {providers.length === 0 && (
          <div className="provider-pill pending">
            <Database size={16} />
            <span>Providers pending</span>
          </div>
        )}
        {providers.map((provider) => (
          <div className={`provider-pill ${provider.status}`} key={provider.id} title={provider.notes?.join(' ')}>
            <Database size={16} />
            <span>{provider.name}</span>
            <strong>{provider.status}</strong>
          </div>
        ))}
      </div>
      {forecast && (
        <p className="snapshot-footnote">
          {okProviders}/{providers.length} providers currently contribute; categories are generated from provider
          data present at this map center.
        </p>
      )}
      {providerIssues.length > 0 && (
        <div className="provider-issues" aria-label="Provider issues">
          {providerIssues.map((provider) => (
            <p key={provider.id}>
              <strong>{provider.name}:</strong> {provider.error || provider.notes?.[0] || provider.status}
            </p>
          ))}
        </div>
      )}
      <button
        className={`ensemble-toggle ${expanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>
          <strong>Composite ensemble signals</strong>
          <small>
            {selected
              ? `${selected.label}: ${selected.score}/100 from ${selected.signalCount} signals`
              : 'Waiting for forecast signals'}
          </small>
        </span>
        <ChevronDown size={18} />
      </button>
      {expanded && (
        <div className="ensemble-details" aria-label="Expanded ensemble signal details">
          {selected?.signals?.length ? (
            selected.signals.map((signal) => (
              <article className="signal-card" key={`${signal.providerId}-${signal.category}`}>
                <div>
                  <p>{signal.providerName}</p>
                  <span>{signal.sourceDetail}</span>
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
          {forecast?.caveats?.map((caveat) => (
            <p className="detail-caveat" key={caveat}>
              {caveat}
            </p>
          ))}
        </div>
      )}
    </section>
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
      <section className="hero-panel" aria-labelledby="app-title">
        <div className="title-block">
          <div className="brand-mark" aria-hidden="true">
            <Wind size={20} />
          </div>
          <div>
            <p className="eyebrow">Live allergy planning</p>
            <h1 id="app-title">Pollen Forecast</h1>
          </div>
        </div>

        <div className="status-grid" aria-label="App readiness">
          <div className="status-tile">
            <MapPinned size={18} />
            <span>{location.label}</span>
          </div>
          <button className="status-tile action-tile" type="button" onClick={requestLocation}>
            <LocateFixed size={18} />
            <span>Recheck location</span>
          </button>
          <div className="status-tile compact">
            <Activity size={18} />
            <span>{forecast ? `${forecast.categories.length} categories` : 'Loading forecast'}</span>
          </div>
        </div>
      </section>

      <CategoryTiles
        categories={forecast?.categories}
        selectedCategory={selectedCategory}
        onSelect={setSelectedCategory}
      />
      <PollenMap
        location={location}
        onCenterChange={setForecastPoint}
        onBoundsChange={setMapBounds}
        selectedCategory={selectedCategory}
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
