import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  buildLocalOptimizedStopSequenceForTesting,
  normalizeOptimizeToursResponse,
} from "@/lib/route-optimization";
import type { CoordinateStop, EndMode, RouteOptimizationMode } from "@/lib/route-types";

const baseUrl = process.env.ROUTE_SAMPLE_BASE_URL ?? "http://localhost:3000";
const sampleFile = process.env.ROUTE_SAMPLE_FILE ?? "sample-addresses.txt";
const sampleStopsFile =
  process.env.ROUTE_SAMPLE_STOPS_FILE ?? "scripts/fixtures/sample-stops.json";
const useLiveApi = process.env.ROUTE_SAMPLE_UI_USE_LIVE_API === "1";
const timeoutMs = Number(process.env.ROUTE_SAMPLE_UI_TIMEOUT_MS ?? 60_000);
const addresses = readFileSync(sampleFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const expectedFirstTenInputIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12];
const expectedFirstTenLabels = expectedFirstTenInputIndexes.map(
  (index) => addresses[index],
);
const addressIndexByInput = new Map(
  addresses.map((address, index) => [address.toLowerCase(), index]),
);

function getMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1];
}

function readFixtureStops() {
  if (!existsSync(sampleStopsFile)) {
    throw new Error(`Missing sample stops fixture: ${sampleStopsFile}`);
  }

  const fixture = JSON.parse(readFileSync(sampleStopsFile, "utf8")) as {
    stops?: CoordinateStop[];
  };

  if (!fixture.stops?.length) {
    throw new Error(`Sample stops fixture has no stops: ${sampleStopsFile}`);
  }

  return fixture.stops;
}

async function installOfflineApiMocks(
  page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>,
) {
  if (useLiveApi) {
    return;
  }

  const fixtureStops = readFixtureStops();

  await page.route("**/api/geocode", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      addresses?: string[];
    };
    const results = (requestBody.addresses ?? []).map((address) => {
      const index = addressIndexByInput.get(address.toLowerCase());
      const stop = index === undefined ? undefined : fixtureStops[index];

      if (!stop) {
        return {
          input: address,
          status: "failed" as const,
          message: "No offline geocode fixture for this sample address",
        };
      }

      return {
        input: address,
        normalizedAddress: stop.label,
        latitude: stop.latitude,
        longitude: stop.longitude,
        status: "ok" as const,
      };
    });

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results }),
    });
  });

  await page.route("**/api/route-optimization/optimize", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      stops?: CoordinateStop[];
      startStopId?: string;
      endMode?: EndMode;
      endStopId?: string;
      routeOptimizationMode?: RouteOptimizationMode;
    };
    const stops = requestBody.stops ?? [];
    const ordered = buildLocalOptimizedStopSequenceForTesting({
      stops,
      startStopId: requestBody.startStopId,
      endMode: requestBody.endMode,
      endStopId: requestBody.endStopId,
      routeOptimizationMode: requestBody.routeOptimizationMode,
    });
    const start = ordered[0];
    const end =
      requestBody.endMode === "round_trip"
        ? start
        : requestBody.endMode === "selected_stop"
          ? ordered.find((stop) => stop.id === requestBody.endStopId)
          : undefined;
    const fixedStopIds = new Set([start?.id, end?.id].filter(Boolean));
    const shipmentStops = ordered.filter((stop) => !fixedStopIds.has(stop.id));
    const routeResponse = normalizeOptimizeToursResponse(
      {
        routes: [
          {
            visits: shipmentStops.map((_, shipmentIndex) => ({ shipmentIndex })),
          },
        ],
      },
      shipmentStops,
      { start, end },
    );

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(routeResponse),
    });
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  try {
    await installOfflineApiMocks(page);
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle", timeout: timeoutMs });
    await page.locator("textarea").first().fill(addresses.join("\n"));
    await page.getByRole("button", { name: /Add Stops/i }).click();
    await page.getByRole("button", { name: /^Validate$/i }).click();
    await page.waitForFunction(
      () => document.body.innerText.includes("VALID"),
      undefined,
      { timeout: timeoutMs },
    );

    if (await page.getByRole("button", { name: /Accept Google Results/i }).count()) {
      await page.getByRole("button", { name: /Accept Google Results/i }).first().click();
      await page.waitForFunction(
        () => document.body.innerText.includes("accepted from Google"),
        undefined,
        { timeout: timeoutMs },
      );
    }

    await page.getByRole("button", { name: /Optimize Route/i }).click();
    await page.waitForFunction(
      (expectedCount) =>
        document.body.innerText.includes(`Stop 1 of ${expectedCount}`),
      addresses.length,
      { timeout: timeoutMs },
    );

    const bodyText = await page.locator("body").innerText();
    const navigationText = bodyText.slice(
      bodyText.indexOf("NAVIGATION"),
      bodyText.indexOf("EXPORT"),
    );
    const stopCount = Number(getMatch(navigationText, /Stop 1 of (\d+)/));
    const hasLastSequence = new RegExp(`\\n${addresses.length}\\n`).test(
      navigationText,
    );
    const routeQualityClean = bodyText.includes("Route quality clean");
    const routeQualityReview = bodyText.includes("Route quality review");
    const hasContinuity = /Continuity:\s+100%/.test(bodyText);
    const renderedFirstTenStops = await page
      .locator("h2", { hasText: /Navigation/i })
      .locator("xpath=ancestor::div[contains(@class,'border')][1]")
      .locator("ol li")
      .evaluateAll((items) =>
        items
          .slice(0, 10)
          .map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? ""),
      );
    const expectedFirstTenInOrder = expectedFirstTenLabels.every(
      (label, index) => renderedFirstTenStops[index]?.includes(label),
    );
    const result = {
      sampleFile,
      addressCount: addresses.length,
      uiStopCount: stopCount,
      hasLastSequence,
      expectedFirstTenInputSequence: expectedFirstTenInputIndexes.map(
        (index) => String(index + 1),
      ),
      renderedFirstTenStops,
      expectedFirstTenInOrder,
      routeQualityClean,
      routeQualityReview,
      hasContinuity,
      consoleErrors: consoleErrors.slice(0, 5),
    };

    console.log(JSON.stringify(result, null, 2));

    if (stopCount !== addresses.length) {
      throw new Error(
        `UI verification failed: expected ${addresses.length} visits, got ${stopCount}`,
      );
    }

    if (!hasLastSequence) {
      throw new Error("UI verification failed: navigation did not include the final sequence.");
    }

    if (!expectedFirstTenInOrder) {
      throw new Error("UI verification failed: sample route first ten sequence drifted.");
    }

    if (!routeQualityClean || routeQualityReview || !hasContinuity) {
      throw new Error("UI verification failed: route quality summary is not clean.");
    }

    if (consoleErrors.length) {
      throw new Error("UI verification failed: browser console errors were emitted.");
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
