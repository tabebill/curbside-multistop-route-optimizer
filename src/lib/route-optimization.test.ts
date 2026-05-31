import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOptimizeToursPayload,
  buildLocalOptimizedStopSequenceForTesting,
  normalizeOptimizeToursResponse,
  normalizeOptimizeToursResponseWithQualityFallback,
} from "@/lib/route-optimization";
import type { CoordinateStop } from "@/lib/route-types";

type TestStop = CoordinateStop & { inputOrder: number };

const firstTwentySampleStops: TestStop[] = [
  ["1", 1, "7500 N OAKCLIFF DR E TULSA 74126, Tulsa", 36.26145, -95.999146],
  ["2", 2, "7474 N OAKCLIFF DR E TULSA 74126, Tulsa", 36.260666, -95.998144],
  ["3", 3, "7373 N OAKCLIFF DR E TULSA 74126, Tulsa", 36.262695, -95.995138],
  ["4", 4, "600 E 76 ST N TULSA 74126, Tulsa", 36.262355, -95.985168],
  ["5", 5, "619 E 73 ST N TULSA 74126, Tulsa", 36.260642, -95.984461],
  ["6", 6, "608 E 73 ST N TULSA 74126-1248, Tulsa", 36.259559, -95.984648],
  ["7", 7, "622 E 73 ST N TULSA 74126, Tulsa", 36.260114, -95.984211],
  ["8", 8, "740 E 73 ST N TULSA 74126-1246, Tulsa", 36.260072, -95.983024],
  ["9", 9, "780 E 73 ST N TULSA 74126, Tulsa", 36.259268, -95.981732],
  ["10", 10, "7404 N IROQUOIS AV E TULSA 74126, Tulsa", 36.262584, -95.982055],
  ["11", 11, "730 E 76 ST N TULSA 74126, Tulsa", 36.263629, -95.982319],
  ["12", 12, "7512 N IROQUOIS AV E TULSA 74126, Tulsa", 36.263364, -95.981695],
  ["13", 13, "7305 N IROQUOIS AV E TULSA 74126, Tulsa", 36.260969, -95.980922],
  ["14", 14, "1104 E 76 ST N TULSA 74126, Tulsa", 36.263706, -95.975647],
  ["15", 15, "7542 N OWASSO PL E TULSA 74126, Tulsa", 36.263803, -95.975138],
  ["16", 16, "7509 N OWASSO PL E TULSA 74126, Tulsa", 36.262696, -95.974683],
  ["17", 17, "7506 N OWASSO PL E TULSA 74126, Tulsa", 36.262414, -95.97514],
  ["18", 18, "7512 N OWASSO PL E TULSA 74126, Tulsa", 36.262627, -95.975133],
  ["19", 19, "7518 N OWASSO PL E TULSA 74126-1206, Tulsa", 36.262887, -95.975149],
  ["20", 20, "1100 E 76 ST N TULSA 74126, Tulsa", 36.263742, -95.976496],
].map(([id, inputOrder, label, latitude, longitude]) => ({
  id,
  inputOrder,
  label,
  latitude,
  longitude,
}));

const firstThirtySampleStops: TestStop[] = [
  ...firstTwentySampleStops,
  ["21", 21, "7524 N OWASSO PL E TULSA 74126, Tulsa", 36.263089, -95.975367],
  ["22", 22, "7517 N OWASSO PL E TULSA 74126, Tulsa", 36.262895, -95.974664],
  ["23", 23, "7523 N OWASSO PL E TULSA 74126, Tulsa", 36.263142, -95.974662],
  ["24", 24, "7530 N OWASSO PL E TULSA 74126, Tulsa", 36.263352, -95.975135],
  ["25", 25, "7536 N OWASSO PL E TULSA 74126, Tulsa", 36.263561, -95.975136],
  ["26", 26, "7529 N OWASSO PL E TULSA 74126, Tulsa", 36.263351, -95.974684],
  ["27", 27, "7535 N OWASSO PL E TULSA 74126, Tulsa", 36.263637, -95.974662],
  ["28", 28, "7507 N OWASSO PL E TULSA 74126, Tulsa", 36.26248, -95.974689],
  ["29", 29, "7541 N OWASSO PL E TULSA 74126-1205, Tulsa", 36.263826, -95.974664],
  ["30", 30, "7542 N PEORIA AV E TULSA 74126, Tulsa", 36.263826, -95.974012],
].map((stop) =>
  Array.isArray(stop)
    ? {
        id: stop[0],
        inputOrder: stop[1],
        label: stop[2],
        latitude: stop[3],
        longitude: stop[4],
      }
    : stop,
);

