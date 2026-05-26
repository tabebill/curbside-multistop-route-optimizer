import type { OptimizedRoute, RouteStop } from "@/lib/route-types";

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function getStopLabel(stop: RouteStop) {
  return (
    stop.address ||
    stop.normalizedAddress ||
    [stop.latitude, stop.longitude]
      .filter((value) => value !== undefined)
      .join(", ")
  );
}

export function buildOrderedStops(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  if (!optimizedRoute?.visitOrder.length) {
    return stops;
  }

  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const orderedIds = new Set(optimizedRoute.visitOrder.map((visit) => visit.stopId));
  const ordered = optimizedRoute.visitOrder
    .map((visit) => byId.get(visit.stopId))
    .filter((stop): stop is RouteStop => Boolean(stop));

  return [...ordered, ...stops.filter((stop) => !orderedIds.has(stop.id))];
}

export function buildStopsCsv(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  const ordered = buildOrderedStops(stops, optimizedRoute);
  const sequenceById = new Map(
    optimizedRoute?.visitOrder.map((visit) => [visit.stopId, visit.sequence]) ?? [],
  );
  const rows = [
    [
      "sequence",
      "address",
      "normalized_address",
      "latitude",
      "longitude",
      "place_id",
      "status",
      "disabled",
      "pinned",
      "notes",
    ],
    ...ordered.map((stop, index) => [
      sequenceById.get(stop.id) ?? index + 1,
      stop.address,
      stop.normalizedAddress,
      stop.latitude,
      stop.longitude,
      stop.placeId,
      stop.status,
      stop.disabled ? "yes" : "no",
      stop.pinned ? "yes" : "no",
      stop.notes,
    ]),
  ];

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function buildRouteJson(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      stopCount: stops.length,
      optimizedRoute,
      stops: buildOrderedStops(stops, optimizedRoute),
    },
    null,
    2,
  );
}

export function buildKml(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  const ordered = buildOrderedStops(stops, optimizedRoute).filter(
    (stop) => stop.latitude !== undefined && stop.longitude !== undefined,
  );
  const coordinates = ordered
    .map((stop) => `${stop.longitude},${stop.latitude},0`)
    .join(" ");
  const placemarks = ordered
    .map(
      (stop, index) => `
    <Placemark>
      <name>${escapeXml(`${index + 1}. ${getStopLabel(stop)}`)}</name>
      <Point><coordinates>${stop.longitude},${stop.latitude},0</coordinates></Point>
    </Placemark>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Multi-stop route</name>
    <Placemark>
      <name>Route path</name>
      <LineString><tessellate>1</tessellate><coordinates>${coordinates}</coordinates></LineString>
    </Placemark>${placemarks}
  </Document>
</kml>`;
}

export function buildGpx(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  const ordered = buildOrderedStops(stops, optimizedRoute).filter(
    (stop) => stop.latitude !== undefined && stop.longitude !== undefined,
  );
  const routePoints = ordered
    .map(
      (stop) => `
      <rtept lat="${stop.latitude}" lon="${stop.longitude}">
        <name>${escapeXml(getStopLabel(stop))}</name>
      </rtept>`,
    )
    .join("");
  const waypoints = ordered
    .map(
      (stop) => `
    <wpt lat="${stop.latitude}" lon="${stop.longitude}">
      <name>${escapeXml(getStopLabel(stop))}</name>
    </wpt>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Multi-Stop Route Optimizer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Multi-stop route</name></metadata>${waypoints}
  <rte>
    <name>Optimized route</name>${routePoints}
  </rte>
</gpx>`;
}

export function buildPrintableRouteHtml(
  routeName: string,
  stops: RouteStop[],
  optimizedRoute?: OptimizedRoute,
) {
  const ordered = buildOrderedStops(stops, optimizedRoute);
  const rows = ordered
    .map(
      (stop, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeXml(getStopLabel(stop))}</td>
          <td>${stop.latitude ?? ""}</td>
          <td>${stop.longitude ?? ""}</td>
          <td>${escapeXml(stop.status)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(routeName)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #12201d; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      .meta { color: #586662; margin-bottom: 24px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #cfd8d4; padding: 6px 8px; text-align: left; }
      th { background: #eef4f1; }
    </style>
  </head>
  <body>
    <h1>${escapeXml(routeName)}</h1>
    <div class="meta">
      ${ordered.length.toLocaleString()} stops
      ${
        optimizedRoute
          ? ` - ${(optimizedRoute.distanceMeters / 1609.344).toFixed(1)} miles - ${Math.round(
              optimizedRoute.durationSeconds / 60,
            ).toLocaleString()} minutes`
          : ""
      }
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Stop</th>
          <th>Latitude</th>
          <th>Longitude</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

export function buildGoogleMapsUrls(stops: RouteStop[], optimizedRoute?: OptimizedRoute) {
  const ordered = buildOrderedStops(stops, optimizedRoute).filter(
    (stop) => !stop.disabled && stop.latitude !== undefined && stop.longitude !== undefined,
  );
  const urls: string[] = [];
  const chunkSize = 10;

  for (let start = 0; start < ordered.length - 1; start += chunkSize - 1) {
    const chunk = ordered.slice(start, start + chunkSize);
    const origin = chunk[0];
    const destination = chunk.at(-1);
    const waypoints = chunk.slice(1, -1);

    if (!origin || !destination) {
      continue;
    }

    const params = new URLSearchParams({
      api: "1",
      travelmode: "driving",
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
    });

    if (waypoints.length) {
      params.set(
        "waypoints",
        waypoints
          .map((stop) => `${stop.latitude},${stop.longitude}`)
          .join("|"),
      );
    }

    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }

  return urls;
}

export function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
