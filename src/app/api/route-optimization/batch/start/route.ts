import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/google-auth";
import { getRouteOptimizationBucket } from "@/lib/google-storage";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRateLimitKey,
} from "@/lib/rate-limit";
import {
  countRouteStops,
  filterValidCoordinateStops,
  maxRouteStops,
  prepareOptimizeToursRequest,
} from "@/lib/route-optimization";
import type {
  CoordinateStop,
  EndMode,
} from "@/lib/route-types";

type BatchStartBody = {
  stops?: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
};

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getRateLimitKey(request, "route-batch-start"), {
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many batch optimization requests. Try again shortly." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const bucketName = process.env.GOOGLE_ROUTE_OPTIMIZATION_BUCKET;
  const body = (await request.json()) as BatchStartBody;
  const stops = filterValidCoordinateStops(body.stops ?? []);
  const routeStopCount = countRouteStops(stops);

  if (!projectId || !bucketName) {
    return NextResponse.json(
      { error: "Missing Google Cloud project or route optimization bucket" },
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

  const jobId = `route-${Date.now()}-${crypto.randomUUID()}`;
  const inputObject = `route-optimization/${jobId}/request.json`;
  const outputPrefix = `route-optimization/${jobId}/output`;
  const inputUri = `gs://${bucketName}/${inputObject}`;
  const outputUri = `gs://${bucketName}/${outputPrefix}`;
  const { payload } = prepareOptimizeToursRequest({
    stops,
    startStopId: body.startStopId,
    endMode: body.endMode,
    endStopId: body.endStopId,
    curbsideRouting: body.curbsideRouting,
  });

  await getRouteOptimizationBucket()
    .file(inputObject)
    .save(JSON.stringify(payload), {
      contentType: "application/json",
      resumable: false,
    });

  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://routeoptimization.googleapis.com/v1/projects/${projectId}:batchOptimizeTours`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        modelConfigs: [
          {
            displayName: jobId,
            inputConfig: {
              dataFormat: "JSON",
              gcsSource: { uri: inputUri },
            },
            outputConfig: {
              dataFormat: "JSON",
              gcsDestination: { uri: outputUri },
            },
          },
        ],
      }),
      cache: "no-store",
    },
  );
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  return NextResponse.json(
    {
      jobId,
      operationName: data.name,
      inputUri,
      outputUri,
      outputPrefix,
      status: "submitted",
    },
    { headers: getRateLimitHeaders(rateLimit) },
  );
}
