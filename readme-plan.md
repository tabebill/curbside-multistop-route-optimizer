# Multi-Stop Route Optimizer Webapp Plan

This plan describes a standalone RouteXL-style webapp for importing, validating, optimizing, editing, and exporting large multi-stop driving routes.

## Recommendation

Build a Next.js/React webapp backed by Google Maps Platform.

The app should support route projects with up to about 5,000 stops. Because that stop count is far beyond the standard Google Routes API waypoint limit, the main optimization engine should be Google Route Optimization API, modeled as one user-owned route with one vehicle and many stops.

Use server-side background jobs for optimization. Large jobs should not run inside a normal browser request/response loop.

## Current Local Build Status

The local Next.js implementation now covers the planned v1 workflow:

- Import addresses, coordinates, or mixed CSV/manual rows.
- Validate coordinates locally and geocode address-only stops server-side.
- Select a start point and choose round trip, last stop, or a specific end stop.
- Optimize small routes with synchronous Route Optimization API calls.
- Optimize routes over 100 stops with asynchronous `batchOptimizeTours` plus Cloud Storage.
- Enforce a 5,000 valid-stop maximum before submitting optimization jobs.
- Display clustered map markers, optimized route geometry, metrics, and ordered stops.
- Edit stops, disable stops, pin stops, manually reorder optimized visits, and re-optimize.
- Export ordered results as CSV, JSON, KML, GPX, and printable PDF.
- Support optional Curbside mode that groups stops by normalized street, sequences one curb face in house-number order, then sequences the opposite curb face before moving to the next nearby street.
- Apply local autosave, server-side rate-limit hooks, geocoding cache, optimization cache, and cost guardrails.

Verified locally with `npm run lint`, `npm run build`, live Google sync optimization, live Google async batch optimization, and Playwright browser smoke tests.

## Updated Google API Stack

Required for v1:

- Google Maps JavaScript API: interactive map, markers, clustering, stop selection, and route visualization.
- Google Places API (New): typed address search and autocomplete for manual stop entry.
- Google Geocoding API: server-side validation and normalization for imported addresses.
- Google Route Optimization API: primary optimizer for large stop sets, including single-user routes with thousands of stops.

Required for large async optimization:

- Google Cloud Storage API: stores request and response JSON when using Route Optimization API `batchOptimizeTours`.

Optional:

- Google Routes API: optional short-segment recalculation or detail enrichment. It is not the main optimizer for 5,000-stop routes.
- Google Address Validation API: stronger postal-quality address validation if geocoding is not enough.
- Google Maps Static API: static map images for PDF exports.
- Google Maps URLs: shareable Google Maps links. This does not require an API key.

## Credential Model

Use separate credentials by surface:

- Browser API key: Maps JavaScript API and Places API (New), restricted by website referrer.
- Server API key: Geocoding API and optional Routes API, stored only in server environment variables.
- Server service account/OAuth credentials: Route Optimization API and Cloud Storage API. Route Optimization API calls should be made from the backend with an OAuth access token, not directly from the browser.

Suggested local environment variables:

- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`
- `GOOGLE_MAPS_SERVER_KEY`
- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` or a production secret containing the service account JSON
- `GOOGLE_ROUTE_OPTIMIZATION_BUCKET`

## Key Product Limits

- A route project/import may contain up to about 5,000 stops.
- Imported stops may contain addresses, coordinates, or both.
- Validation runs before optimization.
- Coordinates should be range-checked and deduplicated before optimization.
- Addresses should be geocoded, normalized, and stored before optimization.
- Repeated addresses and coordinates should reuse cached validation results.
- A 5,000-stop optimization should run as a background job with progress/status, not as a blocking UI action.

## Core Workflow

1. User creates a route project.
2. User adds stops manually or imports a CSV with addresses, coordinates, or both.
3. App parses, deduplicates, and validates the import.
4. App geocodes address-only rows and preserves coordinate rows.
5. App shows valid stops and validation errors before optimization.
6. User chooses route settings such as start point, end point, round trip, and optional Curbside mode.
7. App creates a server-side optimization job.
8. App sends the job to Google Route Optimization API.
9. App stores the optimized stop order, metrics, skipped stops, and route geometry/transition data.
10. App shows the optimized route on a map with numbered stops.
11. User can manually reorder, disable, or pin stops and rerun optimization.
12. User can export or share the route as CSV, PDF, and GPX/KML where useful.

## Core Pages

- Routes Dashboard: saved route projects, status, stop count, validation state, total estimated distance, and total estimated time.
- Create Route: manual stop entry, CSV import, route settings, and validation summary.
- Import Review: parsed rows, invalid rows, duplicates, geocoding confidence, and correction tools.
- Route Builder: map plus searchable ordered stop list.
- Optimization Jobs: queued/running/completed/failed jobs with retry controls.
- Optimized Route View: numbered stops, route metrics, warnings, skipped stops, and map visualization.
- Export Center: CSV, PDF, GPX/KML, and Google Maps links.

## Data Model

Recommended tables:

- `routes`
- `route_stops`
- `route_imports`
- `route_import_rows`
- `route_validation_errors`
- `route_optimization_jobs`
- `route_optimization_results`
- `route_exports`

Each route should store:

