import {
  buildLocalOptimizedStopSequenceForTesting,
  normalizeOptimizeToursResponse,
} from "@/lib/route-optimization";
import type { CoordinateStop, EndMode, RouteOptimizationMode } from "@/lib/route-types";

type Scenario = {
  name: string;
  stops: CoordinateStop[];
  endMode?: EndMode;
};

function createSeededRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleStops<T>(items: T[], seed: number) {
  const shuffled = [...items];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const item = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = item;
  }

  return shuffled;
}

function buildRouteDiagnostics(
  ordered: CoordinateStop[],
  endMode: EndMode,
  endStopId?: string,
) {
  const start = ordered[0];
  const end =
    endMode === "round_trip"
      ? start
      : endMode === "selected_stop"
        ? ordered.find((stop) => stop.id === endStopId)
        : undefined;
  const fixedStopIds = new Set([start?.id, end?.id].filter(Boolean));
  const shipmentStops = ordered.filter((stop) => !fixedStopIds.has(stop.id));

  return normalizeOptimizeToursResponse(
    {
      routes: [
        {
          visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
        },
      ],
    },
    shipmentStops,
    { start, end },
  ).qualityDiagnostics;
}

function buildSerpentineBlocks(): CoordinateStop[] {
  return Array.from({ length: 5 }, (_, streetIndex) =>
    Array.from({ length: 10 }, (_, houseIndex) => {
      const westToEast = streetIndex % 2 === 0;
      const x = westToEast ? houseIndex : 9 - houseIndex;

      return {
        id: `serpentine-${streetIndex}-${houseIndex}`,
        label: `${100 + houseIndex * 2} E SERPENTINE ${streetIndex} ST TULSA 74103`,
        latitude: 36 + streetIndex * 0.00028,
        longitude: -96 + x * 0.00018,
      };
    }),
  ).flat();
}

function buildCulsDeSac(): CoordinateStop[] {
  return Array.from({ length: 6 }, (_, pocketIndex) => {
    const centerLatitude = 36 + Math.floor(pocketIndex / 3) * 0.004;
    const centerLongitude = -96 + (pocketIndex % 3) * 0.004;

    return Array.from({ length: 8 }, (_, stopIndex) => {
      const angle = (Math.PI * stopIndex) / 7;

      return {
        id: `culdesac-${pocketIndex}-${stopIndex}`,
        label: `${200 + stopIndex * 2} E CULDESAC ${pocketIndex} PL TULSA 74103`,
        latitude: centerLatitude + Math.sin(angle) * 0.001,
        longitude: centerLongitude + Math.cos(angle) * 0.001,
      };
    });
  }).flat();
}

function buildLongCorridorWithBranches(): CoordinateStop[] {
  return [
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `corridor-${index}`,
      label: `${300 + index * 2} E CORRIDOR ST TULSA 74103`,
      latitude: 36 + index * 0.00012,
      longitude: -96 + Math.sin(index / 6) * 0.0002,
    })),
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `branch-${index}`,
      label: `${500 + index * 2} E BRANCH ${Math.floor(index / 6)} PL TULSA 74103`,
      latitude: 36.002 + Math.floor(index / 6) * 0.002 + (index % 6) * 0.0001,
      longitude: -96.003 + (index % 6) * 0.00022,
    })),
  ];
}

function buildSeparatedNeighborhoods(): CoordinateStop[] {
  return [
    ...Array.from({ length: 4 }, (_, clusterIndex) =>
      Array.from({ length: 12 }, (_, stopIndex) => ({
        id: `cluster-${clusterIndex}-${stopIndex}`,
        label: `${600 + stopIndex * 2} E CLUSTER ${clusterIndex} ST TULSA 74103`,
        latitude:
          36 +
          Math.floor(clusterIndex / 2) * 0.01 +
          Math.floor(stopIndex / 4) * 0.00022,
        longitude:
          -96 +
          (clusterIndex % 2) * 0.01 +
          (stopIndex % 4) * 0.00022,
      })),
    ).flat(),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `connector-${index}`,
      label: `${800 + index * 2} E CONNECTOR ST TULSA 74103`,
      latitude: 36.001 + index * 0.00075,
      longitude: -95.999 + index * 0.00075,
    })),
  ];
}

function buildGenericLineWithNumberingGaps(): CoordinateStop[] {
  return Array.from({ length: 48 }, (_, index) => ({
    id: `generic-line-${index}`,
    label: `Imported stop ${index + 1}`,
    latitude: 36,
    longitude: -96 + index * 0.00016,
  }));
}

