# Recommended Upgrade

This document captures the recommended upgrades needed to make 250-stop routes feel smooth and reliable in `multi-stop-pins`.

## Current Honest Status

The app can currently attempt up to 250 stops, but 250 should be treated as a stress limit, not an effortless production experience yet.

Current flow:

1. Import or paste stops.
2. Geocode addresses.
3. Preview numbered pins on Google Maps.
4. Optimize stop order with Google Route Optimization API.
5. Draw motorable route lines with Google Directions chunks.
6. Navigate through the ordered route in the app.

The main bottlenecks are geocoding speed, optimization timeout, route-line redraws, and navigation rendering work for large routes.

## Upgrade Goal

Make 250 stops feel routine by improving:

- Feedback: the user always knows what the app is doing.
- Latency: long work is parallelized or streamed.
- Reliability: fewer full-route redraws and fewer repeated API calls.
- Navigation: the navigation screen handles only the current route segment instead of trying to do everything at once.

## 1. Raise Route Optimization Timeout

The current optimization endpoint uses a request-body timeout. For larger routes, raise it from the current short timeout to 60 seconds.

Recommended request body:

```json
{
  "timeout": "60s",
  "searchMode": "CONSUME_ALL_AVAILABLE_TIME"
}
```

For REST requests, also send:

```http
X-Server-Timeout: 60
```

Reason:

Google's Route Optimization API has both a request-body timeout and a request deadline. For REST, the default blocking deadline can be shorter than desired unless `X-Server-Timeout` is set.

Implementation target:

- `src/app/api/optimize/route.ts`

Recommended later enhancement:

- For very large routes, add an async/batch optimization path instead of relying only on a blocking request.

Source:

- https://developers.google.com/maps/documentation/route-optimization/timeouts

## 2. Improve Geocoding

Current risk:

Geocoding is done one address at a time. At 250 stops, this can feel slow.

Recommended upgrade:

- Geocode in controlled parallel batches.
- Start with 5 concurrent requests.
- Increase to 10 only if quota and reliability look good.
- Show progress while geocoding.
- Cache geocoded results by normalized address.
- Allow partial success if some addresses fail.

Suggested UI copy:

```text
Geocoding 84 / 250
```

Suggested cache key:

```ts
address.trim().toUpperCase()
```

Implementation target:

- `src/app/api/geocode/route.ts`
- `src/components/pin-workspace.tsx`

Expected result:

Previewing 250 stops should feel like a visible process, not a frozen screen.

Source:

- https://developers.google.com/maps/documentation/geocoding/usage-and-billing

## 3. Add A Unified Progress State

Current risk:

Large route operations can take time, and the user only sees broad button loading text.

Recommended upgrade:

Add a single app-level progress state:

```text
Geocoding stops...
Optimizing route...
Drawing route...
Ready to navigate
```

Better version:

```text
Geocoding 84 / 250
Optimizing 250 stops
Drawing route segment 4 / 11
Ready to navigate
```

Implementation target:

- `src/components/pin-workspace.tsx`
- `src/components/pin-map.tsx`
- `src/components/navigation-modal.tsx`

Expected result:

Even when 250 stops takes time, it feels controlled and professional.

## 4. Draw Route Lines Progressively

Current behavior:

Route lines are drawn with Google Directions in chunks of up to 25 stops.

At 250 stops, this means roughly 11 Directions requests.

Recommended upgrade:

- Draw chunks progressively.
- Show progress while drawing.
- Cache chunk results in memory.
- Avoid redrawing chunks that have already been drawn.
- Keep the main map and navigation modal from doing duplicate full-route drawing work.

Suggested UI copy:

```text
Drawing route 4 / 11
```

Implementation target:

- `src/components/pin-map.tsx`
- `src/components/navigation-modal.tsx`

Source:

- https://developers.google.com/maps/documentation/javascript/directions

## 5. Optimize Navigation For Segments

Current risk:

The navigation modal can redraw the whole route. For 250 stops, that is heavier than needed.

Recommended upgrade:

- Main map can show the full route.
- Navigation modal should focus only on the current 25-stop segment.
- Prefetch the next segment quietly.
- When the user reaches a segment boundary, switch to the next segment.

Example:

```text
Segment 1: stops 1-25
Segment 2: stops 25-49
Segment 3: stops 49-73
```

The overlap keeps continuity between segments.

Implementation target:

- `src/components/navigation-modal.tsx`

Expected result:

Navigation stays fast even when the full route has 250 stops.

## 6. Store Direction Steps Per Segment

Current risk:

Navigation instructions are basic. A Google-like experience needs better step data.

Recommended upgrade:

- Store Directions legs and steps per segment.
- Display the next step for the active segment.
- Update the instruction when the user advances stops.
- Later, use GPS proximity to auto-advance steps.

Data to keep:

```ts
{
  segmentIndex: number;
  originStopId: string;
  destinationStopId: string;
  legs: google.maps.DirectionsLeg[];
}
```

Expected result:

The navigation screen becomes more like real turn-by-turn guidance.

## 7. Add Auto-Advance

Current behavior:

The user clicks Next manually.

Recommended upgrade:

- Watch live GPS position.
- If the user is within a small radius of the current stop, offer or perform auto-advance.

Suggested threshold:

```text
30-50 meters
```

Recommended first version:

- Show a button: `Arrived - Next Stop`
- Later, add optional automatic advancement.

Reason:

GPS can be noisy. Manual confirmation is safer for the first production version.

## 8. Add Resilience And Caching

Recommended caches:

- Geocode cache by normalized address.
- Optimization cache by ordered coordinate hash.
- Directions chunk cache by stop-id range.

Recommended cache scope:

- Start with in-memory browser/server caches.
- Later add persistent storage if routes need to survive reloads.

Expected result:

Repeated tests with the same addresses become much faster and cheaper.

## 9. Practical 250-Stop Readiness Checklist

Before calling 250 stops production-ready, verify:

- 250 imported stops do not freeze the browser.
- Geocoding shows progress.
- Geocoding can partially succeed.
- Optimization uses at least a 60-second timeout.
- REST optimization sends `X-Server-Timeout`.
- Route drawing shows progress.
- Route drawing does not redraw all chunks unnecessarily.
- Navigation modal draws only the current segment.
- The app can move through segment boundaries smoothly.
- Failed stops are clearly visible and do not block the valid route.

## Recommended Implementation Order

1. Raise optimization timeout to 60 seconds and add `X-Server-Timeout`.
2. Add progress state for geocoding, optimization, and route drawing.
3. Add controlled parallel geocoding.
4. Add geocode cache.
5. Cache route-line chunks.
6. Make navigation modal segment-based.
7. Store Directions steps per segment.
8. Add arrival confirmation and later auto-advance.

## Bottom Line

Raising the Route Optimization timeout helps, but it is not enough by itself.

To make 250 addresses feel effortless, the app needs smoother geocoding, visible progress, cached route chunks, and segment-based navigation.
