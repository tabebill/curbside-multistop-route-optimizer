import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.ROUTE_SAMPLE_BASE_URL ?? "http://localhost:3000";
const sampleFile = process.env.ROUTE_SAMPLE_FILE ?? "sample-addresses.txt";
const timeoutMs = Number(process.env.ROUTE_SAMPLE_UI_TIMEOUT_MS ?? 20_000);
const addresses = readFileSync(sampleFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

function getMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1];
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
    const routeReview = /Review \d+ route/.test(bodyText);
    const result = {
      sampleFile,
      addressCount: addresses.length,
      uiStopCount: stopCount,
      hasLastSequence,
      routeReview,
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

    if (routeReview) {
      throw new Error("UI verification failed: route review warning is visible.");
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
