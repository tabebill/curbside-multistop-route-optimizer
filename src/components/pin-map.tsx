"use client";

import { MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PinStop } from "@/lib/types";

type PinMapProps = {
  apiKey: string;
  stops: PinStop[];
  showRouteLines?: boolean;
  selectedStopId?: string;
  overviewSignal?: number;
  onSelectStop: (stopId: string) => void;
};

export function PinMap({
  apiKey,
  stops,
  showRouteLines = false,
  selectedStopId,
  overviewSignal = 0,
  onSelectStop,
}: PinMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const directionsPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const [mapError, setMapError] = useState("");
  const validStops = useMemo(
    () =>
      stops.filter(
        (
          stop,
        ): stop is PinStop & { latitude: number; longitude: number } =>
          stop.status === "ok" &&
          Number.isFinite(stop.latitude) &&
          Number.isFinite(stop.longitude),
      ),
    [stops],
  );

  useEffect(() => {
    let disposed = false;

    async function loadMap() {
      if (!apiKey || !mapElementRef.current) {
        return;
      }

      try {
        const { importLibrary, setOptions } = await import(
          "@googlemaps/js-api-loader"
        );

        setOptions({ key: apiKey, v: "weekly" });
        const { Map } = (await importLibrary(
          "maps",
        )) as google.maps.MapsLibrary;

        if (disposed || !mapElementRef.current) {
          return;
        }

        mapRef.current = new Map(mapElementRef.current, {
          center: { lat: 39.8283, lng: -98.5795 },
          zoom: 4,
          clickableIcons: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          backgroundColor: "#eef4f1",
        });
      } catch (error) {
        setMapError(
          error instanceof Error ? error.message : "Unable to load Google Maps",
        );
      }
    }

    loadMap();

    return () => {
      disposed = true;
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || typeof google === "undefined") {
      return;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (!validStops.length) {
      map.setCenter({ lat: 39.8283, lng: -98.5795 });
      map.setZoom(4);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    const infoWindow = new google.maps.InfoWindow();
    const markers = validStops.map((stop, index) => {
      const position = { lat: stop.latitude, lng: stop.longitude };
      const marker = new google.maps.Marker({
        position,
        map,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: "700",
        },
        title: stop.address,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#0f766e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        onSelectStop(stop.id);
        infoWindow.setContent(
          `<strong>${index + 1}. ${stop.address}</strong><br/><span>${stop.input}</span>`,
        );
        infoWindow.open({ anchor: marker, map });
      });
      bounds.extend(position);
      return marker;
    });

    markersRef.current = markers;

    if (validStops.length === 1) {
      map.setCenter({ lat: validStops[0].latitude, lng: validStops[0].longitude });
      map.setZoom(16);
    } else {
      map.fitBounds(bounds, 64);
    }

    return () => {
      infoWindow.close();
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [validStops, onSelectStop]);

  useEffect(() => {
    if (typeof google === "undefined") {
      return;
    }

    markersRef.current.forEach((marker, index) => {
      const stop = validStops[index];
      const isSelected = stop?.id === selectedStopId;

      marker.setIcon({
        path: google.maps.SymbolPath.CIRCLE,
        scale: isSelected ? 13 : 10,
        fillColor: isSelected ? "#b45309" : "#0f766e",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      });
    });
  }, [selectedStopId, validStops]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !selectedStopId || typeof google === "undefined") {
      return;
    }

    const selectedStop = validStops.find((stop) => stop.id === selectedStopId);

    if (!selectedStop) {
      return;
    }

    map.panTo({ lat: selectedStop.latitude, lng: selectedStop.longitude });
    map.setZoom(Math.max(map.getZoom() ?? 0, 18));
  }, [selectedStopId, validStops]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !validStops.length || typeof google === "undefined") {
      return;
    }

    const bounds = new google.maps.LatLngBounds();

    validStops.forEach((stop) =>
      bounds.extend({ lat: stop.latitude, lng: stop.longitude }),
    );

    if (validStops.length === 1) {
      map.setCenter({ lat: validStops[0].latitude, lng: validStops[0].longitude });
      map.setZoom(16);
    } else {
      map.fitBounds(bounds, 64);
    }
  }, [overviewSignal, validStops]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || typeof google === "undefined") {
      return;
    }

    directionsPolylinesRef.current.forEach((polyline) => polyline.setMap(null));
    directionsPolylinesRef.current = [];

    if (!showRouteLines || validStops.length < 2) {
      return;
    }

    let disposed = false;
    const activeMap = map;
    const directionsService = new google.maps.DirectionsService();
    const bounds = new google.maps.LatLngBounds();
    const maxStopsPerDirectionsRequest = 25;
    const maxIntermediateWaypointsPerRequest = maxStopsPerDirectionsRequest - 2;

    validStops.forEach((stop) =>
      bounds.extend({ lat: stop.latitude, lng: stop.longitude }),
    );
    activeMap.fitBounds(bounds, 64);

    async function drawRouteChunks() {
      for (
        let startIndex = 0;
        startIndex < validStops.length - 1;
        startIndex += maxStopsPerDirectionsRequest - 1
      ) {
        const chunk = validStops.slice(
          startIndex,
          Math.min(
            validStops.length,
            startIndex + maxIntermediateWaypointsPerRequest + 2,
          ),
        );
        const origin = chunk[0];
        const destination = chunk.at(-1);

        if (!origin || !destination) {
          continue;
        }

        const result = await directionsService.route({
          origin: { lat: origin.latitude, lng: origin.longitude },
          destination: { lat: destination.latitude, lng: destination.longitude },
          waypoints: chunk.slice(1, -1).map((stop) => ({
            location: { lat: stop.latitude, lng: stop.longitude },
            stopover: true,
          })),
          optimizeWaypoints: false,
          travelMode: google.maps.TravelMode.DRIVING,
        });

        if (disposed) {
          return;
        }

        const path = result.routes[0]?.overview_path ?? [];

        if (!path.length) {
          continue;
        }

        const polyline = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: "#0f766e",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          zIndex: 1,
        });

        path.forEach((point) => bounds.extend(point));
        polyline.setMap(activeMap);
        directionsPolylinesRef.current.push(polyline);
        activeMap.fitBounds(bounds, 64);
      }
    }

    drawRouteChunks().catch((error: unknown) => {
      if (!disposed) {
        setMapError(
          error instanceof Error
            ? error.message
            : "Unable to draw route lines",
        );
      }
    });

    return () => {
      disposed = true;
      directionsPolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      directionsPolylinesRef.current = [];
    };
  }, [validStops, showRouteLines]);

  if (!apiKey) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-dashed border-line bg-panel-subtle p-8 text-center text-sm text-muted">
        Add a Google Maps browser key to preview pins.
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="flex min-h-[520px] items-center justify-center border border-dashed border-line bg-panel-subtle p-8 text-center text-sm text-danger">
        {mapError}
      </div>
    );
  }

  return (
    <div className="relative min-h-[520px] overflow-hidden border border-line bg-panel-subtle">
      <div ref={mapElementRef} className="h-[calc(100vh-132px)] min-h-[520px] w-full" />
      <div className="absolute left-3 top-3 inline-flex items-center gap-2 border border-line bg-panel/95 px-3 py-2 text-xs font-semibold shadow-sm">
        <MapPin className="h-4 w-4 text-accent" />
        {showRouteLines && validStops.length > 1
          ? "Optimized route"
          : `${validStops.length.toLocaleString()} pins`}
      </div>
    </div>
  );
}