function inputOrders(stops: CoordinateStop[], referenceStops = firstTwentySampleStops) {
  const inputOrderById = new Map(
    referenceStops.map((stop) => [stop.id, stop.inputOrder]),
  );

  return stops.map((stop) => inputOrderById.get(stop.id));
}

function squaredRouteDistance(stops: CoordinateStop[]) {
  return stops.reduce((total, stop, index) => {
    if (!index) {
      return total;
    }

    const previous = stops[index - 1];
    const latitude = previous.latitude - stop.latitude;
    const longitude = previous.longitude - stop.longitude;

    return total + latitude * latitude + longitude * longitude;
  }, 0);
}

function createSeededRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleStops<T>(items: T[], random: () => number) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const item = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = item;
  }

  return shuffled;
}

function getRouteDiagnostics(ordered: CoordinateStop[]) {
  const shipmentStops = ordered.slice(1);

  return normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
        },
      ],
    },
    shipmentStops,
    { start: ordered[0] },
  ).qualityDiagnostics;
}

function assertCleanRouteContinuity(
  ordered: CoordinateStop[],
  minNearestNeighborMatchRate = 0.9,
) {
  const diagnostics = getRouteDiagnostics(ordered);

  assert.equal(ordered.length, new Set(ordered.map((stop) => stop.id)).size);
  assert.equal(diagnostics?.suspiciousJumpCount, 0);
  assert(
    (diagnostics?.nearestNeighborMatchRate ?? 0) >= minNearestNeighborMatchRate,
    `nearest-neighbor continuity should stay above ${minNearestNeighborMatchRate}; got ${
      diagnostics?.nearestNeighborMatchRate ?? 0
    }`,
  );
}

test("default route keeps nearby sample-address stops together before moving to farther streets", () => {
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: firstTwentySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const firstNineOrders = inputOrders(ordered.slice(0, 9));

  assert.deepEqual(new Set(firstNineOrders), new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.deepEqual(firstNineOrders.slice(0, 5), [1, 2, 3, 4, 5]);
  assert(
    ordered.findIndex((stop) => stop.id === "5") <
      ordered.findIndex((stop) => stop.id === "15"),
    "nearby E 73 stops should be routed before the farther Owasso block",
  );
});

test("default route matches real sample-address first thirty neighborhood progression", () => {
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: firstThirtySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });

  assert.deepEqual(inputOrders(ordered, firstThirtySampleStops), [
    1, 2, 3, 4, 5, 7, 6, 8, 9, 13, 10, 11, 12, 20, 14, 15, 25, 24, 21, 19,
    18, 17, 28, 16, 22, 23, 26, 27, 29, 30,
  ]);
  assert.equal(getRouteDiagnostics(ordered)?.suspiciousJumpCount, 0);
  assert(
    (getRouteDiagnostics(ordered)?.nearestNeighborMatchRate ?? 0) >= 0.9,
    "sample progression should keep most next stops near the closest available stop",
  );
});

