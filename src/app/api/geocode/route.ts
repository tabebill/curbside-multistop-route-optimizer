import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRateLimitKey,
} from "@/lib/rate-limit";
import { normalizeAddressInput } from "@/lib/import-utils";
import type { GeocodeResult } from "@/lib/route-types";

const maxAddressesPerRequest = 25;
const geocodeCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
const geocodeCacheVersion = "strict-v3";
const geocodeCache = new Map<
  string,
  { result: GeocodeResult; expiresAt: number }
>();

type GeocodeBody = {
  addresses?: string[];
};

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  partial_match?: boolean;
  place_id?: string;
  types?: string[];
  address_components?: GoogleAddressComponent[];
  geometry?: {
    location_type?: string;
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

function getPostalCode(value: string) {
  const matches = [...value.matchAll(/\b(\d{5})(?:-?(\d{4}))?\b/g)];
  const match = matches.at(-1);

  if (!match) {
    return undefined;
  }

  return {
    zip5: match[1],
    suffix: match[2],
    formatted: match[2] ? `${match[1]}-${match[2]}` : match[1],
  };
}

function getComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
) {
  return components?.find((component) => component.types?.includes(type));
}

function hasSpecificStreetResult(result: GoogleGeocodeResult) {
  const types = new Set(result.types ?? []);
  const components = result.address_components;
  const hasRoute = Boolean(getComponent(components, "route"));
  const hasStreetNumber = Boolean(getComponent(components, "street_number"));
  const hasPremise = Boolean(getComponent(components, "premise"));
  const specificTypes = [
    "street_address",
    "premise",
    "subpremise",
    "establishment",
    "point_of_interest",
  ];

  return (
    specificTypes.some((type) => types.has(type)) ||
    (hasRoute && (hasStreetNumber || hasPremise))
  );
}

function formatGeocodeAddressWithInputZip(
  formattedAddress: string | undefined,
  inputZip: ReturnType<typeof getPostalCode>,
) {
  if (!formattedAddress || !inputZip) {
    return formattedAddress;
  }

  const formattedZip = getPostalCode(formattedAddress);

  if (!formattedZip || formattedZip.zip5 !== inputZip.zip5) {
    return formattedAddress;
  }

  return formattedAddress.replace(formattedZip.formatted, inputZip.formatted);
}

function getGeocodeFailureMessage(
  inputAddress: string,
  result: GoogleGeocodeResult,
) {
  const inputZip = getPostalCode(inputAddress);
  const resultZip = getComponent(result.address_components, "postal_code")
    ?.short_name;
  const resultSuffix = getComponent(result.address_components, "postal_code_suffix")
    ?.short_name;

  if (!hasSpecificStreetResult(result)) {
    return "Google only returned a city-level result; use a routable street address";
  }

  if (result.partial_match) {
    return "Google returned only a partial address match";
  }

  if (inputZip && !resultZip) {
    return "Google did not return a ZIP code for this address";
  }

  if (inputZip && resultZip && inputZip.zip5 !== resultZip) {
    return `ZIP mismatch: imported ${inputZip.zip5}, Google returned ${resultZip}`;
  }

  if (
    inputZip?.suffix &&
    resultSuffix &&
    inputZip.suffix !== resultSuffix
  ) {
    return `ZIP+4 mismatch: imported ${inputZip.formatted}, Google returned ${resultZip}-${resultSuffix}`;
  }

  return undefined;
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getRateLimitKey(request, "geocode"), {
    limit: 80,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many geocoding requests. Try again shortly." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) },
    );
  }

  const body = (await request.json()) as GeocodeBody;
  const apiKey =
    process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const addresses = [
    ...new Set(body.addresses?.map((item) => normalizeAddressInput(item.trim()))),
  ].filter(Boolean);

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing Google Maps server API key" },
      { status: 500 },
    );
  }

  if (!addresses.length) {
    return NextResponse.json({ results: [] satisfies GeocodeResult[] });
  }

  if (addresses.length > maxAddressesPerRequest) {
    return NextResponse.json(
      { error: `Geocoding is limited to ${maxAddressesPerRequest} addresses per request` },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    addresses.map(async (address): Promise<GeocodeResult> => {
      const cacheKey = `${geocodeCacheVersion}:${address.toLowerCase()}`;
      const cached = geocodeCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.result, input: address };
      }

      const params = new URLSearchParams({
        address,
        key: apiKey,
      });

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        status?: string;
        error_message?: string;
        results?: GoogleGeocodeResult[];
      };

      const first = data.results?.[0];
      const location = first?.geometry?.location;

      if (data.status === "OK" && first && location) {
        const failureMessage = getGeocodeFailureMessage(address, first);

        if (failureMessage) {
          const result = {
            input: address,
            status: "failed",
            message: failureMessage,
          } satisfies GeocodeResult;

          geocodeCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + geocodeCacheTtlMs,
          });

          return result;
        }

        const result = {
          input: address,
          status: "ok",
          normalizedAddress: formatGeocodeAddressWithInputZip(
            first.formatted_address,
            getPostalCode(address),
          ),
          latitude: location.lat,
          longitude: location.lng,
          placeId: first.place_id,
        } satisfies GeocodeResult;

        geocodeCache.set(cacheKey, {
          result,
          expiresAt: Date.now() + geocodeCacheTtlMs,
        });

        return result;
      }

      const result = {
        input: address,
        status: "failed",
        message: data.error_message || data.status || "No geocoding result",
      } satisfies GeocodeResult;

      geocodeCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + geocodeCacheTtlMs,
      });

      return result;
    }),
  );

  return NextResponse.json(
    { results },
    { headers: getRateLimitHeaders(rateLimit) },
  );
}
