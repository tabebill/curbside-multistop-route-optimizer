"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteStop } from "@/lib/route-types";
import { currentLocationStopId } from "@/lib/route-types";

type RouteMapProps = {
  apiKey: string;
  stops: RouteStop[];
  currentLocation?: {
    latitude: number;
    longitude: number;
  };
  optimizedStopIds?: string[];
  routePolyline?: string;
  selectedStopId?: string;
  navigationStopId?: string;
  onSelectStop: (stopId: string) => void;
};

export function RouteMap({
  apiKey,
  stops,
  currentLocation,
  optimizedStopIds = [],
  routePolyline,
  selectedStopId,
  navigationStopId,
  onSelectStop,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const [mapError, setMapError] = useState("");

  const coordinateStops = useMemo(
    () =>
      [
        ...(currentLocation
          ? [
              {
                id: currentLocationStopId,
                inputOrder: 0,
                address: "Current location",
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                source: "coordinates" as const,
                status: "valid" as const,
              },
            ]
          : []),
        ...stops,
      ].filter(
        (stop) =>
          stop.latitude !== undefined &&
          stop.longitude !== undefined &&
          stop.status === "valid" &&
          !stop.disabled,
      ),
    [currentLocation, stops],
  );
  const optimizedOrderMap = useMemo(
    () =>
      new Map(
        optimizedStopIds.map((stopId, index) => [stopId, String(index + 1)]),
      ),
    [optimizedStopIds],
  );

  useEffect(() => {
    let disposed = false;

    async function loadMap() {
      if (!apiKey || !mapElementRef.current) {
        return;
      }

      try {
        setOptions({
          key: apiKey,
          v: "weekly",
          libraries: ["places", "geometry"],
        });
        const { Map } = (await importLibrary(
          "maps",
        )) as google.maps.MapsLibrary;
        await importLibrary("places");
        await importLibrary("geometry");

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

    clustererRef.current?.clearMarkers();
    markersRef.current.forEach((marker) => marker.setMap(null));

    const bounds = new google.maps.LatLngBounds();
    const markers = coordinateStops.map((stop, index) => {
      const position = {
        lat: stop.latitude as number,
        lng: stop.longitude as number,
      };
      const marker = new google.maps.Marker({
        position,
        label: {
          text:
            stop.id === currentLocationStopId
              ? "You"
              : optimizedOrderMap.get(stop.id) ?? String(index + 1),
          color: "#ffffff",
          fontSize: stop.id === currentLocationStopId ? "10px" : "11px",
          fontWeight: "700",
        },
        title: stop.address || stop.normalizedAddress || `Stop ${index + 1}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: stop.id === navigationStopId ? 13 : stop.id === selectedStopId ? 12 : 9,
          fillColor:
            stop.id === currentLocationStopId
              ? "#2563eb"
              : stop.id === navigationStopId
                ? "#7c3aed"
                : stop.id === selectedStopId
                ? "#b45309"
                : "#0f766e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      if (stop.id !== currentLocationStopId) {
        marker.addListener("click", () => onSelectStop(stop.id));
      }
      bounds.extend(position);
      return marker;
    });

    markersRef.current = markers;
    clustererRef.current = new MarkerClusterer({ markers, map });

    if (coordinateStops.length === 1) {
      map.setCenter({
        lat: coordinateStops[0].latitude as number,
        lng: coordinateStops[0].longitude as number,
      });
      map.setZoom(12);
    } else if (coordinateStops.length > 1) {
      map.fitBounds(bounds, 56);
    }

    return () => {
      clustererRef.current?.clearMarkers();
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [coordinateStops, optimizedOrderMap, selectedStopId, navigationStopId, onSelectStop]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || typeof google === "undefined") {
      return;
    }

    routePolylineRef.current?.setMap(null);
    routePolylineRef.current = null;

    if (!routePolyline) {
      return;
    }

    const path = google.maps.geometry.encoding.decodePath(routePolyline);

    if (!path.length) {
      return;
    }

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: "#0f766e",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      zIndex: 1,
    });
    const bounds = new google.maps.LatLngBounds();

    path.forEach((point) => bounds.extend(point));
    polyline.setMap(map);
    routePolylineRef.current = polyline;
    if (!navigationStopId) {
      map.fitBounds(bounds, 56);
    }

    return () => {
      polyline.setMap(null);
    };
  }, [routePolyline, navigationStopId]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !navigationStopId || typeof google === "undefined") {
      return;
    }

    const activeStop = coordinateStops.find((stop) => stop.id === navigationStopId);

    if (activeStop?.latitude === undefined || activeStop.longitude === undefined) {
      return;
    }

    map.panTo({
      lat: activeStop.latitude,
      lng: activeStop.longitude,
    });
    map.setZoom(Math.max(map.getZoom() ?? 0, 18));
  }, [coordinateStops, navigationStopId]);

  if (!apiKey) {
    return (
      <div className="flex h-[420px] min-h-[360px] items-center justify-center border border-dashed border-line bg-panel-subtle p-8 text-center text-sm text-muted lg:h-[560px]">
        Google Maps key not configured
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="flex h-[420px] min-h-[360px] items-center justify-center border border-dashed border-line bg-panel-subtle p-8 text-center text-sm text-danger lg:h-[560px]">
        {mapError}
      </div>
    );
  }

  return (
    <div className="relative h-[420px] min-h-[360px] overflow-hidden border border-line bg-panel-subtle lg:h-[560px]">
      <div ref={mapElementRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-line bg-panel/95 px-3 py-2 text-xs font-semibold text-foreground shadow-sm">
        <MapPin className="h-4 w-4 text-accent" />
        {routePolyline
          ? "Optimized route"
          : `${coordinateStops.length.toLocaleString()} mapped`}
      </div>
    </div>
  );
}
