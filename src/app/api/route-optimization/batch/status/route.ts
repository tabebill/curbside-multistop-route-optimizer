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
  normalizeOptimizeToursResponseWithQualityFallback,
  prepareOptimizeToursRequest,
} from "@/lib/route-optimization";
import type {
  CoordinateStop,
  EndMode,
  RouteOptimizationMode,
} from "@/lib/route-types";

type BatchStatusBody = {
  operationName?: string;
  outputPrefix?: string;
  stops?: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
  routeOptimizationMode?: RouteOptimizationMode;
};

type OperationResponse = {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function unwrapOptimizeResponse(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.responses)) {
    return record.responses[0];
  }

  if (Array.isArray(record.optimizeToursResponses)) {
    return record.optimizeToursResponses[0];
  }

  return value;
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getRateLimitKey(request, "route-batch-status"), {
    limit: 180,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many batch status requests. Try again shortly." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const body = (await request.json()) as BatchStatusBody;
  const operationName = body.operationName?.trim();
  const outputPrefix = body.outputPrefix?.trim();
  const stops = filterValidCoordinateStops(body.stops ?? []);
  const routeStopCount = countRouteStops(stops);

  if (!operationName || !outputPrefix) {
    return NextResponse.json(
      { error: "Missing operationName or outputPrefix" },
      { status: 400 },
    );
  }

  if (routeStopCount > maxRouteStops) {
    return NextResponse.json(
      { error: `Route optimization is limited to ${maxRouteStops.toLocaleString()} valid stops` },
      { status: 400 },
    );
  }

  const accessToken = await getGoogleAccessToken();
  const operationResponse = await fetch(
    `https://routeoptimization.googleapis.com/v1/${operationName}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  const operation = (await operationResponse.json()) as OperationResponse;

  if (!operationResponse.ok) {
    return NextResponse.json(operation, { status: operationResponse.status });
  }

  if (operation.error) {
    return NextResponse.json({
      status: "failed",
      operationName,
      error: operation.error,
    });
  }

  if (!operation.done) {
    return NextResponse.json({
      status: "running",
      operationName,
    });
  }

  const [files] = await getRouteOptimizationBucket().getFiles({
    prefix: outputPrefix,
  });
  const resultFile = files.find((file) => !file.name.endsWith("/"));

  if (!resultFile) {
    return NextResponse.json({
      status: "running",
      operationName,
      message: "Operation is done, waiting for Cloud Storage output",
    });
  }

  const [contents] = await resultFile.download();
  const raw = JSON.parse(contents.toString("utf8"));
  const optimizeResponse = unwrapOptimizeResponse(raw);
  const { shipmentStops, start, end } = prepareOptimizeToursRequest({
    stops,
    startStopId: body.startStopId,
    endMode: body.endMode,
    endStopId: body.endStopId,
    curbsideRouting: body.curbsideRouting,
    routeOptimizationMode: body.routeOptimizationMode,
  });

  return NextResponse.json(
    {
      status: "completed",
      operationName,
      outputObject: resultFile.name,
      route: {
        ...normalizeOptimizeToursResponseWithQualityFallback(optimizeResponse, shipmentStops, {
          start,
          end,
        }),
        mode: "async",
        operationName,
      },
    },
    { headers: getRateLimitHeaders(rateLimit) },
  );
}
