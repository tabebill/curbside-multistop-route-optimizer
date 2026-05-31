import { performance } from "node:perf_hooks";
import {
  buildLocalOptimizedStopSequenceForTesting,
  normalizeOptimizeToursResponse,
} from "@/lib/route-optimization";
import type { CoordinateStop } from "@/lib/route-types";

function getStopCount() {
  const value = Number(process.env.ROUTE_BENCHMARK_STOPS ?? 2000);

  return Number.isFinite(value) && value > 1 ? Math.round(value) : 2000;
}

function buildSyntheticStops(count: number): CoordinateStop[] {
  const columns = Math.ceil(Math.sqrt(count));

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const serpentineColumn = row % 2 ? columns - column - 1 : column;
    const streetNumber = 1000 + index;

    return {
      id: `bench-${index}`,
      label: `${streetNumber} E BENCHMARK ${row} ST TULSA 74103`,
      latitude: 36 + row * 0.00035,
      longitude: -96 + serpentineColumn * 0.00035,
    };
  });
}

const stopCount = getStopCount();
const stops = buildSyntheticStops(stopCount);
const startedAt = performance.now();
const ordered = buildLocalOptimizedStopSequenceForTesting({
  stops,
  startStopId: stops[0].id,
  endMode: "last_stop",
  routeOptimizationMode: "google_optimized",
});
const elapsedMs = performance.now() - startedAt;
const shipmentStops = ordered.slice(1);
const route = normalizeOptimizeToursResponse(
  {
    routes: [
      {
        visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
      },
    ],
  },
  shipmentStops,
  { start: ordered[0] },
);

console.log(
  JSON.stringify(
    {
      requestedStops: stopCount,
      orderedStops: ordered.length,
      uniqueStops: new Set(ordered.map((stop) => stop.id)).size,
      elapsedMs: Math.round(elapsedMs),
      suspiciousJumps: route.qualityDiagnostics?.suspiciousJumpCount ?? 0,
      longestLegMeters: route.qualityDiagnostics?.longestLegMeters ?? 0,
      medianLegMeters: route.qualityDiagnostics?.medianLegMeters ?? 0,
      issues: route.qualityDiagnostics?.issues.slice(0, 5) ?? [],
      firstTen: ordered.slice(0, 10).map((stop) => stop.id),
      lastTen: ordered.slice(-10).map((stop) => stop.id),
    },
    null,
    2,
  ),
);
