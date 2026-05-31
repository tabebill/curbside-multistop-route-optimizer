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

function getMinNearestNeighborMatchRate() {
  const value = Number(process.env.ROUTE_BENCHMARK_MIN_NEAREST_MATCH_RATE ?? 0.8);

  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
}

function getMaxLongestLegRatio() {
  const value = Number(process.env.ROUTE_BENCHMARK_MAX_LONGEST_LEG_RATIO ?? 20);

  return Number.isFinite(value) && value > 0 ? value : 20;
}

function getMinLegBaselineMeters() {
  const value = Number(process.env.ROUTE_BENCHMARK_MIN_LEG_BASELINE_METERS ?? 80);

  return Number.isFinite(value) && value > 0 ? value : 80;
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
  const start = ordered[0];
  const end =
    endMode === "selected_stop"
      ? ordered.find((stop) => stop.id === endStopId)
      : endMode === "round_trip"
        ? start
        : undefined;
  const fixedStopIds = new Set([start?.id, end?.id].filter(Boolean));
  const shipmentStops = ordered.filter((stop) => !fixedStopIds.has(stop.id));
  const route = normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
        },
      ],
    },
    shipmentStops,
    { start, end },
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
const minNearestNeighborMatchRate = getMinNearestNeighborMatchRate();
const maxLongestLegRatio = getMaxLongestLegRatio();
const minLegBaselineMeters = getMinLegBaselineMeters();
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
    firstStopId: ordered[0]?.id,
    lastStopId: ordered.at(-1)?.id,
    elapsedMs,
    suspiciousJumps,
    nearestNeighborMatchRate:
      route.qualityDiagnostics?.nearestNeighborMatchRate ?? 0,
    nearestNeighborMissCount:
      route.qualityDiagnostics?.nearestNeighborMissCount ?? 0,
    longestLegMeters: route.qualityDiagnostics?.longestLegMeters ?? 0,
    medianLegMeters: route.qualityDiagnostics?.medianLegMeters ?? 0,
    longestLegRatio: Number(
      (
        (route.qualityDiagnostics?.longestLegMeters ?? 0) /
        Math.max(route.qualityDiagnostics?.medianLegMeters ?? 0, minLegBaselineMeters)
      ).toFixed(2),
    ),
    issues: route.qualityDiagnostics?.issues.slice(0, 5) ?? [],
    firstTen: ordered.slice(0, 10).map((stop) => stop.id),
    lastTen: ordered.slice(-10).map((stop) => stop.id),
  };
});
const result = {
  routeOptimizationMode,
  requestedStops: stopCount,
  maxSuspiciousJumps,
  minNearestNeighborMatchRate,
  maxLongestLegRatio,
  minLegBaselineMeters,
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

  if (run.firstStopId !== startStopId) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: route does not start at ${startStopId}.`,
    );
    process.exitCode = 1;
  }

  if (endMode === "selected_stop" && run.lastStopId !== endStopId) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: route does not end at ${endStopId}.`,
    );
    process.exitCode = 1;
  }

  if (run.suspiciousJumps > maxSuspiciousJumps) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: suspicious jump count exceeded threshold.`,
    );
    process.exitCode = 1;
  }

  if (run.nearestNeighborMatchRate < minNearestNeighborMatchRate) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: nearest-neighbor continuity fell below threshold.`,
    );
    process.exitCode = 1;
  }

  if (
    run.longestLegMeters >
    Math.max(run.medianLegMeters, minLegBaselineMeters) * maxLongestLegRatio
  ) {
    console.error(
      `Route benchmark failed for seed ${run.seed}: longest leg exceeded ${maxLongestLegRatio}x baseline leg.`,
    );
    process.exitCode = 1;
  }
}
