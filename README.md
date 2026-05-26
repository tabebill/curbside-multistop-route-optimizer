# Curbside Multistop Route Optimizer - Production Branch

This branch contains the fuller Google-backed version of the curbside multi-stop route optimizer. It is meant for builders who want a realistic starting point for a production webapp, not just the API-free demo on `main`.

## Which Branch Should I Use?

| Branch | Best for | External services |
| --- | --- | --- |
| `main` | Trying the curbside street-sweep idea quickly | None |
| `production` | Building a real multi-stop routing app | Google Maps Platform + Google Cloud |

Use `main` if you want a safe, no-setup demo. Use `production` if you want geocoding, map rendering, Route Optimization API calls, async large-route jobs, exports, and a path toward deployment.

## What This Version Includes

- Next.js/React route workspace.
- Manual and file-based stop imports.
- Address and coordinate input support.
- Server-side geocoding and validation.
- Duplicate/repeat stop filtering.
- Current-location start option.
- Optional selected end stop or round trip.
- Google Maps marker rendering and route polyline display.
- Curbside street-sweep ordering for same-street, same-curb delivery.
- Google Route Optimization API integration.
- Async `batchOptimizeTours` flow for large routes.
- Google Cloud Storage support for batch request/response files.
- CSV, JSON, KML, GPX, and printable export options.
- Local autosave, rate-limit hooks, and basic cost guardrails.

## Required Google Services

Enable these APIs in your Google Cloud project:

- Maps JavaScript API
- Geocoding API
- Route Optimization API
- Cloud Storage API

Optional, depending on how you extend the app:

- Places API (New), for address autocomplete.
- Routes API, for extra short-segment route detail.
- Address Validation API, for postal-quality address validation.

## Environment Variables

Copy the example file:

```bash
cp .env.example .env.local
```

Fill these values with your own credentials:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=
GOOGLE_MAPS_SERVER_KEY=
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_ROUTE_OPTIMIZATION_BUCKET=
```

Optional/legacy compatibility variables:

```bash
GOOGLE_MAPS_API_KEY=
GOOGLE_CLOUD_PROJECT_NUMBER=
GOOGLE_ROE_SERVICE_ACCOUNT=
```

Notes:

- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is used in the browser for map rendering.
- `GOOGLE_MAPS_SERVER_KEY` is used only on the server for geocoding.
- `GOOGLE_APPLICATION_CREDENTIALS` should point to a local service-account JSON file during local development.
- Do not commit `.env.local` or service-account JSON files.
- In production hosting, store service-account credentials in your host's secret manager instead of committing files.

## Google Cloud Setup

1. Create or choose a Google Cloud project.
2. Enable billing.
3. Enable the APIs listed above.
4. Create a browser API key restricted by HTTP referrer for Maps JavaScript API.
5. Create a server API key restricted to Geocoding API.
6. Create a service account for Route Optimization API and Cloud Storage access.
7. Grant the service account access needed for Route Optimization and Cloud Storage.
8. Create a Cloud Storage bucket for batch optimization input/output files.
9. Put your local service-account JSON outside the repo and reference it with `GOOGLE_APPLICATION_CREDENTIALS`.

## Local Development

```bash
git clone -b production https://github.com/tabebill/curbside-multistop-route-optimizer.git
cd curbside-multistop-route-optimizer
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run lint
npm run build
```

The app can load without credentials, but map rendering, geocoding, validation, and optimization require configured Google credentials.

## Security

This branch intentionally does not include personal secrets, `.env.local`, service-account JSON, or Cloud Storage credentials. Before deploying your own fork, review API key restrictions, quota limits, service-account permissions, and billing alerts.

## License

MIT
