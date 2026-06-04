"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileUp,
  LocateFixed,
  MapPinned,
  Maximize2,
  MousePointer2,
  Route,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { PinMap } from "@/components/pin-map";
import type {
  GeocodeResult,
  OptimizedPinsRoute,
  ParsedStop,
  PinStop,
} from "@/lib/types";

type PinWorkspaceProps = {
  googleMapsBrowserKey: string;
};

type GeocodeResponse = {
  results?: GeocodeResult[];
  error?: string;
};

type OptimizeResponse = OptimizedPinsRoute & {
  error?: string | { message?: string };
};

function parseStops(input: string): ParsedStop[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `stop-${index + 1}`,
      inputOrder: index + 1,
      input: line,
    }));
}

function getErrorMessage(data: GeocodeResponse | OptimizeResponse, fallback: string) {
  if (!data.error) {
    return fallback;
  }

  return typeof data.error === "string" ? data.error : data.error.message || fallback;
}

function getValidStops(stops: PinStop[]) {
  return stops.filter(
    (
      stop,
    ): stop is PinStop & { latitude: number; longitude: number } =>
      stop.status === "ok" &&
      Number.isFinite(stop.latitude) &&
      Number.isFinite(stop.longitude),
  );
}

function getDistanceMeters(
  from: PinStop & { latitude: number; longitude: number },
  to: PinStop & { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6_371_000;
  const fromLat = (from.latitude * Math.PI) / 180;
  const toLat = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) *
      Math.cos(toLat) *
      Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function formatDistance(meters: number) {
  if (meters < 1609.344) {
    return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  }

  return `${(meters / 1609.344).toFixed(1)} mi`;
}

export function PinWorkspace({ googleMapsBrowserKey }: PinWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [stops, setStops] = useState<PinStop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [routeIsOptimized, setRouteIsOptimized] = useState(false);
  const [overviewSignal, setOverviewSignal] = useState(0);
  const [isPending, startTransition] = useTransition();
  const parsedStops = useMemo(() => parseStops(rawInput), [rawInput]);
  const validCount = stops.filter((stop) => stop.status === "ok").length;
  const failedCount = stops.filter((stop) => stop.status === "failed").length;
  const selectedStop = stops.find((stop) => stop.id === selectedStopId);
  const validStops = useMemo(() => getValidStops(stops), [stops]);
  const currentStopIndex = Math.max(
    0,
    validStops.findIndex((stop) => stop.id === selectedStopId),
  );
  const currentStop = validStops[currentStopIndex];
  const nextStop = validStops[currentStopIndex + 1];
  const segmentSize = 25;
  const segmentIndex = Math.floor(currentStopIndex / (segmentSize - 1));
  const segmentStart = segmentIndex * (segmentSize - 1) + 1;
  const segmentEnd = Math.min(segmentStart + segmentSize - 1, validStops.length);
  const nextDistanceMeters =
    currentStop && nextStop ? getDistanceMeters(currentStop, nextStop) : undefined;

  function selectStopAtIndex(index: number) {
    const stop = validStops[index];

    if (stop) {
      setSelectedStopId(stop.id);
    }
  }

  async function previewPins() {
    const nextParsedStops = parseStops(rawInput);

    if (!nextParsedStops.length) {
      setNotice("Paste or import at least one address.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            addresses: nextParsedStops.map((stop) => stop.input),
          }),
        });
        const data = (await response.json()) as GeocodeResponse;

        if (!response.ok) {
          throw new Error(getErrorMessage(data, "Geocoding failed"));
        }

        const results = data.results ?? [];
        const nextStops = nextParsedStops.map((stop, index): PinStop => {
          const result = results[index];

          if (!result || result.status !== "ok") {
            return {
              ...stop,
              status: "failed",
              address: stop.input,
              message: result?.message || "Unable to locate this stop",
            };
          }

          return {
            ...stop,
            status: "ok",
            address: result.formattedAddress || stop.input,
            latitude: result.latitude,
            longitude: result.longitude,
            placeId: result.placeId,
          };
        });

        setStops(nextStops);
        setSelectedStopId(nextStops.find((stop) => stop.status === "ok")?.id);
        setRouteIsOptimized(false);
        setOverviewSignal((current) => current + 1);
        setNotice(
          `Previewed ${nextStops.filter((stop) => stop.status === "ok").length.toLocaleString()} pins.`,
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to preview pins");
      }
    });
  }

  function importFile(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setRawInput(String(reader.result ?? ""));
      setRouteIsOptimized(false);
      setOverviewSignal((current) => current + 1);
      setNotice(`Imported ${file.name}`);
    };
    reader.readAsText(file);
  }

  function optimizeRoute() {
    if (validCount < 2) {
      setNotice("Preview at least two mapped pins before optimizing.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops }),
        });
        const data = (await response.json()) as OptimizeResponse;

        if (!response.ok) {
          throw new Error(getErrorMessage(data, "Route optimization failed"));
        }

        const orderIndex = new Map(
          data.orderedStopIds.map((stopId, index) => [stopId, index]),
        );
        const orderedValidStops = stops
          .filter((stop) => stop.status === "ok" && orderIndex.has(stop.id))
          .sort(
            (left, right) =>
              (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER),
          )
          .map((stop, index) => ({ ...stop, inputOrder: index + 1 }));
        const trailingStops = stops
          .filter((stop) => stop.status !== "ok" || !orderIndex.has(stop.id))
          .map((stop, index) => ({
            ...stop,
            inputOrder: orderedValidStops.length + index + 1,
          }));
        const nextStops = [...orderedValidStops, ...trailingStops];

        setStops(nextStops);
        setSelectedStopId(nextStops.find((stop) => stop.status === "ok")?.id);
        setRouteIsOptimized(true);
        setOverviewSignal((current) => current + 1);
        setNotice(
          `Optimized ${orderedValidStops.length.toLocaleString()} pins with Google Route Optimization.`,
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to optimize route");
      }
    });
  }

  return (
    <main className="min-h-screen bg-app text-foreground">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center bg-foreground text-white">
              <MapPinned className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Multi-Stop Pins</h1>
              <p className="text-sm text-muted">
                Numbered Google Maps route preview and in-app navigation
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="border border-line bg-panel-subtle px-3 py-1.5">
              {parsedStops.length.toLocaleString()} entered
            </span>
            <span className="border border-line bg-panel-subtle px-3 py-1.5">
              {validCount.toLocaleString()} mapped
            </span>
            {failedCount ? (
              <span className="border border-danger/30 bg-danger/10 px-3 py-1.5 text-danger">
                {failedCount.toLocaleString()} failed
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[410px_minmax(0,1fr)]">
        <section className="space-y-4 xl:sticky xl:top-4 xl:h-[calc(100vh-32px)] xl:overflow-auto">
          <div className="border border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                Stops
              </h2>
              <LocateFixed className="h-4 w-4 text-muted" />
            </div>
            <textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="Paste one address per line"
              className="h-64 w-full resize-y border border-line bg-white p-3 text-sm leading-6 outline-none focus:border-accent"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={previewPins}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center gap-2 bg-foreground px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                <MapPinned className="h-4 w-4" />
                {isPending ? "Mapping..." : "Preview Pins"}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-10 items-center justify-center gap-2 border border-line bg-panel-subtle px-3 text-sm font-semibold hover:border-accent"
              >
                <FileUp className="h-4 w-4" />
                Import
              </button>
            </div>
            <button
              type="button"
              onClick={optimizeRoute}
              disabled={isPending || validCount < 2}
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 border border-accent bg-accent px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Route className="h-4 w-4" />
              {isPending ? "Working..." : "Optimize Route"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv"
              className="hidden"
              onChange={(event) => importFile(event.target.files?.[0])}
            />
            {notice ? (
              <div className="mt-3 border border-line bg-panel-subtle px-3 py-2 text-sm text-muted">
                {notice}
              </div>
            ) : null}
          </div>

          {currentStop ? (
            <div className="border border-line bg-panel p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted">
                    Navigation
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    Stop {(currentStopIndex + 1).toLocaleString()} of{" "}
                    {validStops.length.toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOverviewSignal((current) => current + 1)}
                  className="inline-flex h-9 w-9 items-center justify-center border border-line bg-panel-subtle hover:border-accent"
                  title="Route overview"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>

              <div className="border border-line bg-panel-subtle p-3">
                <div className="text-sm font-semibold">{currentStop.address}</div>
                <div className="mt-2 text-xs text-muted">
                  Segment {segmentIndex + 1}: stops{" "}
                  {segmentStart.toLocaleString()}-{segmentEnd.toLocaleString()}
                </div>
                {nextStop && nextDistanceMeters !== undefined ? (
                  <div className="mt-1 text-xs text-muted">
                    Next: {nextStop.address} · about{" "}
                    {formatDistance(nextDistanceMeters)}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-muted">
                    Final mapped stop
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectStopAtIndex(currentStopIndex - 1)}
                  disabled={currentStopIndex <= 0}
                  className="inline-flex h-10 items-center justify-center gap-2 border border-line bg-panel-subtle px-3 text-sm font-semibold hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => selectStopAtIndex(currentStopIndex + 1)}
                  disabled={currentStopIndex >= validStops.length - 1}
                  className="inline-flex h-10 items-center justify-center gap-2 bg-foreground px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          {selectedStop ? (
            <div className="border border-line bg-panel p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <MousePointer2 className="h-4 w-4 text-accent" />
                Selected Pin
              </div>
              <div className="text-sm font-semibold">
                {selectedStop.inputOrder}. {selectedStop.address}
              </div>
              <div className="mt-2 font-mono text-xs text-muted">
                {selectedStop.latitude?.toFixed(6)},{" "}
                {selectedStop.longitude?.toFixed(6)}
              </div>
            </div>
          ) : null}

          {stops.length ? (
            <div className="border border-line bg-panel">
              <div className="border-b border-line p-4">
                <h2 className="text-sm font-semibold uppercase text-muted">
                  Pin List
                </h2>
              </div>
              <ol className="max-h-96 overflow-auto">
                {stops.map((stop, index) => (
                  <li key={stop.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSelectedStopId(stop.id)}
                      className="grid w-full grid-cols-[2rem_minmax(0,1fr)_1.25rem] gap-2 px-4 py-3 text-left text-sm hover:bg-panel-subtle"
                    >
                      <span className="flex h-7 w-7 items-center justify-center bg-accent font-mono text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {stop.address}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {stop.input}
                        </span>
                      </span>
                      {stop.status === "ok" ? (
                        <CheckCircle2 className="mt-1 h-4 w-4 text-accent" />
                      ) : (
                        <AlertTriangle className="mt-1 h-4 w-4 text-danger" />
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <section>
          <PinMap
            apiKey={googleMapsBrowserKey}
            stops={stops}
            showRouteLines={routeIsOptimized}
            selectedStopId={selectedStopId}
            overviewSignal={overviewSignal}
            onSelectStop={setSelectedStopId}
          />
        </section>
      </div>
    </main>
  );
}
