import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/google-auth";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRateLimitKey,
} from "@/lib/rate-limit";
import {
  countRouteStops,
  filterValidCoordinateStops,
  maxRouteStops,
  normalizeOptimizeToursResponseWithQualityFallback,
  prepareOptimizeToursRequest,
} from "@/lib/route-optimization";
import type {
  CoordinateStop,
  EndMode,
  RouteOptimizationMode,
} from "@/lib/route-types";

type OptimizeBody = {
  stops?: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
  routeOptimizationMode?: RouteOptimizationMode;
};

const synchronousStopLimit = 100;
const optimizeCacheTtlMs = 10 * 60 * 1000;
const optimizeCacheVersion = "quality-fallback-v1";
const optimizeCache = new Map<
  string,
  { route: ReturnType<typeof normalizeOptimizeToursResponseWithQualityFallback>; expiresAt: number }
>();

function rememberOptimizedRoute(
  key: string,
  route: ReturnType<typeof normalizeOptimizeToursResponseWithQualityFallback>,
) {
  if (optimizeCache.size > 100) {
    const oldest = optimizeCache.keys().next().value;

    if (oldest) {
      optimizeCache.delete(oldest);
    }
  }

  optimizeCache.set(key, {
    route,
    expiresAt: Date.now() + optimizeCacheTtlMs,
  });
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getRateLimitKey(request, "route-optimize"), {
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many optimization requests. Try again shortly." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const body = (await request.json()) as OptimizeBody;
  const stops = filterValidCoordinateStops(body.stops ?? []);
  const routeStopCount = countRouteStops(stops);

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing GOOGLE_CLOUD_PROJECT_ID" },
      { status: 500 },
    );
  }

  if (stops.length < 2) {
    return NextResponse.json(
      { error: "At least two coordinate-backed stops are required" },
      { status: 400 },
    );
  }

  if (routeStopCount > maxRouteStops) {
    return NextResponse.json(
      { error: `Route optimization is limited to ${maxRouteStops.toLocaleString()} valid stops` },
      { status: 400 },
    );
  }

  if (routeStopCount > synchronousStopLimit) {
    return NextResponse.json(
      {
        error:
          "Synchronous optimization is limited to 100 stops. Use the async batch endpoint for larger jobs.",
      },
      { status: 400 },
    );
  }

  const cacheKey = JSON.stringify({
    version: optimizeCacheVersion,
    stops,
    startStopId: body.startStopId,
    endMode: body.endMode,
    endStopId: body.endStopId,
    curbsideRouting: body.curbsideRouting,
    routeOptimizationMode: body.routeOptimizationMode,
  });
  const cached = optimizeCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { ...cached.route, cached: true },
      { headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const { payload, shipmentStops, start, end } = prepareOptimizeToursRequest({
    stops,
    startStopId: body.startStopId,
    endMode: body.endMode,
    endStopId: body.endStopId,
    curbsideRouting: body.curbsideRouting,
    routeOptimizationMode: body.routeOptimizationMode,
  });
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  const route = normalizeOptimizeToursResponseWithQualityFallback(
    data,
    shipmentStops,
    {
      start,
      end,
    },
    {
      routeOptimizationMode: body.routeOptimizationMode,
    },
  );

  rememberOptimizedRoute(cacheKey, route);

  return NextResponse.json(route, { headers: getRateLimitHeaders(rateLimit) });
}
