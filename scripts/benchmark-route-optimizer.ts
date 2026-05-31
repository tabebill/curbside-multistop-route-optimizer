import { performance } from "node:perf_hooks";
import {
  buildLocalOptimizedStopSequenceForTesting,
  normalizeOptimizeToursResponse,
} from "@/lib/route-optimization";
import type { CoordinateStop, EndMode, RouteOptimizationMode } from "@/lib/route-types";

function getStopCount() {
  const value = Number(process.env.ROUTE_BENCHMARK_STOPS ?? 2000);

  return Number.isFinite(value) && value > 1 ? Math.round(value) : 2000;
}

function getMaxSuspiciousJumps() {
  const value = Number(process.env.ROUTE_BENCHMARK_MAX_SUSPICIOUS_JUMPS ?? 0);

  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function getShuffleCount() {
  const value = Number(process.env.ROUTE_BENCHMARK_SHUFFLES ?? 1);

  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function getRouteOptimizationMode(): RouteOptimizationMode {
  const value = process.env.ROUTE_BENCHMARK_MODE;

  return value === "curbside_assisted" || value === "curbside_strict"
    ? value
    : "google_optimized";
}

function getEndMode(): EndMode {
  const value = process.env.ROUTE_BENCHMARK_END_MODE;

  return value === "round_trip" || value === "selected_stop"
    ? value
    : "last_stop";
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

function createSeededRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleStops<T>(items: T[], seed: number) {
  const shuffled = [...items];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const item = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = item;
  }

  return shuffled;
}

function benchmarkStops(
  stops: CoordinateStop[],
  startStopId: string,
  endMode: EndMode,
  endStopId: string,
  routeOptimizationMode: RouteOptimizationMode,
) {
  const startedAt = performance.now();
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId,
    endMode,
    endStopId,
    routeOptimizationMode,
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
  const uniqueStops = new Set(ordered.map((stop) => stop.id)).size;

  return {
    ordered,
    uniqueStops,
    elapsedMs: Math.round(elapsedMs),
    route,
  };
}

const stopCount = getStopCount();
const maxSuspiciousJumps = getMaxSuspiciousJumps();
const routeOptimizationMode = getRouteOptimizationMode();
const endMode = getEndMode();
const shuffleCount = getShuffleCount();
const stops = buildSyntheticStops(stopCount);
const startStopId = stops[0].id;
const endStopId = process.env.ROUTE_BENCHMARK_END_STOP_ID ?? stops.at(-1)!.id;
const runs = Array.from({ length: shuffleCount }, (_, index) => {
  const seed = index + 1;
  const runStops = seed === 1 ? stops : shuffleStops(stops, seed);
  const { ordered, uniqueStops, elapsedMs, route } = benchmarkStops(
    runStops,
    startStopId,
    endMode,
    endStopId,
    routeOptimizationMode,
  );
  const suspiciousJumps = route.qualityDiagnostics?.suspiciousJumpCount ?? 0;

  return {
    seed,
    orderedStops: ordered.length,
    uniqueStops,
    elapsedMs,
    suspiciousJumps,
    longestLegMeters: route.qualityDiagnostics?.longestLegMeters ?? 0,
    medianLegMeters: route.qualityDiagnostics?.medianLegMeters ?? 0,
    issues: route.qualityDiagnostics?.issues.slice(0, 5) ?? [],
    firstTen: ordered.slice(0, 10).map((stop) => stop.id),
    lastTen: ordered.slice(-10).map((stop) => stop.id),
  };
});
const result = {
  routeOptimizationMode,
  requestedStops: stopCount,
  maxSuspiciousJumps,
  shuffleCount,
  startStopId,
  endMode,
  endStopId: endMode === "selected_stop" ? endStopId : undefined,
  runs,
};

console.log(JSON.stringify(result, null, 2));

for (const run of runs) {
  if (run.orderedStops !== stopCount || run.uniqueStops !== stopCount) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: ordered stops are missing or duplicated.`,
    );
    process.exitCode = 1;
  }

  if (run.suspiciousJumps > maxSuspiciousJumps) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: suspicious jump count exceeded threshold.`,
    );
    process.exitCode = 1;
  }
}
