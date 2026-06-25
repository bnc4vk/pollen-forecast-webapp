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
- Austrian Pollen Information Service: official four-day allergen-load forecast for AT, CH, DE, ES, FR, GB, IT, LV, LT, PL, SE, TR, and UA. Requires `POLLENINFORMATION_API_KEY`; country detection is performed locally and responses are cached by country and area for four hours. Data must be attributed to `www.polleninformation.at`, and its terms prohibit commercial use.
- Met Office Pollen: an independent UK-only regional model used as a lower-weight corroborating signal. No key is required.

Open-Meteo and CAMS are treated as one model family so CAMS is not double-counted in the ensemble.
The Met Office feed is cached by the API and parsed from its public regional forecast page because no documented public pollen API is currently offered.

## GitHub Pages

This repo deploys through `.github/workflows/pages.yml`.

Every push to `main` deploys the Cloudflare Worker first, verifies that it is running the
same commit SHA, then deploys GitHub Pages and verifies the published `deploy.json`.
Configure these GitHub Actions secrets before merging to `main`:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

The Cloudflare token only needs permission to edit Workers Scripts for the account.

GitHub Pages is static hosting and cannot run `server/index.js`. On Pages, the app will:

- fetch Open-Meteo directly from the browser;
- show server-backed providers as needing a backend unless `VITE_API_BASE_URL` points at a deployed API;
- continue to support the map, geolocation fallback, category tiles, overlay, and expandable signal panel.

For full provider parity on Pages, deploy `server/index.js` to a Node-compatible host such as Render, Fly.io, Railway, or a serverless platform, set `GOOGLE_POLLEN_API_KEY` and `POLLENINFORMATION_API_KEY` there, then add a GitHub repository variable:

```text
VITE_API_BASE_URL=https://your-api.example.com
```

Do not embed provider API keys into the Vite bundle unless they are intentionally browser-public and locked down by provider-side restrictions.

## Cloudflare Worker API

This repo includes a Cloudflare Worker API at `worker/index.js`. It exposes:

- `GET /api/health`
- `GET /api/forecast?lat=51.5074&lng=-0.1278`
- `GET /api/grid?north=51.7&south=51.3&east=0.15&west=-0.35&category=aggregate`

Deploy it with:

```bash
npm run worker:deploy
```

Set provider secrets with Wrangler:

```bash
npx wrangler secret put GOOGLE_POLLEN_API_KEY
npx wrangler secret put POLLENINFORMATION_API_KEY
```

After deployment, set `VITE_API_BASE_URL` in the Pages build to the Worker URL.