test("default route stays clean when real sample-address imports arrive shuffled", () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const ordered = buildLocalOptimizedStopSequenceForTesting({
      stops: shuffleStops(firstThirtySampleStops, createSeededRandom(seed)),
      startStopId: "1",
      endMode: "last_stop",
      routeOptimizationMode: "google_optimized",
    });
    const diagnostics = getRouteDiagnostics(ordered);
    const firstOwassoIndex = ordered.findIndex((stop) =>
      stop.label.includes("OWASSO"),
    );
    const e73Indexes = ordered
      .map((stop, index) => (stop.label.includes(" E 73 ST N ") ? index : -1))
      .filter((index) => index >= 0);

    assert.equal(diagnostics?.suspiciousJumpCount, 0, `seed ${seed}`);
    assert(
      (diagnostics?.nearestNeighborMatchRate ?? 0) >= 0.85,
      `seed ${seed} should preserve nearest-neighbor continuity`,
    );
    assert(
      e73Indexes.every((index) => firstOwassoIndex < 0 || index < firstOwassoIndex),
      `seed ${seed} should keep the E 73 ST N cluster before moving into Owasso`,
    );
  }
});

test("default route does not let input order scatter compact clusters", () => {
  const stops: CoordinateStop[] = [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `west-${index}`,
      label: `West ${index}`,
      latitude: 36 + index * 0.0001,
      longitude: -96 + index * 0.0001,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `east-${index}`,
      label: `East ${index}`,
      latitude: 36 + index * 0.0001,
      longitude: -95.9 + index * 0.0001,
    })),
  ];
  const interleavedStops = Array.from({ length: 10 }, (_, index) => [
    stops[index],
    stops[index + 10],
  ]).flat();
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: interleavedStops,
    startStopId: "west-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const firstCluster = ordered.slice(0, 10).map((stop) => stop.id.split("-")[0]);
  const secondCluster = ordered.slice(10).map((stop) => stop.id.split("-")[0]);

  assert(firstCluster.every((cluster) => cluster === "west"));
  assert(secondCluster.every((cluster) => cluster === "east"));
});

test("default route reduces long jumps when several compact clusters are interleaved", () => {
  const clusterCenters = [
    ["northwest", 36.2, -96.2],
    ["northeast", 36.2, -95.8],
    ["southwest", 35.8, -96.2],
    ["southeast", 35.8, -95.8],
  ] as const;
  const clusteredStops = clusterCenters.flatMap(([name, latitude, longitude]) =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `${name}-${index}`,
      label: `${name} ${index}`,
      latitude: latitude + index * 0.0002,
      longitude: longitude + index * 0.0002,
    })),
  );
  const interleavedStops = Array.from({ length: 8 }, (_, index) =>
    clusterCenters.map(([name]) =>
      clusteredStops.find((stop) => stop.id === `${name}-${index}`)!,
    ),
  ).flat();
  const optimized = buildLocalOptimizedStopSequenceForTesting({
    stops: interleavedStops,
    startStopId: "northwest-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });

  assert(
    squaredRouteDistance(optimized) < squaredRouteDistance(interleavedStops) * 0.25,
    "optimized route should avoid repeatedly jumping between distant clusters",
  );
});

test("default route handles inner-pocket stops without leaving them scattered late", () => {
  const ringStops = Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;

    return {
      id: `ring-${index}`,
      label: `Ring ${index}`,
      latitude: 36 + Math.sin(angle) * 0.02,
      longitude: -96 + Math.cos(angle) * 0.02,
    };
  });
  const innerStops = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;

    return {
      id: `inner-${index}`,
      label: `Inner ${index}`,
      latitude: 36 + Math.sin(angle) * 0.004,
      longitude: -96 + Math.cos(angle) * 0.004,
    };
  });
  const interleavedStops = ringStops.flatMap((ringStop, index) =>
    index % 3 === 0 ? [ringStop, innerStops[index / 3]] : [ringStop],
  );
  const optimized = buildLocalOptimizedStopSequenceForTesting({
    stops: interleavedStops,
    startStopId: "ring-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const innerPositions = optimized
    .map((stop, index) => (stop.id.startsWith("inner-") ? index : -1))
    .filter((index) => index >= 0);

  assert(
    Math.max(...innerPositions) - Math.min(...innerPositions) < 16,
    "inner-pocket stops should be handled as a local pocket, not scattered across the route",
  );
});

