export type RouteMode = "round-trip" | "open";

export type ParsedStop = {
  id: string;
  input: string;
  houseNumber: number;
  streetKey: string;
  side: "even" | "odd";
  x: number;
  y: number;
};

export type RouteResult = {
  stops: ParsedStop[];
  skipped: string[];
  duplicates: string[];
  distance: number;
  streetCount: number;
};

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

function normalizeToken(token: string) {
  const upper = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ordinal = upper.match(/^(\d+)(ST|ND|RD|TH)$/);

  if (ordinal) {
    return ordinal[1];
  }

  return aliases.get(upper) ?? upper;
}

function getDistance(
  from: Pick<ParsedStop, "x" | "y">,
  to: Pick<ParsedStop, "x" | "y">,
) {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

function sortFace(stops: ParsedStop[], direction: "asc" | "desc") {
  return [...stops].sort((a, b) =>
    direction === "asc"
      ? a.houseNumber - b.houseNumber
      : b.houseNumber - a.houseNumber,
  );
}

function scoreOrder(stops: ParsedStop[], start: ParsedStop | undefined) {
  if (!stops.length) {
    return 0;
  }

  return stops.reduce((score, stop, index) => {
    const previous = index === 0 ? start : stops[index - 1];

    return previous ? score + getDistance(previous, stop) : score;
  }, 0);
}

function getCentroid(stops: ParsedStop[]) {
  return stops.reduce(
    (center, stop) => ({
      x: center.x + stop.x / stops.length,
      y: center.y + stop.y / stops.length,
    }),
    { x: 0, y: 0 },
  );
}

function orderStreetGroup(stops: ParsedStop[], start: ParsedStop | undefined) {
  const even = stops.filter((stop) => stop.side === "even");
  const odd = stops.filter((stop) => stop.side === "odd");
  const candidates: ParsedStop[][] = [];

  if (even.length && odd.length) {
    candidates.push([...sortFace(even, "asc"), ...sortFace(odd, "desc")]);
    candidates.push([...sortFace(even, "desc"), ...sortFace(odd, "asc")]);
    candidates.push([...sortFace(odd, "asc"), ...sortFace(even, "desc")]);
    candidates.push([...sortFace(odd, "desc"), ...sortFace(even, "asc")]);
  } else {
    const side = even.length ? even : odd;

    candidates.push(sortFace(side, "asc"));
    candidates.push(sortFace(side, "desc"));
  }

  return candidates.reduce((best, candidate) =>
    scoreOrder(candidate, start) < scoreOrder(best, start) ? candidate : best,
  );
}

function nearestNeighbor(stops: ParsedStop[], start: ParsedStop | undefined) {
  const remaining = [...stops];
  const ordered: ParsedStop[] = [];
  let cursor = start;

  while (remaining.length) {
    const nextIndex = remaining.reduce((bestIndex, stop, index) => {
      if (!cursor) {
        return bestIndex;
      }

      return getDistance(cursor, stop) < getDistance(cursor, remaining[bestIndex])
        ? index
        : bestIndex;
    }, 0);
    const [next] = remaining.splice(nextIndex, 1);

    ordered.push(next);
    cursor = next;
  }

  return ordered;
}

function parseStreet(line: string, index: number, streetRows: Map<string, number>) {
  const match = line.match(/^\s*(\d+)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const houseNumber = Number(match[1]);
  const tokens = match[2]
    .split(/[\s,]+/)
    .map(normalizeToken)
    .filter(Boolean);
  const streetTypeIndex = tokens.findIndex((token) => streetTypes.has(token));

  if (!Number.isFinite(houseNumber) || streetTypeIndex < 0) {
    return undefined;
  }

  const streetTokens = tokens.slice(0, streetTypeIndex + 1);
  const suffixDirection = tokens[streetTypeIndex + 1];

  if (suffixDirection && directions.has(suffixDirection)) {
    streetTokens.push(suffixDirection);
  }

  const streetKey = streetTokens.join(" ");
  const row = streetRows.get(streetKey) ?? streetRows.size;

  streetRows.set(streetKey, row);

  return {
    id: `stop-${index + 1}`,
    input: line,
    houseNumber,
    streetKey,
    side: houseNumber % 2 === 0 ? "even" : "odd",
    x: houseNumber,
    y: row * 100 + (houseNumber % 2 === 0 ? 20 : 58),
  } satisfies ParsedStop;
}

export function parseStops(input: string) {
  const streetRows = new Map<string, number>();
  const duplicates: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const stops: ParsedStop[] = [];

  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const key = line.toUpperCase().replace(/\s+/g, " ");

      if (seen.has(key)) {
        duplicates.push(line);
      }

      seen.add(key);

      const parsed = parseStreet(line, index, streetRows);

      if (!parsed) {
        skipped.push(line);
        return;
      }

      stops.push(parsed);
    });

  return { stops, skipped, duplicates };
}

export function optimizeStops(
  input: string,
  options: {
    curbside: boolean;
    routeMode: RouteMode;
    startStopId?: string;
  },
): RouteResult {
  const { stops, skipped, duplicates } = parseStops(input);
  const start = stops.find((stop) => stop.id === options.startStopId) ?? stops[0];
  const remaining = stops.filter((stop) => stop.id !== start?.id);
  let ordered = start ? [start] : [];

  if (options.curbside) {
    const groups = new Map<string, ParsedStop[]>();
    let cursor = start;

    for (const stop of remaining) {
      groups.set(stop.streetKey, [...(groups.get(stop.streetKey) ?? []), stop]);
    }

    const streetGroups = [...groups.values()];

    while (streetGroups.length) {
      const nextGroupIndex = streetGroups.reduce((bestIndex, group, index) => {
        const best = streetGroups[bestIndex];
        const groupCenter = getCentroid(group);
        const bestCenter = getCentroid(best);

        if (!cursor) {
          return bestIndex;
        }

        return getDistance(cursor, groupCenter) < getDistance(cursor, bestCenter)
          ? index
          : bestIndex;
      }, 0);
      const [group] = streetGroups.splice(nextGroupIndex, 1);
      const orderedGroup = orderStreetGroup(group, cursor);

      ordered = [...ordered, ...orderedGroup];
      cursor = orderedGroup.at(-1) ?? cursor;
    }
  } else {
    ordered = [...ordered, ...nearestNeighbor(remaining, start)];
  }

  const returnDistance =
    options.routeMode === "round-trip" && ordered.length > 1
      ? getDistance(ordered.at(-1) as ParsedStop, ordered[0])
      : 0;
  const distance =
    ordered.reduce((total, stop, index) => {
      const previous = ordered[index - 1];

      return previous ? total + getDistance(previous, stop) : total;
    }, 0) + returnDistance;

  return {
    stops: ordered,
    skipped,
    duplicates,
    distance,
    streetCount: new Set(stops.map((stop) => stop.streetKey)).size,
  };
}

export function buildCsv(stops: ParsedStop[]) {
  return [
    "sequence,address,street,curb_side",
    ...stops.map((stop, index) =>
      [
        index + 1,
        `"${stop.input.replaceAll('"', '""')}"`,
        `"${stop.streetKey}"`,
        stop.side,
      ].join(","),
    ),
  ].join("\n");
}
