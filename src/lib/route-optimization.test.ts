import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalOptimizedStopSequenceForTesting,
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

function inputOrders(stops: CoordinateStop[]) {
  const inputOrderById = new Map(
    firstTwentySampleStops.map((stop) => [stop.id, stop.inputOrder]),
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
