# Multi-Stop Pins

A local Next.js app for previewing, optimizing, and navigating many stops on a Google map.

The app lets a user paste or import a list of addresses, geocode them, show numbered pins on Google Maps, optimize the visit order with Google Route Optimization API, draw motorable route lines with Google Directions, and step through the route inside the app with Previous / Next navigation.

## What This App Uses

Google APIs:

- Maps JavaScript API: renders the Google map in the browser.
- Geocoding API: converts pasted addresses into latitude/longitude coordinates.
- Directions API / Maps JavaScript Directions service: draws motorable road lines between optimized stops.
- Route Optimization API: decides the optimized stop order.

Not required for this app:

- Google Cloud Storage
- OAuth Client ID
- Places API
- Routes API

## How It Works

1. The user pastes or imports one address per line.
2. The server calls Geocoding API and returns coordinates.
3. The browser shows numbered pins on Google Maps.
4. The server calls Route Optimization API using a service account OAuth token.
5. The app reorders and renumbers pins from Google's optimized order.
6. The map draws drivable route lines with DirectionsService.
7. The route line is drawn in chunks so large routes can render reliably.
8. The user navigates inside the app with Previous / Next.

The route line chunking is internal. For example, 100 stops are shown as one route to the user, but the browser asks Google Directions for several smaller route sections behind the scenes.

## Requirements

- Node.js 20 or newer
- npm
- A Google Cloud project with billing enabled
- A Google Maps Platform API key for the browser map
- A Google Maps Platform API key for server-side geocoding
- A Google Cloud service account credential for Route Optimization

## Clone This Branch

```bash
git clone -b multi-stop-pins https://github.com/tabebill/curbside-multistop-route-optimizer.git multi-stop-pins
cd multi-stop-pins
npm install
```

## Google Cloud Setup

Open Google Cloud Console:

https://console.cloud.google.com/

Create or choose a project, then make sure billing is enabled.

### 1. Enable APIs

Enable these APIs in the same Google Cloud project:

- Maps JavaScript API
- Geocoding API
- Directions API
- Route Optimization API

Useful docs:

- Maps JavaScript API loading docs: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- Geocoding API setup: https://developers.google.com/maps/documentation/geocoding/get-api-key
- Directions service docs: https://developers.google.com/maps/documentation/javascript/directions
- Route Optimization API overview: https://developers.google.com/maps/documentation/route-optimization/overview

### 2. Create A Browser API Key

Google Cloud Console:

APIs & Services -> Credentials -> Create credentials -> API key

Use this key for:

```env
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=
```

Recommended restrictions:

- Application restriction: HTTP referrers
- Local referrers:
  - `http://localhost:3000/*`
  - `http://localhost:3001/*`
- Production referrer:
  - `https://your-domain.com/*`
- API restrictions:
  - Maps JavaScript API
  - Directions API

The browser key is public by design because it is used in the browser, so restrictions matter.

### 3. Create A Server Geocoding API Key

Create another API key for server-side geocoding.

Use it for:

```env
GOOGLE_MAPS_SERVER_KEY=
```

Recommended restrictions:

- API restrictions:
  - Geocoding API
- Application restriction:
  - For production, restrict by server IP address if your host gives you a stable outbound IP.
  - For local development, you may need a less restricted local-only key because your home IP can change.

Do not expose this key in client-side code.

### 4. Create A Service Account For Route Optimization

Route Optimization API does not work with only a plain API key in this app. The server mints an OAuth access token from a Google service account.

Google Cloud Console:

IAM & Admin -> Service Accounts -> Create service account

Grant the service account access to Route Optimization. The simple option is:

- Route Optimization Editor: `roles/routeoptimization.editor`

For least privilege, use a custom role that includes:

- `routeoptimization.locations.use`

Then create a JSON key:

Service account -> Keys -> Add key -> Create new key -> JSON

Save the JSON file outside the repo, for example:

```bash
mkdir -p ~/.config/multi-stop-pins
mv ~/Downloads/YOUR_SERVICE_ACCOUNT_FILE.json ~/.config/multi-stop-pins/google-service-account.json
```