test("default route pulls a late nearby stop back into its local neighborhood", () => {
  const nearbyCluster = Array.from({ length: 8 }, (_, index) => ({
    id: `near-${index}`,
    label: `Near ${index}`,
    latitude: 36 + index * 0.00012,
    longitude: -96 + index * 0.00012,
  }));
  const farCluster = Array.from({ length: 12 }, (_, index) => ({
    id: `far-${index}`,
    label: `Far ${index}`,
    latitude: 36.1 + index * 0.00012,
    longitude: -96.1 + index * 0.00012,
  }));
  const misplacedNearbyStop = {
    id: "near-late",
    label: "Near Late",
    latitude: 36.00018,
    longitude: -96.00018,
  };
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: [...nearbyCluster, ...farCluster, misplacedNearbyStop],
    startStopId: "near-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const nearLateIndex = ordered.findIndex((stop) => stop.id === "near-late");
  const firstFarIndex = ordered.findIndex((stop) => stop.id.startsWith("far-"));

  assert(
    nearLateIndex > 0 && nearLateIndex < firstFarIndex,
    "a nearby stop that appears late in input should be routed before moving to far stops",
  );
});

test("default route keeps parsed street groups contiguous before returning to another street", () => {
  const stops: CoordinateStop[] = [
    { id: "main-100", label: "100 E MAIN ST TULSA 74103", latitude: 36, longitude: -96 },
    { id: "main-102", label: "102 E MAIN ST TULSA 74103", latitude: 36.0001, longitude: -96 },
    { id: "oak-200", label: "200 E OAK ST TULSA 74103", latitude: 36.00015, longitude: -96.0002 },
    { id: "main-104", label: "104 E MAIN ST TULSA 74103", latitude: 36.0002, longitude: -96 },
    { id: "oak-202", label: "202 E OAK ST TULSA 74103", latitude: 36.00025, longitude: -96.0002 },
    { id: "main-106", label: "106 E MAIN ST TULSA 74103", latitude: 36.0003, longitude: -96 },
    { id: "oak-204", label: "204 E OAK ST TULSA 74103", latitude: 36.00035, longitude: -96.0002 },
  ];
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId: "main-100",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const streetOrder = ordered.map((stop) => stop.id.split("-")[0]);
  const mainIndexes = streetOrder
    .map((street, index) => (street === "main" ? index : -1))
    .filter((index) => index >= 0);
  const oakIndexes = streetOrder
    .map((street, index) => (street === "oak" ? index : -1))
    .filter((index) => index >= 0);

  assert.equal(Math.max(...mainIndexes) - Math.min(...mainIndexes), mainIndexes.length - 1);
  assert.equal(Math.max(...oakIndexes) - Math.min(...oakIndexes), oakIndexes.length - 1);
});

test("curbside strict splits distant segments on the same named street", () => {
  const stops: CoordinateStop[] = [
    { id: "main-near-100", label: "100 E MAIN ST TULSA 74103", latitude: 36, longitude: -96 },
    { id: "main-near-102", label: "102 E MAIN ST TULSA 74103", latitude: 36.0001, longitude: -96 },
    { id: "oak-near-200", label: "200 E OAK ST TULSA 74103", latitude: 36.00015, longitude: -96.00015 },
    { id: "oak-near-202", label: "202 E OAK ST TULSA 74103", latitude: 36.00025, longitude: -96.00015 },
    { id: "main-far-1000", label: "1000 E MAIN ST TULSA 74103", latitude: 36.02, longitude: -96.02 },
    { id: "main-far-1002", label: "1002 E MAIN ST TULSA 74103", latitude: 36.0201, longitude: -96.02 },
  ];
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId: "main-near-100",
    endMode: "last_stop",
    routeOptimizationMode: "curbside_strict",
  });
  const oakIndex = ordered.findIndex((stop) => stop.id === "oak-near-200");
  const farMainIndex = ordered.findIndex((stop) => stop.id === "main-far-1000");

  assert(
    oakIndex > 0 && oakIndex < farMainIndex,
    "nearby streets should be routed before a distant segment with the same street name",
  );
});

