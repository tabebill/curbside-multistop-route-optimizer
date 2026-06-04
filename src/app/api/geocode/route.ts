import { NextResponse } from "next/server";
import type { GeocodeResult } from "@/lib/types";

type GeocodeBody = {
  addresses?: string[];
};

type GoogleGeocodeResponse = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

const maxAddressesPerRequest = 250;

function getServerKey() {
  return process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;
}

async function geocodeAddress(address: string, key: string): Promise<GeocodeResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");

  url.searchParams.set("address", address);
  url.searchParams.set("key", key);

  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as GoogleGeocodeResponse;
  const result = data.results?.[0];
  const latitude = result?.geometry?.location?.lat;
  const longitude = result?.geometry?.location?.lng;

  if (
    !response.ok ||
    data.status !== "OK" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return {
      input: address,
      status: "failed",
      message: data.error_message || data.status || "Address could not be geocoded",
    };
  }

  return {
    input: address,
    status: "ok",
    formattedAddress: result?.formatted_address || address,
    latitude,
    longitude,
    placeId: result?.place_id,
  };
}

export async function POST(request: Request) {
  const key = getServerKey();
  const body = (await request.json()) as GeocodeBody;
  const addresses = (body.addresses ?? [])
    .map((address) => address.trim())
    .filter(Boolean)
    .slice(0, maxAddressesPerRequest);

  if (!key) {
    return NextResponse.json(
      { error: "Missing GOOGLE_MAPS_SERVER_KEY" },
      { status: 500 },
    );
  }

  if (!addresses.length) {
    return NextResponse.json({ results: [] });
  }

  const results: GeocodeResult[] = [];

  for (const address of addresses) {
    results.push(await geocodeAddress(address, key));
  }

  return NextResponse.json({ results });
}
