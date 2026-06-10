# Pollen Forecast

A responsive pollen forecast map for desktop and mobile. It requests browser geolocation, falls back to London when location is blocked, overlays predicted pollen concentration on a Leaflet map, and shows category-specific ensemble forecast details.

## Local Development

```bash
npm install
npm run dev
```

The Vite app runs on `http://127.0.0.1:5173/` and proxies `/api/*` requests to the local Express server on `http://127.0.0.1:8787/`.

Create a local `.env` from `.env.example` for the server-backed providers:

```bash
cp .env.example .env
```

## Data Providers

- Open-Meteo / CAMS: used for raw concentration values and the map overlay. This works on GitHub Pages without a key.
- Google Pollen API: used locally through the Express API when `GOOGLE_POLLEN_API_KEY` is set.
- Tomorrow.io: wired locally through the Express API when `TOMORROW_API_KEY` is set, but the provided account currently returns a plan-entitlement error for pollen fields.

Open-Meteo and CAMS are treated as one model family so CAMS is not double-counted in the ensemble.

## GitHub Pages

This repo deploys through `.github/workflows/pages.yml`.

GitHub Pages is static hosting and cannot run `server/index.js`. On Pages, the app will:

- fetch Open-Meteo directly from the browser;
- show Google/Tomorrow as needing a backend unless `VITE_API_BASE_URL` points at a deployed API;
- continue to support the map, geolocation fallback, category tiles, overlay, and expandable signal panel.

For full provider parity on Pages, deploy `server/index.js` to a Node-compatible host such as Render, Fly.io, Railway, or a serverless platform, set `GOOGLE_POLLEN_API_KEY` and `TOMORROW_API_KEY` there, then add a GitHub repository variable:

```text
VITE_API_BASE_URL=https://your-api.example.com
```

Do not embed Google or Tomorrow.io API keys into the Vite bundle unless they are intentionally browser-public and locked down by provider-side restrictions.
