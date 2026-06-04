import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/google-auth";
import type { OptimizedPinsRoute, PinStop } from "@/lib/types";

type OptimizeBody = {
  stops?: PinStop[];
};

type GoogleOptimizeResponse = {
  routes?: Array<{
    visits?: Array<{
      shipmentIndex?: number;
      shipmentLabel?: string;
    }>;
    metrics?: {
      travelDistanceMeters?: number;
      travelDuration?: string;
      totalDuration?: string;
    };
  }>;
  metrics?: {
    aggregatedRouteMetrics?: {
      travelDistanceMeters?: number;
      travelDuration?: string;
      totalDuration?: string;
    };
  };
  skippedShipments?: Array<{
    index?: number;
    label?: string;
  }>;
};

function parseGoogleDuration(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const match = value.match(/^(\d+(?:\.\d+)?)s$/);

  return match ? Math.round(Number(match[1])) : 0;
}

function toGoogleTimestamp(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getCoordinateStops(stops: PinStop[]) {
  return stops.filter(
    (
      stop,
    ): stop is PinStop & { latitude: number; longitude: number } =>
      stop.status === "ok" &&
      Number.isFinite(stop.latitude) &&
      Number.isFinite(stop.longitude),
  );
}

export async function POST(request: Request) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const body = (await request.json()) as OptimizeBody;
  const coordinateStops = getCoordinateStops(body.stops ?? []);
  const start = coordinateStops[0];
  const shipmentStops = coordinateStops.slice(1);

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing GOOGLE_CLOUD_PROJECT_ID" },
      { status: 500 },
    );
  }

  if (!start || shipmentStops.length < 1) {
    return NextResponse.json(
      { error: "At least two mapped stops are required" },
      { status: 400 },
    );
  }

  const payload = {
    timeout: "20s",
    solvingMode: "DEFAULT_SOLVE",
    searchMode: "CONSUME_ALL_AVAILABLE_TIME",
    populatePolylines: false,
    populateTransitionPolylines: false,
    model: {
      shipments: shipmentStops.map((stop) => ({
        label: stop.id,
        deliveries: [
          {
            arrivalWaypoint: {
              location: {
                latLng: {
                  latitude: stop.latitude,
                  longitude: stop.longitude,
                },
              },
            },
          },
        ],
      })),
      vehicles: [
        {
          label: "pins-route",
          startWaypoint: {
            location: {
              latLng: {
                latitude: start.latitude,
                longitude: start.longitude,
              },
            },
          },
          costPerKilometer: 1,
          costPerHour: 30,
        },
      ],
      globalStartTime: toGoogleTimestamp(
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      ),
      globalEndTime: toGoogleTimestamp(
        new Date(Date.now() + 48 * 60 * 60 * 1000),
      ),
    },
  };

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
  const data = (await response.json()) as GoogleOptimizeResponse & {
    error?: unknown;
  };

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  const route = data.routes?.[0];
  const visitStopIds =
    route?.visits
      ?.map((visit) => {
        if (visit.shipmentLabel) {
          return visit.shipmentLabel;
        }

        return shipmentStops[visit.shipmentIndex ?? -1]?.id;
      })
      .filter((stopId): stopId is string => Boolean(stopId)) ?? [];
  const seen = new Set([start.id, ...visitStopIds]);
  const missingStopIds = shipmentStops
    .filter((stop) => !seen.has(stop.id))
    .map((stop) => stop.id);
  const skippedStopIds =
    data.skippedShipments
      ?.map((shipment) => shipment.label ?? shipmentStops[shipment.index ?? -1]?.id)
      .filter((stopId): stopId is string => Boolean(stopId)) ?? [];
  const metrics = route?.metrics ?? data.metrics?.aggregatedRouteMetrics;
  const optimizedRoute: OptimizedPinsRoute = {
    orderedStopIds: [start.id, ...visitStopIds, ...missingStopIds],
    distanceMeters: metrics?.travelDistanceMeters ?? 0,
    durationSeconds: parseGoogleDuration(
      metrics?.travelDuration ?? metrics?.totalDuration,
    ),
    skippedStopIds,
  };

  return NextResponse.json(optimizedRoute);
}
