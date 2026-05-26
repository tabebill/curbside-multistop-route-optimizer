import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRateLimitKey,
} from "@/lib/rate-limit";
import { getGoogleAccessToken } from "@/lib/google-auth";
import {
  buildOptimizeToursPayload,
  countRouteStops,
  filterValidCoordinateStops,
  maxRouteStops,
} from "@/lib/route-optimization";
import type {
  CoordinateStop,
  EndMode,
} from "@/lib/route-types";

type ValidateBody = {
  stops?: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
};

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getRateLimitKey(request, "route-validate"), {
    limit: 40,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many validation requests. Try again shortly." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const body = (await request.json()) as ValidateBody;
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

  const payload = buildOptimizeToursPayload({
    stops,
    startStopId: body.startStopId,
    endMode: body.endMode,
    endStopId: body.endStopId,
    curbsideRouting: body.curbsideRouting,
    validateOnly: true,
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

  return NextResponse.json({
    validatedStops: routeStopCount,
    validationErrors: data.validationErrors ?? [],
  }, { headers: getRateLimitHeaders(rateLimit) });
}
