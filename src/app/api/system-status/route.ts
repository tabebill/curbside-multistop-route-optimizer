import { existsSync } from "node:fs";
import { NextResponse } from "next/server";

export async function GET() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  return NextResponse.json({
    mapsKey: Boolean(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ||
        process.env.GOOGLE_MAPS_API_KEY,
    ),
    serverMapsKey: Boolean(
      process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY,
    ),
    projectId: Boolean(process.env.GOOGLE_CLOUD_PROJECT_ID),
    serviceAccount: Boolean(credentialPath && existsSync(credentialPath)),
    routeOptimizationBucket: Boolean(process.env.GOOGLE_ROUTE_OPTIMIZATION_BUCKET),
  });
}
