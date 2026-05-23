"use client";

import { useMemo, useState } from "react";
import { buildCsv, optimizeStops, type ParsedStop, type RouteMode } from "@/lib/route";
import { sampleStops } from "@/lib/sample-data";

function downloadCsv(stops: ParsedStop[]) {
  const blob = new Blob([buildCsv(stops)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "curbside-route.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function getViewBox(stops: ParsedStop[]) {
  if (!stops.length) {
    return "760 0 240 280";
  }

  const minX = Math.min(...stops.map((stop) => stop.x)) - 20;
  const maxX = Math.max(...stops.map((stop) => stop.x)) + 20;
  const minY = Math.min(...stops.map((stop) => stop.y)) - 42;
  const maxY = Math.max(...stops.map((stop) => stop.y)) + 52;

  return `${minX} ${minY} ${Math.max(maxX - minX, 160)} ${Math.max(maxY - minY, 180)}`;
}

function RouteMap({
  stops,
  routeMode,
}: {
  stops: ParsedStop[];
  routeMode: RouteMode;
}) {
  const streets = [...new Map(stops.map((stop) => [stop.streetKey, stop])).values()];
  const path = stops.map((stop) => `${stop.x},${stop.y}`).join(" ");
  const roundTrip =
    routeMode === "round-trip" && stops.length > 1
      ? `${path} ${stops[0].x},${stops[0].y}`
      : path;

  return (
    <div className="h-[430px] overflow-hidden border border-stone-200 bg-[#f9f7f2]">
      <svg
        viewBox={getViewBox(stops)}
        className="h-full w-full"
        role="img"
        aria-label="Optimized route preview"
      >
        <rect x="-2000" y="-2000" width="4000" height="4000" fill="#f9f7f2" />
        {streets.map((street) => (
          <g key={street.streetKey}>
            <line
              x1="740"
              x2="870"
              y1={street.y + (street.side === "even" ? 19 : -19)}
              y2={street.y + (street.side === "even" ? 19 : -19)}
              stroke="#d8d2c4"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <text
              x="744"
              y={street.y + (street.side === "even" ? 3 : -35)}
              fill="#78716c"
              fontSize="9"
              fontWeight="700"
            >
              {street.streetKey}
            </text>
          </g>
        ))}
        {stops.length > 1 ? (
          <polyline
            points={roundTrip}
            fill="none"
            stroke="#0f766e"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {stops.map((stop, index) => (
          <g key={stop.id}>
            <circle
              cx={stop.x}
              cy={stop.y}
              r="9"
              fill={stop.side === "even" ? "#0f766e" : "#c2410c"}
              stroke="#fffaf0"
              strokeWidth="3"
            />
            <text
              x={stop.x}
              y={stop.y + 3}
              textAnchor="middle"
              fill="white"
              fontSize="8"
              fontWeight="800"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function RouteLab() {
  const [input, setInput] = useState(sampleStops);
  const [curbside, setCurbside] = useState(true);
  const [routeMode, setRouteMode] = useState<RouteMode>("round-trip");
  const [startStopId, setStartStopId] = useState<string>();
  const result = useMemo(
    () => optimizeStops(input, { curbside, routeMode, startStopId }),
    [curbside, input, routeMode, startStopId],
  );
  const startValue = startStopId ?? result.stops[0]?.id ?? "";

  return (
    <main className="min-h-screen bg-[#fbfaf7] text-stone-950">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 lg:grid lg:grid-cols-[390px_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-normal">
                  Curbside Route Optimizer
                </h1>
                <p className="mt-1 text-sm text-stone-600">
                  A small street-sweep routing demo for ordered curb delivery.
                </p>
              </div>
              <span className="border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
                API-free
              </span>
            </div>

            <label className="block text-sm font-semibold" htmlFor="stops">
              Stops
            </label>
            <textarea
              id="stops"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              className="mt-2 h-64 w-full resize-none border border-stone-300 bg-stone-50 p-3 font-mono text-xs leading-5 outline-none transition focus:border-teal-600 focus:bg-white"
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setInput(sampleStops)}
                className="h-10 border border-stone-300 bg-white text-sm font-semibold transition hover:bg-stone-100"
              >
                Load sample
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(result.stops)}
                disabled={!result.stops.length}
                className="h-10 bg-stone-950 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Route Settings
            </h2>

            <div className="space-y-4">
              <div>
                <span className="mb-2 block text-sm font-medium">Mode</span>
                <div className="grid grid-cols-2 border border-stone-200 bg-stone-100 p-1">
                  {[
                    ["round-trip", "Round trip"],
                    ["open", "Open route"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRouteMode(value as RouteMode)}
                      className={`h-9 text-sm font-semibold transition ${
                        routeMode === value
                          ? "bg-white text-stone-950 shadow-sm"
                          : "text-stone-600 hover:text-stone-950"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium">Curbside</span>
                <div className="grid grid-cols-2 border border-stone-200 bg-stone-100 p-1">
                  {[
                    [true, "Street sweep"],
                    [false, "Nearest"],
                  ].map(([value, label]) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setCurbside(Boolean(value))}
                      className={`h-9 text-sm font-semibold transition ${
                        curbside === value
                          ? "bg-white text-stone-950 shadow-sm"
                          : "text-stone-600 hover:text-stone-950"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">Start stop</span>
                <select
                  value={startValue}
                  onChange={(event) => setStartStopId(event.target.value)}
                  className="h-10 w-full border border-stone-300 bg-white px-3 text-sm outline-none focus:border-teal-600"
                >
                  {result.stops.map((stop, index) => (
                    <option key={stop.id} value={stop.id}>
                      {index + 1}. {stop.input}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Stops", result.stops.length.toLocaleString()],
              ["Streets", result.streetCount.toLocaleString()],
              ["Duplicates", result.duplicates.length.toLocaleString()],
              ["Route score", Math.round(result.distance).toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} className="border border-stone-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {label}
                </div>
                <div className="mt-2 text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <RouteMap stops={result.stops} routeMode={routeMode} />

          {result.duplicates.length || result.skipped.length ? (
            <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {result.duplicates.length ? (
                <p>{result.duplicates.length} duplicate stop line found.</p>
              ) : null}
              {result.skipped.length ? (
                <p>{result.skipped.length} line could not be parsed into a street stop.</p>
              ) : null}
            </div>
          ) : null}

          <div className="border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Optimized Stop Order
              </h2>
              <span className="text-sm text-stone-500">
                {curbside ? "same curb, then opposite curb" : "nearest-neighbor demo"}
              </span>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="w-16 px-4 py-3">#</th>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">Street</th>
                    <th className="px-4 py-3">Curb</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stops.map((stop, index) => (
                    <tr key={stop.id} className="border-t border-stone-100">
                      <td className="px-4 py-3 font-semibold text-stone-500">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3 font-medium">{stop.input}</td>
                      <td className="px-4 py-3 text-stone-600">{stop.streetKey}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex min-w-16 justify-center px-2 py-1 text-xs font-semibold ${
                            stop.side === "even"
                              ? "bg-teal-50 text-teal-800"
                              : "bg-orange-50 text-orange-800"
                          }`}
                        >
                          {stop.side}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
