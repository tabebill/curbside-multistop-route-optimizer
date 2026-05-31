import type {
  CoordinateStop,
  EndMode,
  OptimizedRoute,
  RouteOptimizationMode,
} from "@/lib/route-types";
import { currentLocationStopId } from "@/lib/route-types";

type OptimizeRequestOptions = {
  stops: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  curbsideRouting?: boolean;
  routeOptimizationMode?: RouteOptimizationMode;
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

type LatLng = {
  latitude: number;
  longitude: number;
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
  endMode = "last_stop",
  endStopId,
}: Pick<OptimizeRequestOptions, "stops" | "startStopId" | "endMode" | "endStopId">) {
  const start = getStopById(stops, startStopId) ?? stops[0];
  const end =
    endMode === "round_trip"
      ? start
      : endMode === "selected_stop"
        ? getStopById(stops, endStopId)
        : undefined;

  return { start, end };
}

function getShipmentStops(
  stops: CoordinateStop[],
  start: CoordinateStop,
  end?: CoordinateStop,
) {
  const fixedStopIds = new Set([start.id, end?.id].filter(Boolean));
  const shipmentStops = stops.filter((stop) => !fixedStopIds.has(stop.id));

  if (end && !shipmentStops.length && start.id !== end.id) {
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

function getRouteOptimizationMode(options: OptimizeRequestOptions) {
  return options.routeOptimizationMode ??
    (options.curbsideRouting ? "curbside_strict" : "google_optimized");
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

function getHaversineMeters(
  from: Pick<CoordinateStop, "latitude" | "longitude"> | undefined,
  to: Pick<CoordinateStop, "latitude" | "longitude"> | undefined,
) {
  if (!from || !to) {
    return 0;
  }

  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeA = toRadians(from.latitude);
  const latitudeB = toRadians(to.latitude);
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function decodePolyline(points: string | undefined) {
  if (!points) {
    return [] satisfies LatLng[];
  }

  const coordinates: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < points.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = points.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;

    do {
      byte = points.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

function getPathMeters(path: LatLng[]) {
  return path.reduce((total, point, index) => {
    if (!index) {
      return total;
    }

    return total + getHaversineMeters(path[index - 1], point);
  }, 0);
}

function getStopSequenceMeters(
  visitOrder: Array<{ stopId: string }>,
  stops: CoordinateStop[],
  endpoints?: {
    start?: CoordinateStop;
    end?: CoordinateStop;
  },
) {
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const path = visitOrder
    .map((visit) =>
      visit.stopId === endpoints?.start?.id
        ? endpoints.start
        : visit.stopId === endpoints?.end?.id
          ? endpoints.end
          : stopById.get(visit.stopId),
    )
    .filter((stop): stop is CoordinateStop => Boolean(stop));

  return getPathMeters(path);
}

function estimateDurationSeconds(distanceMeters: number) {
  const residentialMetersPerSecond = 8.94; // 20 mph, useful fallback for local delivery routes.

  return distanceMeters ? Math.round(distanceMeters / residentialMetersPerSecond) : 0;
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

function scoreRouteMeters(
  ordered: CoordinateStop[],
  start: CoordinateStop | undefined,
  end: CoordinateStop | undefined,
) {
  if (!ordered.length) {
    return end ? getHaversineMeters(start, end) : 0;
  }

  const routeCost = ordered.reduce((score, stop, index) => {
    const previous = index === 0 ? start : ordered[index - 1];

    return score + getHaversineMeters(previous, stop);
  }, 0);

  return routeCost + (end ? getHaversineMeters(ordered.at(-1), end) : 0);
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

function getNearestGroupDistance(
  cursor: CoordinateStop | undefined,
  group: ParsedStreetStop[],
) {
  return group.reduce((nearest, item) => {
    const distance = getDistance(cursor, item.stop);

    return distance < nearest ? distance : nearest;
  }, Number.POSITIVE_INFINITY);
}

function orderNearestStops(
  stops: CoordinateStop[],
  start: CoordinateStop | undefined,
) {
  const remaining = [...stops];
  const ordered: CoordinateStop[] = [];
  let cursor = start;

  while (remaining.length) {
    const nextIndex = remaining.reduce((bestIndex, stop, index) =>
      getDistance(cursor, stop) < getDistance(cursor, remaining[bestIndex])
        ? index
        : bestIndex,
    0);
    const [nextStop] = remaining.splice(nextIndex, 1);

    ordered.push(nextStop);
    cursor = nextStop;
  }

  return ordered;
}

function getAnchorStops(stops: CoordinateStop[]) {
  if (!stops.length) {
    return [];
  }

  const anchors = [
    stops.reduce((best, stop) =>
      stop.latitude < best.latitude ? stop : best,
    ),
    stops.reduce((best, stop) =>
      stop.latitude > best.latitude ? stop : best,
    ),
    stops.reduce((best, stop) =>
      stop.longitude < best.longitude ? stop : best,
    ),
    stops.reduce((best, stop) =>
      stop.longitude > best.longitude ? stop : best,
    ),
  ];
  const seen = new Set<string>();

  return anchors.filter((stop) => {
    if (seen.has(stop.id)) {
      return false;
    }

    seen.add(stop.id);
    return true;
  });
}

function orderNearestFromAnchor(
  stops: CoordinateStop[],
  anchor: CoordinateStop,
  start: CoordinateStop | undefined,
  end: CoordinateStop | undefined,
) {
  const anchoredOrder = orderNearestStops(
    stops.filter((stop) => stop.id !== anchor.id),
    anchor,
  );

  return orientRouteNearStart([anchor, ...anchoredOrder], start, end);
}

function reverseSegment<T>(items: T[], startIndex: number, endIndex: number) {
  while (startIndex < endIndex) {
    const item = items[startIndex];
    items[startIndex] = items[endIndex];
    items[endIndex] = item;
    startIndex += 1;
    endIndex -= 1;
  }
}

function improveRouteWithTwoOpt(
  ordered: CoordinateStop[],
  start: CoordinateStop | undefined,
  end: CoordinateStop | undefined,
) {
  if (ordered.length < 4) {
    return ordered;
  }

  const best = [...ordered];
  const maxPasses = ordered.length > 1000 ? 1 : 3;
  const maxSpan = ordered.length > 1000 ? 80 : ordered.length;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;

    for (let left = 0; left < best.length - 2; left += 1) {
      const maxRight = Math.min(best.length - 1, left + maxSpan);

      for (let right = left + 2; right <= maxRight; right += 1) {
        const before = left === 0 ? start : best[left - 1];
        const first = best[left];
        const last = best[right];
        const after = right === best.length - 1 ? end : best[right + 1];
        const currentCost =
          getHaversineMeters(before, first) + getHaversineMeters(last, after);
        const candidateCost =
          getHaversineMeters(before, last) + getHaversineMeters(first, after);

        if (candidateCost + Number.EPSILON < currentCost) {
          reverseSegment(best, left, right);
          improved = true;
        }
      }
    }

    if (!improved) {
      break;
    }
  }

  return best;
}

function getCoordinateBounds(stops: CoordinateStop[]) {
  return stops.reduce(
    (bounds, stop) => ({
      minLatitude: Math.min(bounds.minLatitude, stop.latitude),
      maxLatitude: Math.max(bounds.maxLatitude, stop.latitude),
      minLongitude: Math.min(bounds.minLongitude, stop.longitude),
      maxLongitude: Math.max(bounds.maxLongitude, stop.longitude),
    }),
    {
      minLatitude: Number.POSITIVE_INFINITY,
      maxLatitude: Number.NEGATIVE_INFINITY,
      minLongitude: Number.POSITIVE_INFINITY,
      maxLongitude: Number.NEGATIVE_INFINITY,
    },
  );
}

function scaleCoordinate(value: number, min: number, max: number) {
  if (max <= min) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(65_535, Math.round(((value - min) / (max - min)) * 65_535)),
  );
}

function getHilbertIndex(x: number, y: number) {
  let index = 0;
  const side = 65_536;

  for (let segment = side / 2; segment > 0; segment = Math.floor(segment / 2)) {
    const rx = (x & segment) > 0 ? 1 : 0;
    const ry = (y & segment) > 0 ? 1 : 0;

    index += segment * segment * ((3 * rx) ^ ry);

    if (ry === 0) {
      if (rx === 1) {
        x = side - 1 - x;
        y = side - 1 - y;
      }

      const rotated = x;
      x = y;
      y = rotated;
    }
  }

  return index;
}

function orderByHilbertCurve(stops: CoordinateStop[]) {
  const bounds = getCoordinateBounds(stops);

  return [...stops].sort((a, b) => {
    const ax = scaleCoordinate(a.longitude, bounds.minLongitude, bounds.maxLongitude);
    const ay = scaleCoordinate(a.latitude, bounds.minLatitude, bounds.maxLatitude);
    const bx = scaleCoordinate(b.longitude, bounds.minLongitude, bounds.maxLongitude);
    const by = scaleCoordinate(b.latitude, bounds.minLatitude, bounds.maxLatitude);

    return getHilbertIndex(ax, ay) - getHilbertIndex(bx, by);
  });
}

function orderByCoordinateSweep(
  stops: CoordinateStop[],
  primary: "latitude" | "longitude",
  direction: "asc" | "desc",
) {
  const secondary = primary === "latitude" ? "longitude" : "latitude";
  const multiplier = direction === "asc" ? 1 : -1;

  return [...stops].sort((a, b) => {
    const primaryDelta = a[primary] - b[primary];

    if (Math.abs(primaryDelta) > Number.EPSILON) {
      return primaryDelta * multiplier;
    }

    return (a[secondary] - b[secondary]) * multiplier;
  });
}

function orderByPolarSweep(
  stops: CoordinateStop[],
  direction: "asc" | "desc",
) {
  const center = stops.reduce(
    (point, stop) => ({
      latitude: point.latitude + stop.latitude / stops.length,
      longitude: point.longitude + stop.longitude / stops.length,
    }),
    { latitude: 0, longitude: 0 },
  );
  const multiplier = direction === "asc" ? 1 : -1;

  return [...stops].sort((a, b) => {
    const angleA = Math.atan2(a.latitude - center.latitude, a.longitude - center.longitude);
    const angleB = Math.atan2(b.latitude - center.latitude, b.longitude - center.longitude);

    return (angleA - angleB) * multiplier;
  });
}

function orientRouteNearStart(
  ordered: CoordinateStop[],
  start: CoordinateStop | undefined,
  end: CoordinateStop | undefined,
) {
  if (ordered.length < 2) {
    return ordered;
  }

  const reversed = [...ordered].reverse();

  return scoreRouteMeters(reversed, start, end) < scoreRouteMeters(ordered, start, end)
    ? reversed
    : ordered;
}

function uniqueRouteCandidates(candidates: CoordinateStop[][]) {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const signature = candidate.map((stop) => stop.id).join("|");

    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

function orderDefaultRouteStops(
  stops: CoordinateStop[],
  start: CoordinateStop | undefined,
  end: CoordinateStop | undefined,
) {
  const hilbert = orderByHilbertCurve(stops);
  const anchorNearestCandidates = getAnchorStops(stops).map((anchor) =>
    orderNearestFromAnchor(stops, anchor, start, end),
  );
  const candidates = uniqueRouteCandidates([
    orderNearestStops(stops, start),
    ...anchorNearestCandidates,
    orientRouteNearStart(hilbert, start, end),
    orientRouteNearStart([...hilbert].reverse(), start, end),
    orientRouteNearStart(orderByCoordinateSweep(stops, "latitude", "asc"), start, end),
    orientRouteNearStart(orderByCoordinateSweep(stops, "latitude", "desc"), start, end),
    orientRouteNearStart(orderByCoordinateSweep(stops, "longitude", "asc"), start, end),
    orientRouteNearStart(orderByCoordinateSweep(stops, "longitude", "desc"), start, end),
    orientRouteNearStart(orderByPolarSweep(stops, "asc"), start, end),
    orientRouteNearStart(orderByPolarSweep(stops, "desc"), start, end),
  ]);
  const improvedCandidates = candidates.map((candidate) =>
    improveRouteWithTwoOpt(candidate, start, end),
  );

  return improvedCandidates.reduce((best, candidate) =>
    scoreRouteMeters(candidate, start, end) < scoreRouteMeters(best, start, end)
      ? candidate
      : best,
  );
}

export function buildLocalOptimizedStopSequenceForTesting(options: {
  stops: CoordinateStop[];
  startStopId?: string;
  endMode?: EndMode;
  endStopId?: string;
  routeOptimizationMode?: RouteOptimizationMode;
}) {
  const stops = filterValidCoordinateStops(options.stops);
  const { start, end } = getRouteEndpoints({
    stops,
    startStopId: options.startStopId,
    endMode: options.endMode,
    endStopId: options.endStopId,
  });
  const shipmentStops = getShipmentStops(stops, start, end);
  const routeOptimizationMode =
    options.routeOptimizationMode ?? "google_optimized";
  const orderedStops =
    routeOptimizationMode === "google_optimized"
      ? orderDefaultRouteStops(shipmentStops, start, end)
      : routeOptimizationMode === "curbside_strict"
        ? orderCurbsideStops(shipmentStops, start)
        : shipmentStops;

  return [
    ...(start ? [start] : []),
    ...orderedStops,
    ...(end && end.id !== start?.id ? [end] : []),
  ];
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

      return getNearestGroupDistance(cursor, group) <
        getNearestGroupDistance(cursor, best)
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

function getRefreshDetailsRoute(
  shipmentStops: CoordinateStop[],
  startTime: Date,
  endTime: Date,
) {
  if (!shipmentStops.length) {
    return undefined;
  }

  return {
    vehicleIndex: 0,
    vehicleStartTime: startTime.toISOString(),
    vehicleEndTime: endTime.toISOString(),
    visits: shipmentStops.map((_, index) => ({
      shipmentIndex: index,
      isPickup: false,
      visitRequestIndex: 0,
    })),
  };
}

export function prepareOptimizeToursRequest(options: OptimizeRequestOptions) {
  const routeOptimizationMode = getRouteOptimizationMode(options);
  const usesCurbsideWaypoints = routeOptimizationMode !== "google_optimized";
  const usesStrictCurbsideSequence = routeOptimizationMode === "curbside_strict";
  const usesNearestSequenceRoute =
    routeOptimizationMode === "google_optimized" && !options.validateOnly;
  const stops = filterValidCoordinateStops(options.stops);
  const { start, end } = getRouteEndpoints({
    stops,
    startStopId: options.startStopId,
    endMode: options.endMode,
    endStopId: options.endStopId,
  });
  const unorderedShipmentStops = getShipmentStops(stops, start, end);
  const shipmentStops = usesNearestSequenceRoute
    ? orderDefaultRouteStops(unorderedShipmentStops, start, end)
    : usesStrictCurbsideSequence
      ? orderCurbsideStops(unorderedShipmentStops, start)
      : unorderedShipmentStops;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setUTCHours(12, 0, 0, 0);
  const endTime = new Date(
    tomorrow.getTime() + getRouteWindowHours(shipmentStops.length) * 60 * 60 * 1000,
  );
  const injectedSolutionConstraint = usesStrictCurbsideSequence
    ? getInjectedSolutionConstraint(shipmentStops, tomorrow, endTime)
    : undefined;
  const refreshDetailsRoute = usesNearestSequenceRoute
    ? getRefreshDetailsRoute(shipmentStops, tomorrow, endTime)
    : undefined;

  const payload = {
    timeout: options.validateOnly ? "5s" : "20s",
    ...(refreshDetailsRoute
      ? { refreshDetailsRoutes: [refreshDetailsRoute] }
      : {
          solvingMode: options.validateOnly ? "VALIDATE_ONLY" : "DEFAULT_SOLVE",
          searchMode: options.validateOnly
            ? "RETURN_FAST"
            : "CONSUME_ALL_AVAILABLE_TIME",
        }),
    populatePolylines: !options.validateOnly,
    populateTransitionPolylines: !options.validateOnly,
    ...(injectedSolutionConstraint ? { injectedSolutionConstraint } : {}),
    model: {
      shipments: shipmentStops.map((stop) => ({
        label: stop.id,
        deliveries: [
          {
            arrivalWaypoint: getWaypoint(stop, usesCurbsideWaypoints),
          },
        ],
      })),
      vehicles: [
        {
          label: "primary-route",
          startWaypoint: getWaypoint(start, usesCurbsideWaypoints),
          ...(end ? { endWaypoint: getWaypoint(end, usesCurbsideWaypoints) } : {}),
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
  const polylineDistanceMeters = Math.round(
    getPathMeters(decodePolyline(route?.routePolyline?.points)),
  );
  const sequenceDistanceMeters = Math.round(
    getStopSequenceMeters(visitOrder, shipmentStops, endpoints),
  );
  const distanceMeters = [
    routeMetrics?.travelDistanceMeters ??
      responseMetrics?.travelDistanceMeters,
    polylineDistanceMeters,
    sequenceDistanceMeters,
  ].find((value) => value !== undefined && value > 0) ?? 0;
  const durationSeconds = parseGoogleDuration(
    routeMetrics?.travelDuration ??
      routeMetrics?.totalDuration ??
      responseMetrics?.travelDuration ??
      responseMetrics?.totalDuration,
  );

  return {
    visitOrder,
    distanceMeters,
    durationSeconds: durationSeconds || estimateDurationSeconds(distanceMeters),
    polyline: route?.routePolyline?.points,
    skippedShipmentCount:
      data.skippedShipments?.length ??
      data.metrics?.skippedMandatoryShipmentCount ??
      0,
    validationErrors: data.validationErrors ?? [],
  };
}