test("2-opt improvement does not make a nearest-next route worse", () => {
  const stops: CoordinateStop[] = [
    { id: "start", label: "Start", latitude: 0, longitude: 0 },
    { id: "a", label: "A", latitude: 0.1, longitude: 0 },
    { id: "b", label: "B", latitude: 0.2, longitude: 0.2 },
    { id: "c", label: "C", latitude: 0, longitude: 0.2 },
    { id: "d", label: "D", latitude: 0.3, longitude: 0 },
    { id: "e", label: "E", latitude: 0.4, longitude: 0.2 },
    { id: "f", label: "F", latitude: 0.2, longitude: 0.4 },
  ];
  const nearestOnly = ["start", "a", "b", "c", "f", "e", "d"].map(
    (id) => stops.find((stop) => stop.id === id)!,
  );
  const improved = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId: "start",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });

  assert(
    squaredRouteDistance(improved) <= squaredRouteDistance(nearestOnly),
    "local optimization should not increase coordinate route length",
  );
});

test("route quality diagnostics flag long jumps that skip nearer later stops", () => {
  const stops: CoordinateStop[] = [
    { id: "near-1", label: "Near 1", latitude: 36, longitude: -96 },
    { id: "near-2", label: "Near 2", latitude: 36.0001, longitude: -96.0001 },
    { id: "near-3", label: "Near 3", latitude: 36.0002, longitude: -96.0002 },
    { id: "far", label: "Far", latitude: 36.1, longitude: -96.1 },
  ];
  const route = normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: [
            { shipmentIndex: 0 },
            { shipmentIndex: 3 },
            { shipmentIndex: 1 },
            { shipmentIndex: 2 },
          ],
        },
      ],
    },
    stops,
  );

  assert.equal(route.qualityDiagnostics?.suspiciousJumpCount, 1);
  assert.equal(route.qualityDiagnostics?.issues[0].fromStopId, "near-1");
  assert.equal(route.qualityDiagnostics?.issues[0].toStopId, "far");
  assert.equal(route.qualityDiagnostics?.issues[0].nearestLaterStopId, "near-2");
});

test("quality fallback replaces suspicious Google order with seeded local order", () => {
  const stops: CoordinateStop[] = [
    { id: "near-1", label: "Near 1", latitude: 36, longitude: -96 },
    { id: "near-2", label: "Near 2", latitude: 36.0001, longitude: -96.0001 },
    { id: "near-3", label: "Near 3", latitude: 36.0002, longitude: -96.0002 },
    { id: "far", label: "Far", latitude: 36.1, longitude: -96.1 },
  ];
  const route = normalizeOptimizeToursResponseWithQualityFallback(
    {
      routes: [
        {
          visits: [
            { shipmentIndex: 0 },
            { shipmentIndex: 3 },
            { shipmentIndex: 1 },
            { shipmentIndex: 2 },
          ],
        },
      ],
    },
    stops,
  );

  assert.deepEqual(
    route.visitOrder.map((visit) => visit.stopId),
    ["near-1", "near-2", "near-3", "far"],
  );
  assert.equal(route.qualityDiagnostics?.suspiciousJumpCount, 0);
  assert.equal(route.qualityFallback?.applied, true);
  assert.equal(
    route.qualityFallback?.originalQualityDiagnostics?.suspiciousJumpCount,
    1,
  );
  assert.equal(route.validationErrors.length, 1);
});

