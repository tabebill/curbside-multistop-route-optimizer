import type {
  CoordinateStop,
  EndMode,
  OptimizedRoute,
} from "@/lib/route-types";
import { currentLocationStopId } from "@/lib/route-types";

type OptimizeRequestOptions = {
  stops: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
  validateOnly?: boolean;
};

export const maxRouteStops = 5000;

type ParsedStreetStop = {
  stop: CoordinateStop;
  houseNumber: number;
  streetKey: string;
  side: "even" | "odd";
};

type GoogleVisit = {
  shipmentIndex?: number;
  shipmentLabel?: string;
  startTime?: string;
};

type GoogleOptimizeResponse = {
  routes?: Array<{
    visits?: GoogleVisit[];
    routePolyline?: {
      points?: string;
    };
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
    skippedMandatoryShipmentCount?: number;
  };
  skippedShipments?: unknown[];
  validationErrors?: unknown[];
};

function isValidCoordinateStop(stop: CoordinateStop) {
  return (
    stop.id &&
    Number.isFinite(stop.latitude) &&
    Number.isFinite(stop.longitude) &&
    stop.latitude >= -90 &&
    stop.latitude <= 90 &&
    stop.longitude >= -180 &&
    stop.longitude <= 180
  );
}

export function filterValidCoordinateStops(stops: CoordinateStop[]) {
  return stops.filter(isValidCoordinateStop);
}

export function countRouteStops(stops: CoordinateStop[]) {
  return stops.filter((stop) => stop.id !== currentLocationStopId).length;
}

