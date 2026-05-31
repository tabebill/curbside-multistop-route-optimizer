# Curbside Multistop Route Optimizer - Production Branch

This branch contains the fuller Google-backed version of the curbside multi-stop route optimizer. It is meant for builders who want a realistic starting point for a production webapp, not just the API-free demo on `main`.

## Which Branch Should I Use?

| Branch | Best for | External services |
| --- | --- | --- |
| `main` | Trying the curbside street-sweep idea quickly | None |
| `production` | Building a real multi-stop routing app | Google Maps Platform + Google Cloud |

Use `main` if you want a safe, no-setup demo. Use `production` if you want geocoding, map rendering, Route Optimization API calls, async large-route jobs, exports, and a path toward deployment.

## Route Optimization Modes

- `Auto`: default mode. Seeds Google with the app's best local order, asks for
  side-of-road handling, then quality-checks Google, repaired, and curbside
  candidate routes before returning the safest sequence.
- `Google`: lets Google Route Optimization choose the global visit order. Use this when shortest/fastest routing matters most.
- `Curbside`: lets Google choose the global order while asking for side-of-road waypoint handling.
- `Strict`: forces the app's street-sweep order before calling Google. Use only when same-curb delivery order matters more than global shortest route.

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
GOOGLE_ROUTE_OPTIMIZATION_BATCH_TIMEOUT_SECONDS=1800
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
- `GOOGLE_ROUTE_OPTIMIZATION_BATCH_TIMEOUT_SECONDS` controls the solver time for async jobs. It defaults to `1800` seconds and is capped at Google's 30-minute maximum, which matters for large routes such as 5,000-stop jobs.
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

For optimizer-specific checks, run:

```bash
npm test
npm run benchmark:routes
npm run benchmark:routes:5000
npm run benchmark:routes:5000:all
```

The benchmark uses deterministic synthetic stops and reports stop preservation,
elapsed time, and route-quality diagnostics for large local route ordering.
`benchmark:routes:5000:all` runs both Google-seeded and strict curbside local
ordering at 5,000 stops.

The optimizer checks route quality with several diagnostics:

- `suspiciousJumpCount`: fails when a route jumps far away while much closer
  unvisited stops remain later in the sequence.
- `nearestNeighborMatchRate`: measures how often the next stop is reasonably
  close to the nearest remaining stop.
- `streetFaceReentryCount`: catches returning to the same side of a street after
  leaving it.
- `streetFaceBacktrackCount`: catches house-number backtracking on the same
  curb.
- `longestLegRatio`: compares the longest leg against a calibrated baseline so
  hidden long connector legs do not slip through otherwise clean routes.

The default large-route gate allows no suspicious jumps, requires nearest-neighbor
continuity, preserves every stop exactly once, and fails when the longest leg is
more than `20x` the larger of the median leg or an `80m` residential baseline.
Tune these with `ROUTE_BENCHMARK_MAX_SUSPICIOUS_JUMPS`,
`ROUTE_BENCHMARK_MIN_NEAREST_MATCH_RATE`,
`ROUTE_BENCHMARK_MAX_LONGEST_LEG_RATIO`, and
`ROUTE_BENCHMARK_MIN_LEG_BASELINE_METERS`.

To verify the included `sample-addresses.txt` through the live local API, start
the app with configured Google credentials and run:

```bash
npm run verify:sample-route
```

Use `ROUTE_SAMPLE_BASE_URL` if the dev server is not running on
`http://localhost:3000`. The sample verifier fails on missing or duplicate
visits, suspicious jumps, poor nearest-neighbor continuity, repeated street-face
reentries, curbside house-number backtracking, and excessive longest-leg ratio.
Tune the sample gate with `ROUTE_SAMPLE_MAX_SUSPICIOUS_JUMPS`,
`ROUTE_SAMPLE_MIN_NEAREST_MATCH_RATE`,
`ROUTE_SAMPLE_MAX_STREET_FACE_REENTRIES`,
`ROUTE_SAMPLE_MAX_STREET_FACE_BACKTRACKS`,
`ROUTE_SAMPLE_MAX_LONGEST_LEG_RATIO`, and
`ROUTE_SAMPLE_MIN_LEG_BASELINE_METERS`.

To verify the same sample through the browser UI, with import, validation,
Google-candidate acceptance, optimization, and navigation numbering checked end
to end, run:

```bash
npm run verify:sample-ui
```

This command fails if the UI optimizes fewer stops than the sample contains, if
the final navigation sequence is missing, if route-review warnings appear, or if
browser console errors are emitted.

## Security

This branch intentionally does not include personal secrets, `.env.local`, service-account JSON, or Cloud Storage credentials. Before deploying your own fork, review API key restrictions, quota limits, service-account permissions, and billing alerts.

## License

MIT
