import { readFileSync } from "node:fs";
import type { GeocodeResult, OptimizedRoute } from "@/lib/route-types";

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

const baseUrl = process.env.ROUTE_SAMPLE_BASE_URL ?? "http://localhost:3000";
const sampleFile = process.env.ROUTE_SAMPLE_FILE ?? "sample-addresses.txt";
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
const maxLongestLegRatio = Number(
  process.env.ROUTE_SAMPLE_MAX_LONGEST_LEG_RATIO ?? 20,
);
const minLegBaselineMeters = Number(
  process.env.ROUTE_SAMPLE_MIN_LEG_BASELINE_METERS ?? 80,
);
const addresses = readFileSync(sampleFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

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

  if (failed.length) {
    console.error(
      JSON.stringify(
        {
          failedGeocodes: failed.length,
          failures: failed.slice(0, 10),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const route = await postJson<OptimizedRoute | OptimizeError>(
    "/api/route-optimization/optimize",
    {
      stops,
      startStopId: stops[0]?.id,
      endMode: "last_stop",
      routeOptimizationMode: "auto",
    },
  );

  if (!isOptimizedRoute(route)) {
    throw new Error(JSON.stringify(route));
  }

  const orderedStopIds = route.visitOrder.map((visit) => visit.stopId);
  const suspiciousJumps = route.qualityDiagnostics?.suspiciousJumpCount ?? 0;
  const streetFaceReentries =
    route.qualityDiagnostics?.streetFaceReentryCount ?? 0;
  const streetFaceBacktracks =
    route.qualityDiagnostics?.streetFaceBacktrackCount ?? 0;
  const nearestNeighborMatchRate =
    route.qualityDiagnostics?.nearestNeighborMatchRate ?? 0;
  const longestLegMeters = route.qualityDiagnostics?.longestLegMeters ?? 0;
  const medianLegMeters = route.qualityDiagnostics?.medianLegMeters ?? 0;
  const result = {
    sampleFile,
    addressCount: addresses.length,
    geocodedStops: stops.length,
    visitCount: route.visitOrder.length,
    uniqueVisits: new Set(orderedStopIds).size,
    suspiciousJumps,
    maxSuspiciousJumps,
    streetFaceReentries,
    maxStreetFaceReentries,
    streetFaceBacktracks,
    maxStreetFaceBacktracks,
    nearestNeighborMatchRate,
    minNearestNeighborMatchRate,
    longestLegMeters,
    medianLegMeters,
    longestLegRatio:
      medianLegMeters > 0
        ? Number((longestLegMeters / medianLegMeters).toFixed(2))
        : 0,
    baselineLongestLegRatio:
      Math.max(medianLegMeters, minLegBaselineMeters) > 0
        ? Number(
            (
              longestLegMeters /
              Math.max(medianLegMeters, minLegBaselineMeters)
            ).toFixed(2),
          )
        : 0,
    maxLongestLegRatio,
    minLegBaselineMeters,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    qualityDiagnostics: route.qualityDiagnostics,
    firstThirty: orderedStopIds.slice(0, 30),
    lastTen: orderedStopIds.slice(-10),
  };

  console.log(JSON.stringify(result, null, 2));

  if (stops.length !== addresses.length) {
    console.error("Sample verification failed: not every address geocoded to a stop.");
    process.exitCode = 1;
  }

  if (route.visitOrder.length !== stops.length) {
    console.error("Sample verification failed: optimized route is missing visits.");
    process.exitCode = 1;
  }

  if (new Set(orderedStopIds).size !== route.visitOrder.length) {
    console.error("Sample verification failed: optimized route contains duplicate visits.");
    process.exitCode = 1;
  }

  if (suspiciousJumps > maxSuspiciousJumps) {
    console.error("Sample verification failed: suspicious jump count exceeded threshold.");
    process.exitCode = 1;
  }

  if (streetFaceReentries > maxStreetFaceReentries) {
    console.error("Sample verification failed: street-face reentry count exceeded threshold.");
    process.exitCode = 1;
  }

  if (streetFaceBacktracks > maxStreetFaceBacktracks) {
    console.error("Sample verification failed: street-face backtrack count exceeded threshold.");
    process.exitCode = 1;
  }

  if (nearestNeighborMatchRate < minNearestNeighborMatchRate) {
    console.error(
      "Sample verification failed: nearest-neighbor continuity fell below threshold.",
    );
    process.exitCode = 1;
  }

  if (
    longestLegMeters >
    Math.max(medianLegMeters, minLegBaselineMeters) * maxLongestLegRatio
  ) {
    console.error(
      `Sample verification failed: longest leg exceeded ${maxLongestLegRatio}x baseline leg.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