export function parseGoogleDuration(duration?: string) {
  if (!duration) {
    return 0;
  }

  const seconds = Number(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}

function getStopById(stops: CoordinateStop[], stopId: string | undefined) {
  if (!stopId) {
    return undefined;
  }

  return stops.find((stop) => stop.id === stopId);
}

function getRouteEndpoints({
  stops,
  startStopId,
  endMode = "round_trip",
  endStopId,
}: Pick<OptimizeRequestOptions, "stops" | "startStopId" | "endMode" | "endStopId">) {
  const start = getStopById(stops, startStopId) ?? stops[0];
  const end =
    endMode === "round_trip"
      ? start
      : endMode === "selected_stop"
        ? getStopById(stops, endStopId) ?? stops.at(-1)
        : stops.at(-1);

  return { start, end: end ?? start };
}

function getShipmentStops(
  stops: CoordinateStop[],
  start: CoordinateStop,
  end: CoordinateStop,
) {
  const fixedStopIds = new Set([start.id, end.id]);
  const shipmentStops = stops.filter((stop) => !fixedStopIds.has(stop.id));

  if (!shipmentStops.length && start.id !== end.id) {
    return [end];
  }

  return shipmentStops;
}

function getVehicleCosts() {
  return { costPerHour: 1, costPerKilometer: 0.25 };
}

function getRouteWindowHours(shipmentCount: number) {
  return Math.max(12, Math.ceil((shipmentCount + 1) / 25));
}

function normalizeStreetToken(token: string) {
  const upper = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ordinal = upper.match(/^(\d+)(ST|ND|RD|TH)$/);

  if (ordinal) {
    return ordinal[1];
  }

  const aliases = new Map([
    ["STREET", "ST"],
    ["STR", "ST"],
    ["PLACE", "PL"],
    ["AVENUE", "AVE"],
    ["BOULEVARD", "BLVD"],
    ["DRIVE", "DR"],
    ["ROAD", "RD"],
    ["LANE", "LN"],
    ["COURT", "CT"],
    ["CIRCLE", "CIR"],
    ["PARKWAY", "PKWY"],
    ["HIGHWAY", "HWY"],
    ["NORTH", "N"],
    ["SOUTH", "S"],
    ["EAST", "E"],
    ["WEST", "W"],
  ]);

  return aliases.get(upper) ?? upper;
}

function parseStreetStop(stop: CoordinateStop): ParsedStreetStop | undefined {
  const match = stop.label.match(/^\s*(\d+)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const houseNumber = Number(match[1]);

  if (!Number.isFinite(houseNumber)) {
    return undefined;
  }

  const tokens = match[2]
    .split(/[\s,]+/)
    .map(normalizeStreetToken)
    .filter(Boolean);
  const streetTypes = new Set([
    "ST",
    "PL",
    "AVE",
    "BLVD",
    "DR",
    "RD",
    "LN",
    "CT",
    "CIR",
    "WAY",
    "PKWY",
    "HWY",
    "TER",
    "TRL",
  ]);
  const directions = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
  const streetTypeIndex = tokens.findIndex((token) => streetTypes.has(token));

  if (streetTypeIndex < 0) {
    return undefined;
  }

  const streetTokens = tokens.slice(0, streetTypeIndex + 1);
  const suffixDirection = tokens[streetTypeIndex + 1];

  if (suffixDirection && directions.has(suffixDirection)) {
    streetTokens.push(suffixDirection);
  }

  return {
    stop,
    houseNumber,
    streetKey: streetTokens.join(" "),
    side: houseNumber % 2 === 0 ? "even" : "odd",
  };
}

function getDistance(
  from: Pick<CoordinateStop, "latitude" | "longitude"> | undefined,
  to: Pick<CoordinateStop, "latitude" | "longitude"> | undefined,
) {
  if (!from || !to) {
    return 0;
  }

  const lat = from.latitude - to.latitude;
  const lng = from.longitude - to.longitude;

  return lat * lat + lng * lng;
}

function scoreOrder(
  ordered: CoordinateStop[],
  start: CoordinateStop | undefined,
) {
  if (!ordered.length) {
    return 0;
  }

  return ordered.reduce((score, stop, index) => {
    const previous = index === 0 ? start : ordered[index - 1];

    return score + getDistance(previous, stop);
  }, 0);
}

function orderStreetFace(
  stops: ParsedStreetStop[],
  direction: "asc" | "desc",
) {
  return [...stops]
    .sort((a, b) =>
      direction === "asc"
        ? a.houseNumber - b.houseNumber
        : b.houseNumber - a.houseNumber,
    )
    .map((item) => item.stop);
}

function orderStreetGroup(
  stops: ParsedStreetStop[],
  start: CoordinateStop | undefined,
) {
  const even = stops.filter((stop) => stop.side === "even");
  const odd = stops.filter((stop) => stop.side === "odd");
  const candidates: CoordinateStop[][] = [];

  if (even.length && odd.length) {
    candidates.push([
      ...orderStreetFace(even, "asc"),
      ...orderStreetFace(odd, "desc"),
    ]);
    candidates.push([
      ...orderStreetFace(even, "desc"),
      ...orderStreetFace(odd, "asc"),
    ]);
    candidates.push([
      ...orderStreetFace(odd, "asc"),
      ...orderStreetFace(even, "desc"),
    ]);
    candidates.push([
      ...orderStreetFace(odd, "desc"),
      ...orderStreetFace(even, "asc"),
    ]);
  } else {
    const side = even.length ? even : odd;

    candidates.push(orderStreetFace(side, "asc"));
    candidates.push(orderStreetFace(side, "desc"));
  }

  return candidates.reduce((best, candidate) =>
    scoreOrder(candidate, start) < scoreOrder(best, start) ? candidate : best,
  );
}

function getCentroid(stops: ParsedStreetStop[]) {
  return stops.reduce(
    (center, item) => ({
      latitude: center.latitude + item.stop.latitude / stops.length,
      longitude: center.longitude + item.stop.longitude / stops.length,
    }),
    { latitude: 0, longitude: 0 },
  );
}

function orderCurbsideStops(
  stops: CoordinateStop[],
  start: CoordinateStop | undefined,
) {
  const parsedGroups = new Map<string, ParsedStreetStop[]>();
  const unparsed: CoordinateStop[] = [];

  for (const stop of stops) {
    const parsed = parseStreetStop(stop);

    if (!parsed) {
      unparsed.push(stop);
      continue;
    }

    parsedGroups.set(parsed.streetKey, [
      ...(parsedGroups.get(parsed.streetKey) ?? []),
      parsed,
    ]);
  }

  const groups = [...parsedGroups.values()];
  const ordered: CoordinateStop[] = [];
  let cursor = start;

  while (groups.length) {
    const nextGroupIndex = groups.reduce((bestIndex, group, index) => {
      const best = groups[bestIndex];

      return getDistance(cursor, getCentroid(group)) <
        getDistance(cursor, getCentroid(best))
        ? index
        : bestIndex;
    }, 0);
    const [group] = groups.splice(nextGroupIndex, 1);
    const orderedGroup = orderStreetGroup(group, cursor);

    ordered.push(...orderedGroup);
    cursor = orderedGroup.at(-1) ?? cursor;
  }

  return [...ordered, ...unparsed];
}

function getWaypoint(stop: CoordinateStop, curbsideRouting: boolean | undefined) {
  return {
    ...(curbsideRouting ? { sideOfRoad: true } : {}),
    location: {
      latLng: {
        latitude: stop.latitude,
        longitude: stop.longitude,
      },
    },
  };
}

function getInjectedSolutionConstraint(
  shipmentStops: CoordinateStop[],
  startTime: Date,
  endTime: Date,
) {
  if (!shipmentStops.length) {
    return undefined;
  }

  return {
    routes: [
      {
        vehicleIndex: 0,
        vehicleStartTime: startTime.toISOString(),
        vehicleEndTime: endTime.toISOString(),
        visits: shipmentStops.map((_, index) => ({
          shipmentIndex: index,
          isPickup: false,
          visitRequestIndex: 0,
          startTime: new Date(startTime.getTime() + (index + 1) * 1000).toISOString(),
        })),
      },
    ],
    constraintRelaxations: [
      {
        vehicleIndices: [0],
        relaxations: [
          {
            level: "RELAX_VISIT_TIMES_AFTER_THRESHOLD",
            thresholdVisitCount: 0,
          },
        ],
      },
    ],
  };
}

export function prepareOptimizeToursRequest(options: OptimizeRequestOptions) {
  const stops = filterValidCoordinateStops(options.stops);
  const { start, end } = getRouteEndpoints({
    stops,
    startStopId: options.startStopId,
    endMode: options.endMode,
    endStopId: options.endStopId,
  });
  const unorderedShipmentStops = getShipmentStops(stops, start, end);
  const shipmentStops = options.curbsideRouting
    ? orderCurbsideStops(unorderedShipmentStops, start)
    : unorderedShipmentStops;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setUTCHours(12, 0, 0, 0);
  const endTime = new Date(
    tomorrow.getTime() + getRouteWindowHours(shipmentStops.length) * 60 * 60 * 1000,
  );
  const injectedSolutionConstraint = options.curbsideRouting
    ? getInjectedSolutionConstraint(shipmentStops, tomorrow, endTime)
    : undefined;

  const payload = {
    solvingMode: options.validateOnly ? "VALIDATE_ONLY" : "DEFAULT_SOLVE",
    populatePolylines: !options.validateOnly,
    populateTransitionPolylines: !options.validateOnly,
    ...(injectedSolutionConstraint ? { injectedSolutionConstraint } : {}),
    model: {
      shipments: shipmentStops.map((stop) => ({
        label: stop.id,
        deliveries: [
          {
            arrivalWaypoint: getWaypoint(stop, options.curbsideRouting),
          },
        ],
      })),
      vehicles: [
        {
          label: "primary-route",
          startWaypoint: getWaypoint(start, options.curbsideRouting),
          endWaypoint: getWaypoint(end, options.curbsideRouting),
          ...getVehicleCosts(),
        },
      ],
      globalStartTime: tomorrow.toISOString(),
      globalEndTime: endTime.toISOString(),
    },
  };

  return { payload, shipmentStops, start, end };
}

export function buildOptimizeToursPayload(options: OptimizeRequestOptions) {
  return prepareOptimizeToursRequest(options).payload;
}

export function normalizeOptimizeToursResponse(
  rawData: unknown,
  shipmentStops: CoordinateStop[],
  endpoints?: {
    start?: CoordinateStop;
    end?: CoordinateStop;
  },
): OptimizedRoute {
  const data = rawData as GoogleOptimizeResponse;
  const route = data.routes?.[0];
  const routeMetrics = route?.metrics;
  const responseMetrics = data.metrics?.aggregatedRouteMetrics;
  const endIsDistinct =
    endpoints?.start?.id &&
    endpoints.end?.id &&
    endpoints.start.id !== endpoints.end.id;
  const endIsShipment = Boolean(
    endIsDistinct &&
      endpoints?.end?.id &&
      shipmentStops.some((stop) => stop.id === endpoints.end?.id),
  );
  const middleVisits =
    route?.visits?.map((visit, index) => {
      const shipmentIndex = visit.shipmentIndex ?? 0;
      const stop = shipmentStops[shipmentIndex];
      const isEndpointVisit = endIsShipment && stop?.id === endpoints?.end?.id;

      return {
        stopId: visit.shipmentLabel || stop?.id || `shipment-${shipmentIndex}`,
        label: stop?.label || visit.shipmentLabel || `Stop ${index + 1}`,
        sequence: index + 1,
        shipmentIndex,
        startTime: visit.startTime,
        role: isEndpointVisit ? ("end" as const) : ("stop" as const),
      };
    }) ?? [];
  const visitOrder = [
    ...(endpoints?.start
      ? [
          {
            stopId: endpoints.start.id,
            label: endpoints.start.label,
            sequence: 1,
            shipmentIndex: -1,
            role: "start" as const,
          },
        ]
      : []),
    ...middleVisits.map((visit, index) => ({
      ...visit,
      sequence: index + (endpoints?.start ? 2 : 1),
    })),
    ...(endpoints?.end && endIsDistinct && !endIsShipment
      ? [
          {
            stopId: endpoints.end.id,
            label: endpoints.end.label,
            sequence:
              middleVisits.length + (endpoints?.start ? 2 : 1),
            shipmentIndex: -1,
            role: "end" as const,
          },
        ]
      : []),
  ];

  return {
    visitOrder,
    distanceMeters:
      routeMetrics?.travelDistanceMeters ??
      responseMetrics?.travelDistanceMeters ??
      0,
    durationSeconds: parseGoogleDuration(
      routeMetrics?.travelDuration ??
        routeMetrics?.totalDuration ??
        responseMetrics?.travelDuration ??
        responseMetrics?.totalDuration,
    ),
    polyline: route?.routePolyline?.points,
    skippedShipmentCount:
      data.skippedShipments?.length ??
      data.metrics?.skippedMandatoryShipmentCount ??
      0,
    validationErrors: data.validationErrors ?? [],
  };
}