test("quality fallback rejects compact but scattered Google numbering", () => {
  const stops: CoordinateStop[] = [
    { id: "a1", label: "100 E A ST TULSA 74103", latitude: 36, longitude: -96 },
    { id: "a2", label: "102 E A ST TULSA 74103", latitude: 36.0001, longitude: -96 },
    { id: "a3", label: "104 E A ST TULSA 74103", latitude: 36.0002, longitude: -96 },
    { id: "b1", label: "200 E B ST TULSA 74103", latitude: 36.001, longitude: -96 },
    { id: "b2", label: "202 E B ST TULSA 74103", latitude: 36.0011, longitude: -96 },
    { id: "b3", label: "204 E B ST TULSA 74103", latitude: 36.0012, longitude: -96 },
  ];
  const route = normalizeOptimizeToursResponseWithQualityFallback(
    {
      routes: [
        {
          visits: [
            { shipmentIndex: 0 },
            { shipmentIndex: 3 },
            { shipmentIndex: 1 },
            { shipmentIndex: 4 },
            { shipmentIndex: 2 },
            { shipmentIndex: 5 },
          ],
        },
      ],
    },
    stops,
  );

  assert.deepEqual(
    route.visitOrder.map((visit) => visit.stopId),
    ["a1", "a2", "a3", "b1", "b2", "b3"],
  );
  assert.equal(route.qualityFallback?.applied, true);
  assert.equal(route.qualityDiagnostics?.suspiciousJumpCount, 0);
  assert(
    (route.qualityFallback?.originalQualityDiagnostics?.nearestNeighborMatchRate ??
      1) < 0.86,
  );
});

test("route quality diagnostics stay clean for optimized first twenty sample stops", () => {
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: firstTwentySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const shipmentStops = ordered.slice(1);
  const route = normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
        },
      ],
    },
    shipmentStops,
    { start: ordered[0] },
  );

  assert.equal(route.qualityDiagnostics?.suspiciousJumpCount, 0);
  assert(
    (route.qualityDiagnostics?.nearestNeighborMatchRate ?? 0) >= 0.9,
  );
});

test("google optimized payload seeds Google but still asks Google to solve", () => {
  const payload = buildOptimizeToursPayload({
    stops: firstTwentySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  }) as Record<string, unknown>;

  assert.equal(payload.solvingMode, "DEFAULT_SOLVE");
  assert.equal(payload.searchMode, "CONSUME_ALL_AVAILABLE_TIME");
  assert(!("refreshDetailsRoutes" in payload));
  assert(Array.isArray(payload.injectedFirstSolutionRoutes));
  assert.equal(
    (payload.injectedFirstSolutionRoutes as Array<{ visits?: unknown[] }>)[0]
      .visits?.length,
    firstTwentySampleStops.length - 1,
  );
});

test("curbside assisted payload uses side-of-road waypoints and seeded solve", () => {
  const payload = buildOptimizeToursPayload({
    stops: firstTwentySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "curbside_assisted",
  }) as {
    solvingMode?: string;
    searchMode?: string;
    injectedFirstSolutionRoutes?: unknown[];
    injectedSolutionConstraint?: unknown;
    model?: {
      shipments?: Array<{
        deliveries?: Array<{ arrivalWaypoint?: { sideOfRoad?: boolean } }>;
      }>;
    };
  };

  assert.equal(payload.solvingMode, "DEFAULT_SOLVE");
  assert.equal(payload.searchMode, "CONSUME_ALL_AVAILABLE_TIME");
  assert(Array.isArray(payload.injectedFirstSolutionRoutes));
  assert.equal(payload.injectedSolutionConstraint, undefined);
  assert.equal(
    payload.model?.shipments?.[0]?.deliveries?.[0]?.arrivalWaypoint?.sideOfRoad,
    true,
  );
});

