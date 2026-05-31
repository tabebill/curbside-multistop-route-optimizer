import { readFileSync } from "node:fs";
import type {
  CoordinateStop,
  EndMode,
  GeocodeResult,
  OptimizedRoute,
} from "@/lib/route-types";

type GeocodeResponse = {
  results?: GeocodeResult[];
  error?: string;
};

type OptimizeError = {
  error?: string;
  message?: string;
};

function isOptimizedRoute(value: OptimizedRoute | OptimizeError): value is OptimizedRoute {
  return Array.isArray((value as OptimizedRoute).visitOrder);
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

const baseUrl = process.env.ROUTE_SAMPLE_BASE_URL ?? "http://localhost:3000";
const sampleFile = process.env.ROUTE_SAMPLE_FILE ?? "sample-addresses.txt";
const shuffleCount = Math.max(
  1,
  Math.round(Number(process.env.ROUTE_SAMPLE_SHUFFLES ?? 8)),
);
const maxSuspiciousJumps = Number(
  process.env.ROUTE_SAMPLE_MAX_SUSPICIOUS_JUMPS ?? 0,
);
const maxStreetFaceReentries = Number(
  process.env.ROUTE_SAMPLE_MAX_STREET_FACE_REENTRIES ?? 0,
);
const maxStreetFaceBacktracks = Number(
  process.env.ROUTE_SAMPLE_MAX_STREET_FACE_BACKTRACKS ?? 0,
);
const minNearestNeighborMatchRate = Number(
  process.env.ROUTE_SAMPLE_MIN_NEAREST_MATCH_RATE ?? 0.9,
);
const endMode = (process.env.ROUTE_SAMPLE_END_MODE ?? "last_stop") as EndMode;
const sampleLimit = Number(process.env.ROUTE_SAMPLE_LIMIT ?? 0);
const addresses = readFileSync(sampleFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .slice(0, Number.isFinite(sampleLimit) && sampleLimit > 0 ? sampleLimit : undefined);

async function postJson<T>(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function geocodeAddresses() {
  const results: GeocodeResult[] = [];

  for (let index = 0; index < addresses.length; index += 25) {
    const chunk = addresses.slice(index, index + 25);
    const data = await postJson<GeocodeResponse>("/api/geocode", {
      addresses: chunk,
      acceptGoogleCandidate: true,
    });

    results.push(...(data.results ?? []));
  }

  return results;
}

async function optimizeStops(
  stops: CoordinateStop[],
  seed: number,
  startStopId: string | undefined,
  endStopId: string | undefined,
) {
  const route = await postJson<OptimizedRoute | OptimizeError>(
    "/api/route-optimization/optimize",
    {
      stops,
      startStopId,
      endMode,
      endStopId: endMode === "selected_stop" ? endStopId : undefined,
      routeOptimizationMode: "google_optimized",
    },
  );

  if (!isOptimizedRoute(route)) {
    throw new Error(`seed ${seed}: ${JSON.stringify(route)}`);
  }

  return route;
}

async function main() {
  const geocoded = await geocodeAddresses();
  const failed = geocoded.filter((result) => result.status !== "ok");
  const stops = geocoded
    .filter(
      (
        result,
      ): result is GeocodeResult & { latitude: number; longitude: number } =>
        result.status === "ok" &&
        Number.isFinite(result.latitude) &&
        Number.isFinite(result.longitude),
    )
    .map((result, index) => ({
      id: String(index + 1),
      label: result.normalizedAddress ?? result.input,
      latitude: result.latitude,
      longitude: result.longitude,
    }));

  if (failed.length || stops.length !== addresses.length) {
    console.error(
      JSON.stringify(
        {
          sampleFile,
          addressCount: addresses.length,
          geocodedStops: stops.length,
          failedGeocodes: failed.length,
          failures: failed.slice(0, 10),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const startStopId = process.env.ROUTE_SAMPLE_START_STOP_ID ?? stops[0]?.id;
  const endStopId = process.env.ROUTE_SAMPLE_END_STOP_ID ?? stops.at(-1)?.id;
  const results = [];

  for (let seed = 1; seed <= shuffleCount; seed += 1) {
    const shuffled = shuffleStops(stops, seed);
    const route = await optimizeStops(shuffled, seed, startStopId, endStopId);
    const orderedStopIds = route.visitOrder.map((visit) => visit.stopId);
    const suspiciousJumps = route.qualityDiagnostics?.suspiciousJumpCount ?? 0;
    const streetFaceReentries =
      route.qualityDiagnostics?.streetFaceReentryCount ?? 0;
    const streetFaceBacktracks =
      route.qualityDiagnostics?.streetFaceBacktrackCount ?? 0;
    const nearestNeighborMatchRate =
      route.qualityDiagnostics?.nearestNeighborMatchRate ?? 0;
    const uniqueVisits = new Set(orderedStopIds).size;
    const result = {
      seed,
      visitCount: route.visitOrder.length,
      uniqueVisits,
      firstStopId: orderedStopIds[0],
      lastStopId: orderedStopIds.at(-1),
      suspiciousJumps,
      streetFaceReentries,
      streetFaceBacktracks,
      nearestNeighborMatchRate,
      nearestNeighborMissCount:
        route.qualityDiagnostics?.nearestNeighborMissCount ?? 0,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      firstTen: orderedStopIds.slice(0, 10),
      lastTen: orderedStopIds.slice(-10),
    };

    results.push(result);

    if (route.visitOrder.length !== stops.length) {
      console.error(`seed ${seed}: optimized route is missing visits.`);
      process.exitCode = 1;
    }

    if (uniqueVisits !== route.visitOrder.length) {
      console.error(`seed ${seed}: optimized route contains duplicate visits.`);
      process.exitCode = 1;
    }

    if (orderedStopIds[0] !== startStopId) {
      console.error(`seed ${seed}: optimized route does not start at ${startStopId}.`);
      process.exitCode = 1;
    }

    if (endMode === "selected_stop" && orderedStopIds.at(-1) !== endStopId) {
      console.error(`seed ${seed}: optimized route does not end at ${endStopId}.`);
      process.exitCode = 1;
    }

    if (suspiciousJumps > maxSuspiciousJumps) {
      console.error(`seed ${seed}: suspicious jump count exceeded threshold.`);
      process.exitCode = 1;
    }

    if (streetFaceReentries > maxStreetFaceReentries) {
      console.error(`seed ${seed}: street-face reentry count exceeded threshold.`);
      process.exitCode = 1;
    }

    if (streetFaceBacktracks > maxStreetFaceBacktracks) {
      console.error(`seed ${seed}: street-face backtrack count exceeded threshold.`);
      process.exitCode = 1;
    }

    if (nearestNeighborMatchRate < minNearestNeighborMatchRate) {
      console.error(`seed ${seed}: nearest-neighbor continuity fell below threshold.`);
      process.exitCode = 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        sampleFile,
        addressCount: addresses.length,
        geocodedStops: stops.length,
        shuffleCount,
        maxSuspiciousJumps,
        maxStreetFaceReentries,
        maxStreetFaceBacktracks,
        minNearestNeighborMatchRate,
        startStopId,
        endMode,
        endStopId: endMode === "selected_stop" ? endStopId : undefined,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
