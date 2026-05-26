import type { RouteStop, StopSource, StopStatus } from "@/lib/route-types";

const addressKeys = [
  "property_address",
  "property address",
  "situs_address",
  "situs address",
  "site_address",
  "site address",
  "location_address",
  "location address",
  "parcel_address",
  "parcel address",
  "address",
  "addr",
  "location",
  "street",
  "full_address",
  "full address",
];

const latitudeKeys = ["lat", "latitude", "y"];
const longitudeKeys = ["lng", "lon", "long", "longitude", "x"];
const streetSignals = [
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "box",
  "cir",
  "circle",
  "ct",
  "court",
  "dr",
  "drive",
  "fl",
  "floor",
  "hwy",
  "lane",
  "ln",
  "parkway",
  "pkwy",
  "pl",
  "place",
  "rd",
  "road",
  "st",
  "street",
  "ste",
  "suite",
  "unit",
  "way",
];

export function parseCoordinate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text = String(value).trim();

  if (!text) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isValidLatitude(value: number | undefined) {
  return typeof value === "number" && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number | undefined) {
  return typeof value === "number" && value >= -180 && value <= 180;
}

export function makeStopId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `stop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getField(
  row: Record<string, unknown>,
  candidates: string[],
): string {
  const normalizedRow = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );

  for (const candidate of candidates) {
    const value = normalizedRow.get(normalizeHeader(candidate));

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function tidyAddressText(value: string) {
  return value
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s+,/g, ",")
    .replaceAll(/,\s*/g, ", ")
    .replace(/\b(\d{5})(\d{4})\b/g, "$1-$2")
    .replace(/\b([A-Z]{2})\s+(\d{5})(\d{4})\b/g, "$1 $2-$3")
    .replace(/\bBV\b/g, "BLVD")
    .trim();
}

function hasStreetSignal(value: string) {
  const normalized = value.toLowerCase();

  return (
    /\d/.test(normalized) &&
    streetSignals.some((signal) =>
      new RegExp(`\\b${signal}\\b`, "i").test(normalized),
    )
  );
}

export function normalizeAddressInput(value: string) {
  const trimmed = tidyAddressText(value);

  if (!trimmed.includes("|")) {
    return trimmed;
  }

  const parts = trimmed
    .split("|")
    .map((part) => tidyAddressText(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return trimmed.replaceAll("|", " ");
  }

  const cityState = parts.at(-1) ?? "";
  const streetIndex = parts.findIndex(hasStreetSignal);

  if (streetIndex < 0) {
    return tidyAddressText(parts.join(" "));
  }

  return tidyAddressText([...parts.slice(streetIndex, -1), cityState].join(", "));
}

export function buildStopFromRow(
  row: Record<string, unknown>,
  inputOrder: number,
): RouteStop {
  const address = normalizeAddressInput(getField(row, addressKeys));
  const latitude = parseCoordinate(getField(row, latitudeKeys));
  const longitude = parseCoordinate(getField(row, longitudeKeys));
  const hasValidCoordinates =
    isValidLatitude(latitude) && isValidLongitude(longitude);

  let status: StopStatus = "invalid";
  let source: StopSource = "address";
  let issue: string | undefined;

  if (hasValidCoordinates && address) {
    status = "valid";
    source = "mixed";
  } else if (hasValidCoordinates) {
    status = "valid";
    source = "coordinates";
  } else if (address) {
    status = "needs_address_validation";
    source = "address";
    issue = "Address needs geocoding";
  } else {
    issue = "Missing address or valid coordinates";
  }

  if (!hasValidCoordinates && (latitude !== undefined || longitude !== undefined)) {
    issue = "Coordinates are outside the valid range";
  }

  return {
    id: makeStopId(),
    inputOrder,
    address,
    latitude: hasValidCoordinates ? latitude : undefined,
    longitude: hasValidCoordinates ? longitude : undefined,
    source,
    status,
    issue,
  };
}

export function buildStopFromManualLine(
  line: string,
  inputOrder: number,
): RouteStop | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const coordinateMatch = trimmed.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  );

  if (coordinateMatch) {
    return buildStopFromRow(
      {
        latitude: coordinateMatch[1],
        longitude: coordinateMatch[2],
      },
      inputOrder,
    );
  }

  return buildStopFromRow({ address: trimmed }, inputOrder);
}

function getDedupeKey(stop: RouteStop) {
  return stop.latitude !== undefined && stop.longitude !== undefined
    ? `${stop.latitude.toFixed(6)},${stop.longitude.toFixed(6)}`
    : stop.address.trim().toLowerCase();
}

export function mergeDedupedStops(
  currentStops: RouteStop[],
  nextStops: RouteStop[],
) {
  const firstInputOrderByKey = new Map<string, number>();
  const merged: RouteStop[] = [];
  let duplicateWarnings = 0;

  for (const stop of currentStops) {
    const key = getDedupeKey(stop);

    if (key && !firstInputOrderByKey.has(key)) {
      firstInputOrderByKey.set(key, stop.inputOrder);
    }

    merged.push(stop);
  }

  for (const stop of nextStops) {
    const key = getDedupeKey(stop);
    const duplicateOfInputOrder = key
      ? firstInputOrderByKey.get(key)
      : undefined;

    if (key && duplicateOfInputOrder === undefined) {
      firstInputOrderByKey.set(key, stop.inputOrder);
    }

    if (duplicateOfInputOrder !== undefined) {
      duplicateWarnings += 1;
    }

    merged.push({
      ...stop,
      duplicateOfInputOrder,
    });
  }

  return {
    stops: merged,
    added: merged.length - currentStops.length,
    duplicateWarnings,
  };
}

export function dedupeStops(stops: RouteStop[]) {
  return mergeDedupedStops([], stops).stops;
}