Use its absolute path for:

```env
GOOGLE_APPLICATION_CREDENTIALS=/Users/YOUR_NAME/.config/multi-stop-pins/google-service-account.json
```

Official auth docs:

- Application Default Credentials: https://docs.cloud.google.com/docs/authentication/application-default-credentials
- Route Optimization optimizeTours auth/permission: https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours
- Route Optimization IAM roles: https://docs.cloud.google.com/iam/docs/roles-permissions/routeoptimization

## Environment Variables

Create `.env.local`:

```bash
cp .env.example .env.local
```

Fill it in:

```env
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=your_browser_key
GOOGLE_MAPS_SERVER_KEY=your_server_geocoding_key
GOOGLE_CLOUD_PROJECT_ID=your_google_cloud_project_id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
```

Never commit `.env.local` or the service account JSON file.

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

If port 3000 is busy:

```bash
npm run dev -- -p 3001
```

Then open:

```text
http://localhost:3001
```

## Use The App

1. Paste one address per line.
2. Click Preview Pins.
3. Confirm the pins appear on the Google map.
4. Click Optimize Route.
5. The app will reorder the stop list and renumber the map pins.
6. The map will draw motorable road lines.
7. Use the Navigation panel:
   - Previous
   - Next
   - Route overview

The app keeps navigation inside the web UI. It does not redirect to Google Maps because Google Maps URL/native navigation has much lower practical stop limits than the in-app Directions rendering flow.

## 25-Stop Route Line Chunks

The app can show a route for many stops, such as 100 stops.

Internally, it draws road lines with the Google Maps JavaScript Directions service in chunks. The Directions service supports a limited number of waypoints per request, so the app sends route-line requests in sections and displays the sections together.

Example:

- Chunk 1: stops 1-25
- Chunk 2: stops 25-49
- Chunk 3: stops 49-73
- Chunk 4: stops 73-97
- Chunk 5: stops 97-100

The overlap keeps the displayed route continuous.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Troubleshooting

### "API keys are not supported by this API"

This means Route Optimization was called with an API key instead of OAuth credentials.

Check:

```env
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
GOOGLE_CLOUD_PROJECT_ID=your_project_id
```

Restart the dev server after changing `.env.local`.

### "Permission routeoptimization.locations.use denied"

The service account does not have the required Route Optimization permission.

Grant either:

- `roles/routeoptimization.editor`

or a custom role with:

- `routeoptimization.locations.use`

### "Missing GOOGLE_MAPS_SERVER_KEY"

The server-side Geocoding API key is missing.

Add:

```env
GOOGLE_MAPS_SERVER_KEY=your_server_geocoding_key
```

### The map says the browser key is missing

Add:

```env
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=your_browser_key
```

Then restart the dev server.

### Route lines do not draw

Check that:

- Directions API is enabled.
- The browser API key allows Directions API.
- The browser key referrer restrictions include your local URL.
- The optimized route has at least two valid mapped stops.

### Route Optimization timestamp validation errors

The app sends whole-second timestamps to Google. If you modify the optimization request, avoid fractional seconds in `globalStartTime` and `globalEndTime`.

## Security Notes

- Do not commit `.env.local`.
- Do not commit service account JSON files.
- Restrict browser API keys by HTTP referrer.
- Restrict server API keys by API, and by IP address in production when possible.
- Prefer attached service accounts or secret managers in production instead of storing JSON keys on disk.

## Cost Notes

This app can trigger billable Google Maps Platform usage:

- Map loads
- Geocoding requests
- Directions requests
- Route Optimization shipments

Set budgets and quotas in Google Cloud Console before production use:

https://console.cloud.google.com/billing

Route Optimization billing is based on shipment usage and SKU type. See:

https://developers.google.com/maps/documentation/route-optimization/usage-and-billing

## Tech Stack

- Next.js
- React
- TypeScript
- Google Maps JavaScript API
- Google Geocoding API
- Google Directions service
- Google Route Optimization API