test("validation payload does not lock Google to an injected solve route", () => {
  const payload = buildOptimizeToursPayload({
    stops: firstTwentySampleStops,
    startStopId: "1",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
    validateOnly: true,
  }) as Record<string, unknown>;

  assert.equal(payload.solvingMode, "VALIDATE_ONLY");
  assert.equal(payload.searchMode, "RETURN_FAST");
  assert(!("refreshDetailsRoutes" in payload));
  assert(!("injectedFirstSolutionRoutes" in payload));
});

test("default route avoids quality-diagnostic jumps on mixed cluster input", () => {
  const stops = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `a-${index}`,
      label: `A ${index}`,
      latitude: 36 + index * 0.0001,
      longitude: -96 + index * 0.0001,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `b-${index}`,
      label: `B ${index}`,
      latitude: 36.05 + index * 0.0001,
      longitude: -96.05 + index * 0.0001,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `c-${index}`,
      label: `C ${index}`,
      latitude: 36.001 + index * 0.0001,
      longitude: -96.001 + index * 0.0001,
    })),
  ];
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId: "a-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });
  const shipmentStops = ordered.slice(1);
  const route = normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
        },
      ],
    },
    shipmentStops,
    { start: ordered[0] },
  );

  assert.equal(route.qualityDiagnostics?.suspiciousJumpCount, 0);
});

test("default route stays clean across deterministic shuffled cluster imports", () => {
  const random = createSeededRandom(20260531);

  for (let scenario = 0; scenario < 8; scenario += 1) {
    const clusterCount = 4 + (scenario % 3);
    const stopsPerCluster = 10 + scenario;
    const stops = Array.from({ length: clusterCount }, (_, clusterIndex) => {
      const centerLatitude =
        36 + (clusterIndex % 3) * 0.04 + (random() - 0.5) * 0.004;
      const centerLongitude =
        -96 + Math.floor(clusterIndex / 3) * 0.04 + (random() - 0.5) * 0.004;

      return Array.from({ length: stopsPerCluster }, (_, stopIndex) => ({
        id: `scenario-${scenario}-cluster-${clusterIndex}-stop-${stopIndex}`,
        label: `${1000 + stopIndex} E RANDOM ${clusterIndex} ST TULSA 74103`,
        latitude: centerLatitude + (random() - 0.5) * 0.002,
        longitude: centerLongitude + (random() - 0.5) * 0.002,
      }));
    }).flat();
    const shuffled = shuffleStops(stops, random);
    const ordered = buildLocalOptimizedStopSequenceForTesting({
      stops: shuffled,
      startStopId: shuffled[0].id,
      endMode: "last_stop",
      routeOptimizationMode: "google_optimized",
    });
    const diagnostics = getRouteDiagnostics(ordered);

    assert.equal(ordered.length, shuffled.length);
    assert.equal(new Set(ordered.map((stop) => stop.id)).size, shuffled.length);
    assert.equal(
      diagnostics?.suspiciousJumpCount,
      0,
      `scenario ${scenario} should not skip nearer clustered stops`,
    );
  }
});