function buildGenericClusterGrid(): CoordinateStop[] {
  return Array.from({ length: 5 }, (_, clusterIndex) =>
    Array.from({ length: 14 }, (_, stopIndex) => ({
      id: `generic-cluster-${clusterIndex}-${stopIndex}`,
      label: `Parcel ${clusterIndex + 1}-${stopIndex + 1}`,
      latitude:
        36 +
        Math.floor(clusterIndex / 3) * 0.006 +
        Math.floor(stopIndex / 4) * 0.00018,
      longitude:
        -96 +
        (clusterIndex % 3) * 0.006 +
        (stopIndex % 4) * 0.00018,
    })),
  ).flat();
}

function buildGenericInnerPocket(): CoordinateStop[] {
  const ringStops = Array.from({ length: 36 }, (_, index) => {
    const angle = (index / 36) * Math.PI * 2;

    return {
      id: `generic-ring-${index}`,
      label: `Generic outer ${index + 1}`,
      latitude: 36 + Math.sin(angle) * 0.006,
      longitude: -96 + Math.cos(angle) * 0.006,
    };
  });
  const pocketStops = Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2;

    return {
      id: `generic-pocket-${index}`,
      label: `Generic inner ${index + 1}`,
      latitude: 36 + Math.sin(angle) * 0.0014,
      longitude: -96 + Math.cos(angle) * 0.0014,
    };
  });

  return ringStops.flatMap((ringStop, index) =>
    index % 3 === 0 && pocketStops[index / 3]
      ? [ringStop, pocketStops[index / 3]]
      : [ringStop],
  );
}

function buildGenericParallelRowsWithExchanges(): CoordinateStop[] {
  const rows = Array.from({ length: 4 }, (_, rowIndex) =>
    Array.from({ length: 18 }, (_, stopIndex) => ({
      id: `generic-row-${rowIndex}-${stopIndex}`,
      label: `Generic row ${rowIndex + 1}-${stopIndex + 1}`,
      latitude: 36 + stopIndex * 0.00016,
      longitude: -96 + rowIndex * 0.00042,
    })),
  );
  const stops = rows.flat();

  for (const [leftId, rightId] of [
    ["generic-row-0-3", "generic-row-1-10"],
    ["generic-row-1-4", "generic-row-2-11"],
    ["generic-row-2-5", "generic-row-3-12"],
  ]) {
    const leftIndex = stops.findIndex((stop) => stop.id === leftId);
    const rightIndex = stops.findIndex((stop) => stop.id === rightId);

    if (leftIndex >= 0 && rightIndex >= 0) {
      const leftStop = stops[leftIndex];

      stops[leftIndex] = stops[rightIndex];
      stops[rightIndex] = leftStop;
    }
  }

  return stops;
}

const routeOptimizationMode =
  (process.env.ROUTE_RANDOM_MODE as RouteOptimizationMode | undefined) ?? "auto";