- name
- status
- start location
- end location
- round-trip setting
- travel mode
- route modifiers such as avoid highways, tolls, and ferries
- curbside routing preference
- stop count
- total distance
- total duration
- created and updated timestamps

Each stop should store:

- original input address
- normalized address
- latitude and longitude
- Google place ID, when available
- source type: address, coordinates, or both
- validation status
- validation confidence
- import row reference
- optimized stop number
- manual order override, when present
- skipped/disabled status
- notes

Each optimization job should store:

- route ID
- status: queued, validating, optimizing, completed, failed, canceled
- request type: synchronous optimizeTours or asynchronous batchOptimizeTours
- Google operation name, when asynchronous
- request storage URI, when using Cloud Storage
- response storage URI, when using Cloud Storage
- error details
- started and completed timestamps

## Google API Choice

Use Google Route Optimization API as the primary optimizer.

For the first implementation:

- Treat the route as one vehicle.
- Treat each stop as one shipment/visit.
- Use `optimizeTours` for small and medium jobs that can return within a reasonable server timeout.
- Use `batchOptimizeTours` for large jobs such as 5,000 stops or jobs expected to run for several minutes.
- Store the returned visit order as the app's source of truth.

Use Google Routes API only as a helper:

- route previews for small stop subsets
- recalculating a manually edited short segment
- getting additional route detail for chunks that fit within the waypoint limit

Curbside route behavior:

- Keep the regular optimizer available for shortest/fastest routing.
- When Curbside mode is enabled, build a local street-sweep order before calling Google: normalize the street name, split stops by odd/even house number as curb faces, finish one face in numeric order, then finish the opposite face in numeric order.
- Submit that street-sweep order to Route Optimization API as an injected solution constraint with relaxed visit times, so Google keeps the sequence while still returning route geometry and metrics.
- Keep unparseable stops in the route, but place them after the street-sweep sequence so the user can edit their labels/addresses and rerun.

## Implementation Phases

### Phase 1: Next.js App Foundation

- Create the Next.js/React app shell.
- Add environment variable structure for browser and server Google credentials.
- Add dashboard, route creation, and route detail pages.
- Add local persistence or the chosen database layer.

### Phase 2: Import And Validation

- Add manual stop entry.
- Add CSV import for address rows, coordinate rows, and mixed rows.
- Parse and preview imports before saving.
- Validate coordinates locally.
- Geocode address-only rows server-side.
- Store normalized addresses, coordinates, place IDs, validation errors, and duplicate warnings.

### Phase 3: Map-Based Route Builder

- Add Google Maps JavaScript API.
- Add Places autocomplete for manual entry.
- Add marker clustering or viewport-based marker rendering for thousands of stops.
- Add stop search, filtering, selection, and edit controls.
- Show validated and invalid stops separately.

### Phase 4: Large Route Optimization

- Add server-side Route Optimization API integration.
- Model a normal standalone route as one vehicle plus many shipments.
- Add Curbside mode for street-sweep sequencing before Google optimization.
- Add optimization job records.
- Add background execution and polling.
- Use synchronous `optimizeTours` for smaller jobs.
- Use asynchronous `batchOptimizeTours` plus Cloud Storage for large jobs.
- Store optimized visit order, metrics, skipped stops, warnings, and geometry/transition data.

### Phase 5: Review, Manual Editing, And Re-Optimization

- Show the optimized stop order with numbered markers.
- Allow stop disabling, pinning, and manual reorder.
- Allow re-optimization from the edited route state.
- Preserve prior optimization attempts for comparison and rollback.

### Phase 6: Export And Sharing

- Export ordered stops as CSV.
- Export a printable PDF.
- Add optional GPX/KML export if needed.
- Save export history.

### Phase 7: Production Hardening

- Split Google credentials into browser and server credentials.
- Add rate limits and quota-aware job controls.
- Add cost guardrails before running large optimizations.
- Add caching for geocoding and optimization results.
- Add robust failure handling for invalid rows, skipped stops, timeouts, and infeasible routes.

## Operational Notes

- Restrict browser API keys by domain and API type.
- Keep server credentials out of frontend code.
- Use a service account for Cloud Storage and large Route Optimization jobs when using asynchronous batch optimization.
- Cache geocoded addresses and optimization results to control cost.
- Store Google place IDs and coordinates to avoid repeated geocoding.
- Set daily/monthly Google Cloud quota alerts before production.
- Render 5,000 stops with clustering or viewport rendering; do not render thousands of heavyweight marker components at once.
- Validate with small jobs first before submitting expensive large jobs.
- Keep saved routes, stop order, imports, and exports in the app database, not in Google.

## Cost Planning

For one 5,000-stop optimization, Route Optimization API treats each stop as a shipment. Ten 5,000-stop optimizations equals about 50,000 shipment events before caching or reruns.

The biggest cost drivers are:

- Route Optimization API shipment count.
- Geocoding API calls for address-only imports.
- Places autocomplete requests during manual entry.
- Dynamic map loads from user sessions.

For cost control:

- Prefer coordinates when available.
- Cache geocoding results.
- Warn before running a 5,000-stop optimization.
- Save and reuse completed optimization results.
- Avoid repeatedly geocoding the same import.

## Open Questions

- Should the default route be round trip, or should ending location be optional?
- Should users be allowed to pin specific stops to fixed positions before optimization?
- What database should back the local Next.js app during development and production?