test("default route stays stable across adversarial neighborhood shapes", () => {
  const random = createSeededRandom(2026053101);
  const scenarios: CoordinateStop[][] = [
    Array.from({ length: 6 }, (_, streetIndex) =>
      Array.from({ length: 12 }, (_, houseIndex) => ({
        id: `row-${streetIndex}-${houseIndex}`,
        label: `${100 + houseIndex * 2} E ROW ${streetIndex} ST TULSA 74103`,
        latitude: 36 + streetIndex * 0.001,
        longitude:
          -96 +
          (streetIndex % 2 === 0 ? houseIndex : 11 - houseIndex) * 0.00018,
      })),
    ).flat(),
    Array.from({ length: 5 }, (_, pocketIndex) => {
      const angle = (pocketIndex / 5) * Math.PI * 2;
      const centerLatitude = 36 + Math.sin(angle) * 0.008;
      const centerLongitude = -96 + Math.cos(angle) * 0.008;

      return Array.from({ length: 10 }, (_, stopIndex) => ({
        id: `pocket-${pocketIndex}-${stopIndex}`,
        label: `${200 + stopIndex * 2} E POCKET ${pocketIndex} PL TULSA 74103`,
        latitude: centerLatitude + Math.sin((stopIndex / 10) * Math.PI) * 0.0012,
        longitude: centerLongitude + stopIndex * 0.00012,
      }));
    }).flat(),
    Array.from({ length: 9 }, (_, avenueIndex) =>
      Array.from({ length: 8 }, (_, houseIndex) => ({
        id: `grid-${avenueIndex}-${houseIndex}`,
        label: `${300 + houseIndex * 2} N GRID ${avenueIndex} AVE TULSA 74103`,
        latitude: 36 + houseIndex * 0.00022,
        longitude: -96 + avenueIndex * 0.00022,
      })),
    ).flat(),
    [
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `corridor-${index}`,
        label: `${400 + index * 2} E CORRIDOR ST TULSA 74103`,
        latitude: 36 + index * 0.00018,
        longitude: -96 + Math.sin(index / 4) * 0.0003,
      })),
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `branch-${index}`,
        label: `${500 + index * 2} E BRANCH PL TULSA 74103`,
        latitude: 36.003 + index * 0.00008,
        longitude: -96.003 + index * 0.0002,
      })),
    ],
  ];

  scenarios.forEach((stops, scenarioIndex) => {
    for (let seed = 1; seed <= 4; seed += 1) {
      const shuffled = shuffleStops(stops, random);
      const ordered = buildLocalOptimizedStopSequenceForTesting({
        stops: shuffled,
        startStopId: shuffled[0].id,
        endMode: "last_stop",
        routeOptimizationMode: "google_optimized",
      });

      assert.equal(
        ordered.length,
        shuffled.length,
        `scenario ${scenarioIndex} seed ${seed} should retain every stop`,
      );
      assertCleanRouteContinuity(ordered, 0.9);
    }
  });
});

test("curbside strict stays clean across shuffled repeated street segments", () => {
  const random = createSeededRandom(74126);
  const stops = Array.from({ length: 6 }, (_, segmentIndex) =>
    Array.from({ length: 8 }, (_, stopIndex) => {
      const houseNumber = 100 + stopIndex * 2 + segmentIndex * 700;

      return {
        id: `segment-${segmentIndex}-stop-${stopIndex}`,
        label: `${houseNumber} E SHARED ST TULSA 74103`,
        latitude: 36 + segmentIndex * 0.012 + stopIndex * 0.00012,
        longitude: -96 + (segmentIndex % 2) * 0.009 + stopIndex * 0.00008,
      };
    }),
  ).flat();
  const shuffled = shuffleStops(stops, random);
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops: shuffled,
    startStopId: shuffled[0].id,
    endMode: "last_stop",
    routeOptimizationMode: "curbside_strict",
  });
  const diagnostics = getRouteDiagnostics(ordered);

  assert.equal(ordered.length, shuffled.length);
  assert.equal(new Set(ordered.map((stop) => stop.id)).size, shuffled.length);
  assert.equal(diagnostics?.suspiciousJumpCount, 0);
});

test("default route handles large synthetic imports without dropping stops", () => {
  const stops: CoordinateStop[] = Array.from({ length: 1200 }, (_, index) => {
    const row = Math.floor(index / 40);
    const column = index % 40;

    return {
      id: `large-${index}`,
      label: `${1000 + index} E LARGE ST TULSA 74103`,
      latitude: 36 + row * 0.0004,
      longitude: -96 + column * 0.0004,
    };
  });
  const ordered = buildLocalOptimizedStopSequenceForTesting({
    stops,
    startStopId: "large-0",
    endMode: "last_stop",
    routeOptimizationMode: "google_optimized",
  });

  assert.equal(ordered.length, stops.length);
  assert.equal(new Set(ordered.map((stop) => stop.id)).size, stops.length);
});