const maxSuspiciousJumps = Number(process.env.ROUTE_RANDOM_MAX_SUSPICIOUS_JUMPS ?? 0);
const minNearestNeighborMatchRate = Number(
  process.env.ROUTE_RANDOM_MIN_NEAREST_MATCH_RATE ?? 0.9,
);
const maxStreetFaceReentries = Number(
  process.env.ROUTE_RANDOM_MAX_STREET_FACE_REENTRIES ?? 0,
);
const maxStreetFaceBacktracks = Number(
  process.env.ROUTE_RANDOM_MAX_STREET_FACE_BACKTRACKS ?? 0,
);
const maxLongestLegRatio = Number(process.env.ROUTE_RANDOM_MAX_LONGEST_LEG_RATIO ?? 20);
const minLegBaselineMeters = Number(
  process.env.ROUTE_RANDOM_MIN_LEG_BASELINE_METERS ?? 80,
);
const shuffleCount = Number(process.env.ROUTE_RANDOM_SHUFFLES ?? 3);
const scenarios: Scenario[] = [
  { name: "serpentine-blocks", stops: buildSerpentineBlocks() },
  { name: "culs-de-sac", stops: buildCulsDeSac() },
  { name: "corridor-branches", stops: buildLongCorridorWithBranches() },
  { name: "separated-neighborhoods", stops: buildSeparatedNeighborhoods() },
  { name: "generic-line-gaps", stops: buildGenericLineWithNumberingGaps() },
  { name: "generic-cluster-grid", stops: buildGenericClusterGrid() },
  { name: "generic-inner-pocket", stops: buildGenericInnerPocket() },
  {
    name: "generic-parallel-rows-exchanges",
    stops: buildGenericParallelRowsWithExchanges(),
  },
  {
    name: "selected-end-serpentine",
    stops: buildSerpentineBlocks(),
    endMode: "selected_stop",
  },
  {
    name: "round-trip-culdesac",
    stops: buildCulsDeSac(),
    endMode: "round_trip",
  },
];
const results = scenarios.flatMap((scenario, scenarioIndex) =>
  Array.from({ length: shuffleCount }, (_, shuffleIndex) => {
    const seed = scenarioIndex * 100 + shuffleIndex + 1;
    const stops = shuffleStops(scenario.stops, seed);
    const startStopId = stops[0].id;
    const endStopId = scenario.endMode === "selected_stop" ? stops.at(-1)?.id : undefined;
    const ordered = buildLocalOptimizedStopSequenceForTesting({
      stops,
      startStopId,
      endMode: scenario.endMode ?? "last_stop",
      endStopId,
      routeOptimizationMode,
    });
    const diagnostics = buildRouteDiagnostics(
      ordered,
      scenario.endMode ?? "last_stop",
      endStopId,
    );
    const longestLegMeters = diagnostics?.longestLegMeters ?? 0;
    const medianLegMeters = diagnostics?.medianLegMeters ?? 0;

    return {
      scenario: scenario.name,
      seed,
      stopCount: stops.length,
      orderedStops: ordered.length,
      uniqueStops: new Set(ordered.map((stop) => stop.id)).size,
      firstStopId: ordered[0]?.id,
      expectedStartStopId: startStopId,
      lastStopId: ordered.at(-1)?.id,
      expectedEndStopId: endStopId,
      suspiciousJumps: diagnostics?.suspiciousJumpCount ?? 0,
      streetReentries: diagnostics?.streetReentryCount ?? 0,
      streetFaceReentries: diagnostics?.streetFaceReentryCount ?? 0,
      streetFaceBacktracks: diagnostics?.streetFaceBacktrackCount ?? 0,
      nearestNeighborMatchRate: diagnostics?.nearestNeighborMatchRate ?? 0,
      longestLegMeters,
      medianLegMeters,
      longestLegRatio: Number(
        (longestLegMeters / Math.max(medianLegMeters, minLegBaselineMeters)).toFixed(2),
      ),
    };
  }),
);
const result = {
  routeOptimizationMode,
  scenarioCount: scenarios.length,
  shuffleCount,
  maxSuspiciousJumps,
  minNearestNeighborMatchRate,
  maxStreetFaceReentries,
  maxStreetFaceBacktracks,
  maxLongestLegRatio,
  minLegBaselineMeters,
  results,
};

console.log(JSON.stringify(result, null, 2));

for (const run of results) {
  if (run.orderedStops !== run.stopCount || run.uniqueStops !== run.stopCount) {
    console.error(`${run.scenario} seed ${run.seed}: missing or duplicate stops.`);
    process.exitCode = 1;
  }

  if (run.firstStopId !== run.expectedStartStopId) {
    console.error(`${run.scenario} seed ${run.seed}: start stop changed.`);
    process.exitCode = 1;
  }

  if (run.expectedEndStopId && run.lastStopId !== run.expectedEndStopId) {
    console.error(`${run.scenario} seed ${run.seed}: selected end stop changed.`);
    process.exitCode = 1;
  }

  if (run.suspiciousJumps > maxSuspiciousJumps) {
    console.error(`${run.scenario} seed ${run.seed}: suspicious jumps found.`);
    process.exitCode = 1;
  }

  if (run.streetFaceReentries > maxStreetFaceReentries) {
    console.error(`${run.scenario} seed ${run.seed}: street-face reentries found.`);
    process.exitCode = 1;
  }

  if (run.streetFaceBacktracks > maxStreetFaceBacktracks) {
    console.error(`${run.scenario} seed ${run.seed}: street-face backtracking found.`);
    process.exitCode = 1;
  }

  if (run.nearestNeighborMatchRate < minNearestNeighborMatchRate) {
    console.error(`${run.scenario} seed ${run.seed}: weak nearest-neighbor continuity.`);
    process.exitCode = 1;
  }

  if (
    run.longestLegMeters >
    Math.max(run.medianLegMeters, minLegBaselineMeters) * maxLongestLegRatio
  ) {
    console.error(`${run.scenario} seed ${run.seed}: longest leg exceeded threshold.`);
    process.exitCode = 1;
  }
}
