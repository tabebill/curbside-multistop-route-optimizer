"use client";

import Papa from "papaparse";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Loader2,
  MapPin,
  PauseCircle,
  PencilLine,
  Pin,
  Play,
  Plus,
  Route,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { RouteMap } from "@/components/route-map";
import {
  buildGpx,
  buildKml,
  buildOrderedStops,
  buildPrintableRouteHtml,
  buildRouteJson,
  buildStopsCsv,
  downloadText,
} from "@/lib/export-utils";
import {
  buildStopFromManualLine,
  buildStopFromRow,
  isValidLatitude,
  isValidLongitude,
  mergeDedupedStops,
  normalizeAddressInput,
  parseCoordinate,
} from "@/lib/import-utils";
import { maxRouteStops } from "@/lib/route-optimization";
import type {
  BatchOptimizationJob,
  CoordinateStop,
  EndMode,
  GeocodeResult,
  OptimizedRoute,
  RouteOptimizationMode,
  RouteStop,
  StopStatus,
} from "@/lib/route-types";
import { currentLocationStopId } from "@/lib/route-types";

type RouteWorkspaceProps = {
  googleMapsBrowserKey: string;
};

type SystemStatus = {
  mapsKey: boolean;
  serverMapsKey: boolean;
  projectId: boolean;
  serviceAccount: boolean;
  routeOptimizationBucket: boolean;
};

type OptimizationValidation = {
  validatedStops: number;
  validationErrors: unknown[];
};

type OptimizeError = {
  error?: { message?: string } | string;
  message?: string;
};

type BatchStatusResponse =
  | {
      status: "running" | "submitted";
      operationName: string;
      message?: string;
    }
  | {
      status: "failed";
      operationName: string;
      error?: { message?: string } | string;
    }
  | {
      status: "completed";
      operationName: string;
      outputObject?: string;
      route: OptimizedRoute;
    };

type SavedWorkspace = {
  routeName: string;
  curbsideRouting?: boolean;
  routeOptimizationMode?: RouteOptimizationMode;
  startMode?: StartMode;
  endMode: EndMode;
  startStopId: string;
  endStopId: string;
  currentLocation?: CurrentLocation;
  stops: RouteStop[];
  optimizedRoute?: OptimizedRoute;
};

type StartMode = "route_stop" | "current_location";

type CurrentLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

type StatusFilter = "all" | "disabled" | "repeat" | StopStatus;

const workspaceStorageKey = "multi-stop-route-optimizer.workspace.v2";
const syncStopLimit = 100;
const sampleRows = `address
840 E 51 PL N TULSA 74126
828 E 52 ST N TULSA 74126
838 E 52 ST N TULSA 741262758
831 E 52 ST N TULSA 74126
835 E 52 ST N TULSA 74126
815 E 52 PL N TULSA 74126
821 E 52 PL N TULSA 74126
814 E 52 PL N TULSA 74126
820 E 52 PL N TULSA 74126
819 E 51 PL N TULSA 74126
823 E 51 PL N TULSA 741262761
827 E 51 PL N TULSA 74126
820 E 51 PL N TULSA 74126
824 E 51 PL N TULSA 74126
830 E 51 PL N TULSA 741262762
815 E 52 ST N TULSA 741262757
821 E 52 ST N TULSA 74126
825 E 52 ST N TULSA 74126
814 E 52 ST N TULSA 74126
818 E 52 ST N TULSA 74126`;

function classNames(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

function StatusPill({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-line bg-panel-subtle text-muted",
      )}
    >
      {active ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}
      {label}
    </span>
  );
}

function StatePill({
  icon,
  label,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold",
        tone === "default" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "danger" && "border-red-200 bg-red-50 text-red-800",
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="border border-line bg-panel px-4 py-3">
      <div
        className={classNames(
          "font-mono text-2xl font-semibold leading-none",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold uppercase text-muted">
        {label}
      </div>
    </div>
  );
}

function getStopLabel(stop: RouteStop) {
  return (
    stop.address ||
    stop.normalizedAddress ||
    [stop.latitude, stop.longitude]
      .filter((value) => value !== undefined)
      .map((value) => Number(value).toFixed(5))
      .join(", ")
  );
}

function formatDistance(meters: number) {
  if (!meters) {
    return "-";
  }

  const miles = meters / 1609.344;
  return `${miles.toLocaleString(undefined, {
    maximumFractionDigits: miles >= 100 ? 0 : 1,
  })} mi`;
}

function formatDuration(seconds: number) {
  if (!seconds) {
    return "-";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (!hours) {
    return `${minutes} min`;
  }

  return `${hours} hr ${minutes} min`;
}

function getErrorMessage(data: OptimizeError, fallback: string) {
  if (typeof data.error === "string") {
    return data.error;
  }

  return data.error?.message || data.message || fallback;
}

function getCoordinateStatus(stop: RouteStop): StopStatus {
  const hasValidCoordinates =
    isValidLatitude(stop.latitude) && isValidLongitude(stop.longitude);

  if (hasValidCoordinates) {
    return "valid";
  }

  return stop.address.trim() ? "needs_address_validation" : "invalid";
}

function getStatusIssue(stop: RouteStop) {
  if (stop.status === "valid") {
    return undefined;
  }

  if (stop.address.trim()) {
    return "Address needs geocoding";
  }

  return "Missing address or valid coordinates";
}

function getPendingAddressList(sourceStops: RouteStop[]) {
  return [
    ...new Set(
      sourceStops
        .filter(
          (stop) =>
            !stop.disabled &&
            stop.status === "needs_address_validation" &&
            stop.address.trim(),
        )
        .map((stop) => normalizeAddressInput(stop.address)),
    ),
  ];
}

function getInvalidAddressList(sourceStops: RouteStop[]) {
  return [
    ...new Set(
      sourceStops
        .filter(
          (stop) =>
            !stop.disabled &&
            stop.status === "invalid" &&
            stop.address.trim(),
        )
        .map((stop) => normalizeAddressInput(stop.address)),
    ),
  ];
}

function applyGeocodeResultsToStopList(
  sourceStops: RouteStop[],
  results: GeocodeResult[],
  statuses: StopStatus[] = ["needs_address_validation"],
) {
  const byInput = new Map(
    results.map((result) => [result.input.trim().toLowerCase(), result]),
  );

  return sourceStops.map((stop) => {
    if (!statuses.includes(stop.status) || stop.disabled) {
      return stop;
    }

    const normalizedAddress = normalizeAddressInput(stop.address);
    const result =
      byInput.get(normalizedAddress.toLowerCase()) ||
      byInput.get(stop.address.trim().toLowerCase());

    if (!result) {
      return stop;
    }

    return applyGeocodeResultToStop(
      {
        ...stop,
        address: normalizedAddress,
      },
      result,
    );
  });
}

function applyGeocodeResultToStop(stop: RouteStop, result: GeocodeResult) {
  if (result.status === "ok") {
    return {
      ...stop,
      status: "valid" as const,
      normalizedAddress: result.normalizedAddress,
      latitude: result.latitude,
      longitude: result.longitude,
      placeId: result.placeId,
      issue: undefined,
    };
  }

  return {
    ...stop,
    status: "invalid" as const,
    issue: result.message || "Address not found",
  };
}

function buildCoordinateStopOptions(sourceStops: RouteStop[]): CoordinateStop[] {
  return sourceStops
    .filter(
      (stop) =>
        stop.status === "valid" &&
        !stop.disabled &&
        stop.latitude !== undefined &&
        stop.longitude !== undefined,
    )
    .map((stop) => ({
      id: stop.id,
      label: getStopLabel(stop),
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
    }));
}

function getCurrentLocationStop(location: CurrentLocation): CoordinateStop {
  return {
    id: currentLocationStopId,
    label: "Current location",
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

function getRouteStopCount(stopOptions: CoordinateStop[]) {
  return stopOptions.filter((stop) => stop.id !== currentLocationStopId).length;
}

function formatAddNotice(label: string, added: number, duplicateWarnings: number) {
  const parts = [`${added.toLocaleString()} ${label} added`];

  if (duplicateWarnings) {
    parts.push(`${duplicateWarnings.toLocaleString()} repeat warnings`);
  }

  return parts.join(", ");
}

function getEstimatedRouteOptimizationCost(stopCount: number) {
  const billable = Math.max(stopCount - 5000, 0);
  return billable * 0.01;
}

function makeFileSafeName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "route"
  );
}

export function RouteWorkspace({ googleMapsBrowserKey }: RouteWorkspaceProps) {
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const [routeName, setRouteName] = useState("Untitled route");
  const [routeOptimizationMode, setRouteOptimizationMode] =
    useState<RouteOptimizationMode>("google_optimized");
  const [startMode, setStartMode] = useState<StartMode>("route_stop");
  const [endMode, setEndMode] = useState<EndMode>("round_trip");
  const [startStopId, setStartStopId] = useState("");
  const [endStopId, setEndStopId] = useState("");
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation>();
  const [manualStops, setManualStops] = useState("");
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRoute>();
  const [batchJob, setBatchJob] = useState<BatchOptimizationJob>();
  const [navigationIndex, setNavigationIndex] = useState(0);
  const [selectedStopId, setSelectedStopId] = useState<string>();
  const [systemStatus, setSystemStatus] = useState<SystemStatus>();
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let disposed = false;

    async function loadStatus() {
      const response = await fetch("/api/system-status", { cache: "no-store" });
      const data = (await response.json()) as SystemStatus;

      if (!disposed) {
        setSystemStatus(data);
      }
    }

    loadStatus().catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(workspaceStorageKey);

      if (saved) {
        try {
          const parsed = JSON.parse(saved) as SavedWorkspace;
          setRouteName(parsed.routeName || "Untitled route");
          setRouteOptimizationMode(
            parsed.routeOptimizationMode ??
              (parsed.curbsideRouting ? "curbside_strict" : "google_optimized"),
          );
          setStartMode(parsed.startMode || "route_stop");
          setEndMode(parsed.endMode || "round_trip");
          setStartStopId(parsed.startStopId || "");
          setEndStopId(parsed.endStopId || "");
          setCurrentLocation(parsed.currentLocation);
          setStops(parsed.stops || []);
          setOptimizedRoute(parsed.optimizedRoute);
        } catch {
          window.localStorage.removeItem(workspaceStorageKey);
        }
      }

      setIsHydrated(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const snapshot: SavedWorkspace = {
      routeName,
      routeOptimizationMode,
      startMode,
      endMode,
      startStopId,
      endStopId,
      currentLocation,
      stops,
      optimizedRoute,
    };

    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(snapshot));
  }, [
    currentLocation,
    endMode,
    endStopId,
    isHydrated,
    optimizedRoute,
    routeOptimizationMode,
    routeName,
    startMode,
    startStopId,
    stops,
  ]);

  const metrics = useMemo(() => {
    const activeStops = stops.filter((stop) => !stop.disabled);
    const valid = activeStops.filter((stop) => stop.status === "valid").length;
    const needsValidation = activeStops.filter(
      (stop) => stop.status === "needs_address_validation",
    ).length;
    const invalid = activeStops.filter((stop) => stop.status === "invalid").length;
    const coordinateBacked = activeStops.filter(
      (stop) => stop.latitude !== undefined && stop.longitude !== undefined,
    ).length;

    return {
      total: stops.length,
      active: activeStops.length,
      valid,
      needsValidation,
      invalid,
      disabled: stops.length - activeStops.length,
      coordinateBacked,
    };
  }, [stops]);

  const coordinateStops = useMemo(
    () =>
      stops.filter(
        (stop) =>
          stop.status === "valid" &&
          !stop.disabled &&
          stop.latitude !== undefined &&
          stop.longitude !== undefined,
      ),
    [stops],
  );
  const coordinateStopOptions = useMemo(
    () => buildCoordinateStopOptions(stops),
    [stops],
  );
  const currentLocationStop = useMemo(
    () => (currentLocation ? getCurrentLocationStop(currentLocation) : undefined),
    [currentLocation],
  );
  const optimizationStopOptions = useMemo(
    () =>
      startMode === "current_location" && currentLocationStop
        ? [currentLocationStop, ...coordinateStopOptions]
        : coordinateStopOptions,
    [coordinateStopOptions, currentLocationStop, startMode],
  );
  const optimizedStopIds = useMemo(
    () => optimizedRoute?.visitOrder.map((visit) => visit.stopId) ?? [],
    [optimizedRoute],
  );
  const optimizedSequenceMap = useMemo(
    () =>
      new Map(
        optimizedStopIds.map((stopId, index) => [stopId, String(index + 1)]),
      ),
    [optimizedStopIds],
  );
  const resolvedStartStopId =
    startMode === "current_location"
      ? currentLocationStopId
      : coordinateStops.some((stop) => stop.id === startStopId)
        ? startStopId
        : coordinateStops[0]?.id ?? "";
  const resolvedEndStopId = coordinateStops.some((stop) => stop.id === endStopId)
    ? endStopId
    : coordinateStops.at(-1)?.id ?? "";
  const selectedStop = stops.find((stop) => stop.id === selectedStopId);
  const displayedStops = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return stops.filter((stop) => {
      if (statusFilter === "disabled" && !stop.disabled) {
        return false;
      }

      if (statusFilter === "repeat" && !stop.duplicateOfInputOrder) {
        return false;
      }

      if (
        statusFilter !== "all" &&
        statusFilter !== "disabled" &&
        statusFilter !== "repeat" &&
        stop.status !== statusFilter
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        stop.address,
        stop.normalizedAddress,
        stop.placeId,
        stop.notes,
        stop.latitude,
        stop.longitude,
      ]
        .filter((value) => value !== undefined)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [searchQuery, statusFilter, stops]);
  const routeOptimizationCost = getEstimatedRouteOptimizationCost(
    coordinateStopOptions.length,
  );
  const hasEnoughInputForRoute =
    startMode === "current_location"
      ? metrics.coordinateBacked >= 1 || metrics.needsValidation > 0
      : metrics.coordinateBacked >= 2 || metrics.needsValidation > 0;
  const routeState = useMemo(() => {
    if (!metrics.total) {
      return {
        label: "No stops",
        tone: "warning" as const,
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }

    if (metrics.invalid) {
      return {
        label: `${metrics.invalid.toLocaleString()} invalid`,
        tone: "danger" as const,
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }

    if (metrics.needsValidation) {
      return {
        label: `${metrics.needsValidation.toLocaleString()} needs check`,
        tone: "warning" as const,
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }

    if (optimizedRoute) {
      return {
        label: "Optimized",
        tone: "default" as const,
        icon: <Route className="h-4 w-4" />,
      };
    }

    return {
      label: "Ready",
      tone: "default" as const,
      icon: <ShieldCheck className="h-4 w-4" />,
    };
  }, [metrics.invalid, metrics.needsValidation, metrics.total, optimizedRoute]);
  const safeNavigationIndex = optimizedRoute?.visitOrder.length
    ? Math.min(navigationIndex, optimizedRoute.visitOrder.length - 1)
    : 0;
  const currentNavigationVisit =
    optimizedRoute?.visitOrder[safeNavigationIndex] ?? optimizedRoute?.visitOrder[0];
  const navigationStopId = currentNavigationVisit?.stopId;

  const addStops = useCallback((nextStops: RouteStop[]) => {
    const result = mergeDedupedStops(stops, nextStops);

    setStops(result.stops);
    setOptimizedRoute(undefined);

    return {
      added: result.added,
      duplicateWarnings: result.duplicateWarnings,
    };
  }, [stops]);

  const updateStop = useCallback((stopId: string, patch: Partial<RouteStop>) => {
    setStops((current) =>
      current.map((stop) => {
        if (stop.id !== stopId) {
          return stop;
        }

        const next = { ...stop, ...patch };
        const status = patch.status ?? getCoordinateStatus(next);

        return {
          ...next,
          status,
          issue: status === "valid" ? undefined : patch.issue ?? getStatusIssue(next),
        };
      }),
    );
    setOptimizedRoute(undefined);
  }, []);

  function loadSample() {
    Papa.parse<Record<string, unknown>>(sampleRows, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const summary = addStops(
          data.map((row, index) => buildStopFromRow(row, index + 1)),
        );

        setNotice(formatAddNotice("sample stops", summary.added, summary.duplicateWarnings));
      },
    });
  }

  function buildStopsFromLines(text: string, startOrder: number) {
    return text
      .split(/\r?\n/)
      .map((line, index) =>
        buildStopFromManualLine(line, startOrder + index + 1),
      )
      .filter((stop): stop is RouteStop => Boolean(stop));
  }

  function handleManualAdd() {
    const parsed = buildStopsFromLines(manualStops, stops.length);

    if (!parsed.length) {
      setNotice("No manual stops found");
      return;
    }

    const summary = addStops(parsed);

    setManualStops("");
    setNotice(
      formatAddNotice("manual stops", summary.added, summary.duplicateWarnings),
    );
  }

  function handleFile(file: File) {
    const isTextAddressFile =
      file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain";

    if (isTextAddressFile) {
      file
        .text()
        .then((text) => {
          const parsedStops = buildStopsFromLines(text, stops.length);

          if (!parsedStops.length) {
            setNotice("No address rows found");
            return;
          }

          const summary = addStops(parsedStops);

          setNotice(
            formatAddNotice(
              "address rows",
              summary.added,
              summary.duplicateWarnings,
            ),
          );
        })
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : "File import failed"),
        );
      return;
    }

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, errors }) => {
        const currentCount = stops.length;
        const parsedStops = data.map((row, index) =>
          buildStopFromRow(row, currentCount + index + 1),
        );

        const summary = addStops(parsedStops);
        setNotice(
          `${summary.added.toLocaleString()} rows imported${
            summary.duplicateWarnings
              ? `, ${summary.duplicateWarnings.toLocaleString()} repeat warnings`
              : ""
          }${
            errors.length ? `, ${errors.length} parse warnings` : ""
          }`,
        );
      },
      error: (error) => setNotice(error.message),
    });
  }

  function removeStop(stopId: string) {
    setStops((current) => current.filter((stop) => stop.id !== stopId));
    setOptimizedRoute(undefined);

    if (selectedStopId === stopId) {
      setSelectedStopId(undefined);
    }
  }

  function clearStops() {
    setStops([]);
    setOptimizedRoute(undefined);
    setBatchJob(undefined);
    setSelectedStopId(undefined);
    setNotice("Route cleared");
  }

  function requestCurrentLocation() {
    if (!navigator.geolocation) {
      return Promise.reject(new Error("Current location is not available in this browser"));
    }

    setNotice("Waiting for location permission");

    return new Promise<CurrentLocation>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };

          setCurrentLocation(location);
          setNotice("Current location set as route start");
          resolve(location);
        },
        (error) => {
          reject(
            new Error(
              error.message || "Unable to get current location permission",
            ),
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 60_000,
          timeout: 12_000,
        },
      );
    });
  }

  async function ensureCurrentLocation() {
    if (startMode !== "current_location") {
      return undefined;
    }

    return currentLocation ?? requestCurrentLocation();
  }

  async function geocodeAddresses(
    addresses: string[],
    options: { acceptGoogleCandidate?: boolean } = {},
  ) {
    const response = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addresses,
        acceptGoogleCandidate: options.acceptGoogleCandidate,
      }),
    });
    const data = (await response.json()) as {
      results?: GeocodeResult[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Address validation failed");
    }

    return data.results ?? [];
  }

  function canSubmitOptimization(stopOptions = optimizationStopOptions) {
    const routeStopCount = getRouteStopCount(stopOptions);

    if (stopOptions.length < 2) {
      setNotice("At least two valid coordinate-backed stops are required");
      return false;
    }

    if (!routeStopCount) {
      setNotice("Add at least one route stop");
      return false;
    }

    if (routeStopCount > maxRouteStops) {
      setNotice(
        `Routes are limited to ${maxRouteStops.toLocaleString()} valid stops`,
      );
      return false;
    }

    return true;
  }

  async function requestOptimizationValidation({
    stopOptions = optimizationStopOptions,
    showSuccess = true,
  }: {
    stopOptions?: CoordinateStop[];
    showSuccess?: boolean;
  } = {}) {
    const response = await fetch("/api/route-optimization/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: stopOptions,
        startStopId: resolvedStartStopId,
        endMode,
        endStopId: resolvedEndStopId,
        routeOptimizationMode,
      }),
    });
    const data = (await response.json()) as OptimizationValidation | OptimizeError;

    if (!response.ok) {
      throw new Error(
        getErrorMessage(data as OptimizeError, "Optimization validation failed"),
      );
    }

    const success = data as OptimizationValidation;

    if (showSuccess) {
      setNotice(
        `Optimization payload valid for ${success.validatedStops.toLocaleString()} stops`,
      );
    }

    return success;
  }

  async function validateStopsAndBuildOptions(showSuccess = true) {
    let nextStops = stops;
    const addresses = getPendingAddressList(nextStops);

    if (addresses.length) {
      let checked = 0;

      for (let index = 0; index < addresses.length; index += 25) {
        const results = await geocodeAddresses(addresses.slice(index, index + 25));
        checked += results.length;
        nextStops = applyGeocodeResultsToStopList(nextStops, results);
        setStops(nextStops);
        setOptimizedRoute(undefined);
        setNotice(
          `${checked.toLocaleString()} of ${addresses.length.toLocaleString()} addresses checked`,
        );
      }
    }

    const nextCurrentLocation = await ensureCurrentLocation();
    const routeStopOptions = buildCoordinateStopOptions(nextStops);
    const nextStopOptions =
      startMode === "current_location" && nextCurrentLocation
        ? [getCurrentLocationStop(nextCurrentLocation), ...routeStopOptions]
        : routeStopOptions;

    if (!canSubmitOptimization(nextStopOptions)) {
      return undefined;
    }

    await requestOptimizationValidation({
      stopOptions: nextStopOptions,
      showSuccess,
    });

    return nextStopOptions;
  }

  function validateRoute() {
    startTransition(async () => {
      try {
        await validateStopsAndBuildOptions();
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Route validation failed",
        );
      }
    });
  }

  function acceptGoogleCandidatesForInvalidStops() {
    startTransition(async () => {
      try {
        let nextStops = stops;
        const addresses = getInvalidAddressList(nextStops);

        if (!addresses.length) {
          setNotice("No invalid address rows to review");
          return;
        }

        let checked = 0;
        let accepted = 0;

        for (let index = 0; index < addresses.length; index += 25) {
          const results = await geocodeAddresses(
            addresses.slice(index, index + 25),
            { acceptGoogleCandidate: true },
          );

          checked += results.length;
          accepted += results.filter((result) => result.status === "ok").length;
          nextStops = applyGeocodeResultsToStopList(
            nextStops,
            results,
            ["invalid"],
          );
          setStops(nextStops);
          setOptimizedRoute(undefined);
          setBatchJob(undefined);
          setNotice(
            `${checked.toLocaleString()} of ${addresses.length.toLocaleString()} invalid addresses checked`,
          );
        }

        setStatusFilter(accepted ? "valid" : "invalid");
        setNotice(
          `${accepted.toLocaleString()} of ${addresses.length.toLocaleString()} invalid addresses accepted from Google`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Invalid address review failed",
        );
      }
    });
  }

  function validateSelectedStop(acceptGoogleCandidate = false) {
    if (!selectedStop) {
      setNotice("Select a stop first");
      return;
    }

    const address = normalizeAddressInput(selectedStop.address);

    if (!address) {
      setNotice("Selected stop needs an address");
      return;
    }

    const selectedStopIdSnapshot = selectedStop.id;

    startTransition(async () => {
      try {
        const [result] = await geocodeAddresses([address], {
          acceptGoogleCandidate,
        });
        const geocodeResult =
          result ??
          ({
            input: address,
            status: "failed",
            message: "No geocoding result",
          } satisfies GeocodeResult);

        setStops((current) =>
          current.map((stop) =>
            stop.id === selectedStopIdSnapshot
              ? applyGeocodeResultToStop(
                  {
                    ...stop,
                    address,
                    normalizedAddress: undefined,
                    latitude: undefined,
                    longitude: undefined,
                    placeId: undefined,
                    status: "needs_address_validation",
                  },
                  geocodeResult,
                )
              : stop,
          ),
        );
        setOptimizedRoute(undefined);
        setBatchJob(undefined);
        setNotice(
          geocodeResult.status === "ok"
            ? acceptGoogleCandidate
              ? "Google candidate accepted"
              : "Selected address validated"
            : geocodeResult.message || "Selected address needs correction",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Selected address validation failed",
        );
      }
    });
  }

  function reviewFirstInvalidStop() {
    const firstInvalid = stops.find(
      (stop) => stop.status === "invalid" && !stop.disabled,
    );

    if (!firstInvalid) {
      return;
    }

    setStatusFilter("invalid");
    setSelectedStopId(firstInvalid.id);
    setNotice("Reviewing the first invalid stop");
  }

  function editStopAddress(stopId: string) {
    setSelectedStopId(stopId);
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
  }

  function optimizeRoute() {
    startTransition(async () => {
      try {
        const stopOptions = await validateStopsAndBuildOptions(false);

        if (!stopOptions) {
          return;
        }

        if (getRouteStopCount(stopOptions) > syncStopLimit) {
          await submitBatchOptimization(stopOptions);
          return;
        }

        await submitSyncOptimization(stopOptions);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Optimization failed");
      }
    });
  }

  async function submitSyncOptimization(stopOptions = optimizationStopOptions) {
    const response = await fetch("/api/route-optimization/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: stopOptions,
        startStopId: resolvedStartStopId,
        endMode,
        endStopId: resolvedEndStopId,
        routeOptimizationMode,
      }),
    });
    const data = (await response.json()) as OptimizedRoute | OptimizeError;

    if (!response.ok) {
      throw new Error(getErrorMessage(data as OptimizeError, "Optimization failed"));
    }

    const nextRoute = { ...(data as OptimizedRoute), mode: "sync" as const };

    setOptimizedRoute(nextRoute);
    setStops((current) => buildOrderedStops(current, nextRoute));
    setNavigationIndex(0);
    setBatchJob(undefined);
    setNotice(
      `Optimized ${nextRoute.visitOrder.length.toLocaleString()} stops - ${formatDistance(
        nextRoute.distanceMeters,
      )} - ${formatDuration(nextRoute.durationSeconds)}`,
    );
  }

  async function submitBatchOptimization(stopOptions = optimizationStopOptions) {
    if (
      getRouteStopCount(stopOptions) > 1000 &&
      !window.confirm(
        `Run async optimization for ${getRouteStopCount(stopOptions).toLocaleString()} stops?`,
      )
    ) {
      setNotice("Async optimization canceled");
      return;
    }

    const response = await fetch("/api/route-optimization/batch/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: stopOptions,
        startStopId: resolvedStartStopId,
        endMode,
        endStopId: resolvedEndStopId,
        routeOptimizationMode,
      }),
    });
    const data = (await response.json()) as BatchOptimizationJob | OptimizeError;

    if (!response.ok) {
      throw new Error(
        getErrorMessage(data as OptimizeError, "Async optimization failed to start"),
      );
    }

    const job = data as BatchOptimizationJob;

    setBatchJob({ ...job, status: "running" });
    setOptimizedRoute(undefined);
    setNotice(`Async optimization submitted: ${job.jobId}`);
  }

  const pollBatchJob = useCallback(
    async (job: BatchOptimizationJob) => {
      const response = await fetch("/api/route-optimization/batch/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationName: job.operationName,
          outputPrefix: job.outputPrefix,
          stops: optimizationStopOptions,
          startStopId: resolvedStartStopId,
          endMode,
          endStopId: resolvedEndStopId,
          routeOptimizationMode,
        }),
      });
      const data = (await response.json()) as BatchStatusResponse | OptimizeError;

      if (!response.ok) {
        setBatchJob((current) =>
          current ? { ...current, status: "failed", message: getErrorMessage(data as OptimizeError, "Async optimization status failed") } : current,
        );
        setNotice(getErrorMessage(data as OptimizeError, "Async optimization status failed"));
        return;
      }

      if ("status" in data && data.status === "completed") {
        const nextRoute = {
          ...data.route,
          jobId: job.jobId,
          operationName: job.operationName,
          inputUri: job.inputUri,
          outputUri: job.outputUri,
        };

        setOptimizedRoute(nextRoute);
        setStops((current) => buildOrderedStops(current, nextRoute));
        setNavigationIndex(0);
        setBatchJob({ ...job, status: "completed" });
        setNotice(`Async optimization completed: ${job.jobId}`);
      } else if ("status" in data && data.status === "failed") {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Async optimization failed";
        setBatchJob({ ...job, status: "failed", message });
        setNotice(message);
      } else {
        setBatchJob((current) =>
          current ? { ...current, status: "running", message: data.message } : current,
        );
      }
    },
    [
      endMode,
      optimizationStopOptions,
      routeOptimizationMode,
      resolvedEndStopId,
      resolvedStartStopId,
    ],
  );

  useEffect(() => {
    if (!batchJob || !["submitted", "running"].includes(batchJob.status)) {
      return;
    }

    const poll = () => {
      pollBatchJob(batchJob).catch((error) =>
        setNotice(error instanceof Error ? error.message : "Async polling failed"),
      );
    };
    const timer = window.setInterval(poll, 5000);

    poll();

    return () => window.clearInterval(timer);
  }, [batchJob, pollBatchJob]);

  function goToNavigationStep(index: number) {
    const visit = optimizedRoute?.visitOrder[index];

    if (!visit) {
      return;
    }

    setNavigationIndex(index);
  }

  function moveVisit(stopId: string, direction: -1 | 1) {
    if (!optimizedRoute) {
      return;
    }

    const index = optimizedRoute.visitOrder.findIndex(
      (visit) => visit.stopId === stopId,
    );
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= optimizedRoute.visitOrder.length) {
      return;
    }

    const nextOrder = [...optimizedRoute.visitOrder];
    const temp = nextOrder[index];
    nextOrder[index] = nextOrder[nextIndex];
    nextOrder[nextIndex] = temp;

    setOptimizedRoute({
      ...optimizedRoute,
      polyline: undefined,
      distanceMeters: 0,
      durationSeconds: 0,
      visitOrder: nextOrder.map((visit, nextSequence) => ({
        ...visit,
        sequence: nextSequence + 1,
      })),
    });
    setNotice("Manual order updated. Re-optimize to refresh route line and metrics.");
  }

  function applyOptimizedOrderToStops() {
    if (!optimizedRoute?.visitOrder.length) {
      return;
    }

    const sequenceById = new Map(
      optimizedRoute.visitOrder.map((visit, index) => [visit.stopId, index]),
    );

    setStops((current) =>
      [...current].sort((a, b) => {
        const aOrder = sequenceById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = sequenceById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      }),
    );
    setNotice("Stop list reordered to match optimized order");
  }

  function exportFile(format: "csv" | "json" | "kml" | "gpx") {
    const baseName = makeFileSafeName(routeName);

    if (format === "csv") {
      downloadText(`${baseName}.csv`, buildStopsCsv(stops, optimizedRoute), "text/csv");
    }

    if (format === "json") {
      downloadText(`${baseName}.json`, buildRouteJson(stops, optimizedRoute), "application/json");
    }

    if (format === "kml") {
      downloadText(`${baseName}.kml`, buildKml(stops, optimizedRoute), "application/vnd.google-earth.kml+xml");
    }

    if (format === "gpx") {
      downloadText(`${baseName}.gpx`, buildGpx(stops, optimizedRoute), "application/gpx+xml");
    }
  }

  function exportPdf() {
    const printWindow = window.open("", "_blank", "width=1100,height=800");

    if (!printWindow) {
      setNotice("Pop-ups must be enabled to print PDF");
      return;
    }

    printWindow.document.write(
      buildPrintableRouteHtml(routeName, stops, optimizedRoute),
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <main className="route-shell min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/90">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-white shadow-sm">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">
                Multi-Stop Route Optimizer
              </h1>
              <p className="text-sm text-muted">
                {routeName} / {metrics.active.toLocaleString()} active stops
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatePill
              icon={routeState.icon}
              label={routeState.label}
              tone={routeState.tone}
            />
            <StatusPill active={Boolean(systemStatus?.mapsKey)} label="Maps" />
            <StatusPill
              active={Boolean(systemStatus?.serverMapsKey)}
              label="Geocoding"
            />
            <StatusPill
              active={Boolean(systemStatus?.serviceAccount)}
              label="Optimizer"
            />
            <StatusPill
              active={Boolean(systemStatus?.routeOptimizationBucket)}
              label="Storage"
            />
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-subtle px-2.5 py-1 text-xs font-medium text-muted">
              <Save className="h-3.5 w-3.5" />
              Autosaved
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section className="space-y-4 xl:sticky xl:top-[82px] xl:h-[calc(100vh-102px)] xl:overflow-auto xl:pr-1">
          <div className="border border-line bg-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                Route
              </h2>
              <Settings2 className="h-4 w-4 text-muted" />
            </div>

            <div className="space-y-4">
              <div className="block">
                <span className="mb-1 block text-sm font-medium">
                  Route name
                </span>
                <input
                  value={routeName}
                  onChange={(event) => setRouteName(event.target.value)}
                  className="h-10 w-full border border-line bg-white px-3 text-sm"
                />
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium">
                  Optimization
                </span>
                <div className="grid grid-cols-1 rounded-md border border-line bg-panel-subtle p-1 sm:grid-cols-3">
                  {[
                    ["google_optimized", "Google"],
                    ["curbside_assisted", "Curbside"],
                    ["curbside_strict", "Strict"],
                  ].map(([value, label]) => {
                    const isActive = value === routeOptimizationMode;

                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setRouteOptimizationMode(value as RouteOptimizationMode);
                          setOptimizedRoute(undefined);
                          setBatchJob(undefined);
                        }}
                        className={classNames(
                          "h-9 px-2 text-sm font-medium",
                          isActive
                            ? "bg-panel text-foreground shadow-sm"
                            : "text-muted hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="block">
                <span className="mb-1 block text-sm font-medium">
                  Start point
                </span>
                <div className="mb-2 grid grid-cols-2 rounded-md border border-line bg-panel-subtle p-1">
                  {[
                    ["route_stop", "Route stop"],
                    ["current_location", "Current location"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setStartMode(value as StartMode);
                        setOptimizedRoute(undefined);

                        if (value === "current_location" && !currentLocation) {
                          requestCurrentLocation().catch((error: unknown) =>
                            setNotice(
                              error instanceof Error
                                ? error.message
                                : "Unable to get current location",
                            ),
                          );
                        }
                      }}
                      className={classNames(
                        "h-9 text-sm font-medium",
                        startMode === value
                          ? "bg-panel text-foreground shadow-sm"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  value={resolvedStartStopId}
                  onChange={(event) => {
                    setStartStopId(event.target.value);
                    setOptimizedRoute(undefined);
                  }}
                  disabled={!coordinateStops.length || startMode === "current_location"}
                  className="h-10 w-full border border-line bg-white px-3 text-sm disabled:bg-panel-subtle disabled:text-muted"
                >
                  {startMode === "current_location" ? (
                    <option>Current location</option>
                  ) : coordinateStops.length ? (
                    coordinateStops.map((stop, index) => (
                      <option key={stop.id} value={stop.id}>
                        {index + 1}. {getStopLabel(stop)}
                      </option>
                    ))
                  ) : (
                    <option>No coordinate stops</option>
                  )}
                </select>
                {startMode === "current_location" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {currentLocation ? (
                      <span className="font-mono">
                        {currentLocation.latitude.toFixed(5)},{" "}
                        {currentLocation.longitude.toFixed(5)}
                      </span>
                    ) : (
                      <span>Location permission needed before validation</span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        requestCurrentLocation().catch((error: unknown) =>
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Unable to refresh current location",
                          ),
                        )
                      }
                      className="border border-line bg-panel px-2 py-1 text-xs font-semibold hover:border-accent"
                    >
                      Refresh
                    </button>
                  </div>
                ) : null}
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium">
                  End point
                </span>
                <div className="grid grid-cols-3 rounded-md border border-line bg-panel-subtle p-1">
                  {[
                    ["round_trip", "Start"],
                    ["last_stop", "Last"],
                    ["selected_stop", "Choose"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setEndMode(value as EndMode);
                        setOptimizedRoute(undefined);
                      }}
                      className={classNames(
                        "h-9 text-sm font-medium",
                        endMode === value
                          ? "bg-panel text-foreground shadow-sm"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {endMode === "selected_stop" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Chosen end
                  </span>
                  <select
                    value={resolvedEndStopId}
                    onChange={(event) => {
                      setEndStopId(event.target.value);
                      setOptimizedRoute(undefined);
                    }}
                    disabled={!coordinateStops.length}
                    className="h-10 w-full border border-line bg-white px-3 text-sm disabled:bg-panel-subtle disabled:text-muted"
                  >
                    {coordinateStops.map((stop, index) => (
                      <option key={stop.id} value={stop.id}>
                        {index + 1}. {getStopLabel(stop)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="border border-line bg-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                Import
              </h2>
              <Upload className="h-4 w-4 text-muted" />
            </div>

            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-line bg-panel-subtle px-4 py-6 text-center hover:border-accent">
              <FileText className="mb-2 h-5 w-5 text-accent" />
              <span className="text-sm font-medium">Choose CSV</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleFile(file);
                    event.currentTarget.value = "";
                  }
                }}
              />
            </label>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={loadSample}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 bg-foreground px-3 text-sm font-semibold text-white hover:bg-accent-strong"
              >
                <Database className="h-4 w-4" />
                Sample
              </button>
              <button
                type="button"
                onClick={clearStops}
                className="inline-flex h-10 items-center justify-center gap-2 border border-line bg-panel px-3 text-sm font-semibold hover:border-danger hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>

          <div className="border border-line bg-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                Add Stops
              </h2>
              <Plus className="h-4 w-4 text-muted" />
            </div>

            <textarea
              value={manualStops}
              onChange={(event) => setManualStops(event.target.value)}
              rows={5}
              placeholder="123 Main St, Tulsa, OK&#10;41.8789, -87.6359"
              className="w-full resize-none border border-line bg-white p-3 text-sm"
            />
            <button
              type="button"
              onClick={handleManualAdd}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong"
            >
              <Plus className="h-4 w-4" />
              Add Stops
            </button>
          </div>

          <div className="border border-line bg-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted">
                Cost
              </h2>
              <AlertTriangle className="h-4 w-4 text-muted" />
            </div>
            <div className="space-y-2 text-sm text-muted">
              <p>
                {coordinateStopOptions.length.toLocaleString()} active coordinate
                stops are ready for optimization.
              </p>
              <p>
                Estimated Route Optimization charge this month after the free
                5,000 events:{" "}
                <span className="font-mono text-foreground">
                  ${routeOptimizationCost.toFixed(2)}
                </span>
              </p>
              <p>
                Jobs over {syncStopLimit} stops use async Cloud Storage flow.
              </p>
              {coordinateStopOptions.length > maxRouteStops ? (
                <p className="font-semibold text-danger">
                  This route exceeds the {maxRouteStops.toLocaleString()} stop
                  limit.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Total" value={metrics.total.toLocaleString()} />
              <Metric label="Active" value={metrics.active.toLocaleString()} />
              <Metric label="Valid" value={metrics.valid.toLocaleString()} />
              <Metric
                label="Needs Check"
                value={metrics.needsValidation.toLocaleString()}
                tone={metrics.needsValidation ? "warning" : "default"}
              />
              <Metric
                label="Invalid"
                value={metrics.invalid.toLocaleString()}
                tone={metrics.invalid ? "danger" : "default"}
              />
            </div>

            {optimizedRoute ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Route Distance"
                  value={formatDistance(optimizedRoute.distanceMeters)}
                />
                <Metric
                  label="Route Duration"
                  value={formatDuration(optimizedRoute.durationSeconds)}
                />
                <Metric
                  label="Optimized Stops"
                  value={optimizedRoute.visitOrder.length.toLocaleString()}
                  tone={
                    optimizedRoute.skippedShipmentCount ? "warning" : "default"
                  }
                />
              </div>
            ) : null}

            <RouteMap
              apiKey={googleMapsBrowserKey}
              stops={stops}
              currentLocation={
                startMode === "current_location" ? currentLocation : undefined
              }
              optimizedStopIds={optimizedStopIds}
              routePolyline={optimizedRoute?.polyline}
              selectedStopId={selectedStopId}
              navigationStopId={navigationStopId}
              onSelectStop={setSelectedStopId}
            />

            <div className="border border-line bg-panel">
              <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="font-semibold">Stops</h2>
                  <p className="text-sm text-muted">
                    {metrics.coordinateBacked.toLocaleString()} coordinate-backed
                    / {metrics.needsValidation.toLocaleString()} pending
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {metrics.invalid ? (
                    <button
                      type="button"
                      onClick={reviewFirstInvalidStop}
                      className="inline-flex h-10 min-w-28 items-center justify-center gap-2 border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:border-red-300"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      Review Invalid Addresses
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={validateRoute}
                    disabled={isPending || !hasEnoughInputForRoute}
                    className="inline-flex h-10 min-w-28 items-center justify-center gap-2 border border-line bg-panel px-4 text-sm font-semibold hover:border-accent hover:bg-panel-subtle disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Validate
                  </button>
                  <button
                    type="button"
                    onClick={optimizeRoute}
                    disabled={isPending || !hasEnoughInputForRoute}
                    className="inline-flex h-10 min-w-36 items-center justify-center gap-2 bg-foreground px-4 text-sm font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Optimize Route
                  </button>
                </div>
              </div>

              <div className="grid gap-3 border-b border-line p-4 lg:grid-cols-[minmax(0,1fr)_180px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search stops"
                    className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm"
                  />
                </label>
                <label className="relative block">
                  <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as StatusFilter)
                    }
                    className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm"
                  >
                    <option value="all">All stops</option>
                    <option value="valid">Valid</option>
                    <option value="needs_address_validation">Needs check</option>
                    <option value="invalid">Invalid</option>
                    <option value="repeat">Repeat / duplicate</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
              </div>

              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-panel-subtle text-xs font-semibold uppercase text-muted">
                    <tr>
                      <th className="border-b border-line px-3 py-2">#</th>
                      <th className="border-b border-line px-3 py-2">Stop</th>
                      <th className="border-b border-line px-3 py-2">Flags</th>
                      <th className="border-b border-line px-3 py-2">Status</th>
                      <th className="border-b border-line px-3 py-2">
                        Coordinates
                      </th>
                      <th className="border-b border-line px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedStops.length ? (
                      displayedStops.map((stop, index) => (
                        <tr
                          key={stop.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedStopId(stop.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedStopId(stop.id);
                            }
                          }}
                          className={classNames(
                            "cursor-pointer border-b border-line hover:bg-panel-subtle",
                            selectedStopId === stop.id && "bg-emerald-50/80",
                            stop.disabled && "opacity-55",
                          )}
                        >
                          <td className="px-3 py-2 font-mono text-xs text-muted">
                            {optimizedSequenceMap.get(stop.id) ?? index + 1}
                          </td>
                          <td className="max-w-[360px] px-3 py-2">
                            <div className="truncate font-medium">
                              {getStopLabel(stop) || "Unnamed stop"}
                            </div>
                            {stop.issue ? (
                              <div className="mt-1 truncate text-xs text-warning">
                                {stop.issue}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {stop.pinned ? (
                                <Pin className="h-4 w-4 text-warning" />
                              ) : null}
                              {stop.disabled ? (
                                <EyeOff className="h-4 w-4 text-muted" />
                              ) : null}
                              {stop.duplicateOfInputOrder ? (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                  Repeat #{stop.duplicateOfInputOrder}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={classNames(
                                "inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize",
                                stop.status === "valid" &&
                                  "bg-emerald-50 text-emerald-800",
                                stop.status === "needs_address_validation" &&
                                  "bg-amber-50 text-amber-800",
                                stop.status === "invalid" &&
                                  "bg-red-50 text-red-800",
                              )}
                            >
                              {stop.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted">
                            {stop.latitude !== undefined &&
                            stop.longitude !== undefined
                              ? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`
                              : "-"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  editStopAddress(stop.id);
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center border border-line bg-panel hover:border-accent hover:text-accent"
                                aria-label={`Edit address for ${getStopLabel(stop) || "stop"}`}
                              >
                                <PencilLine className="h-4 w-4" />
                              </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeStop(stop.id);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center border border-line bg-panel hover:border-danger hover:text-danger"
                              aria-label="Remove stop"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-14 text-center text-sm text-muted"
                        >
                          No matching stops
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            {metrics.invalid ? (
              <div className="border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase">
                      Invalid Address Review
                    </h2>
                    <p className="mt-1 text-sm">
                      {metrics.invalid.toLocaleString()} invalid stops need review.
                    </p>
                  </div>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 min-[1180px]:grid-cols-1">
                  <button
                    type="button"
                    onClick={reviewFirstInvalidStop}
                    className="inline-flex h-10 items-center justify-center gap-2 border border-amber-300 bg-white px-3 text-sm font-semibold hover:border-amber-500"
                  >
                    <PencilLine className="h-4 w-4" />
                    Review Next
                  </button>
                  <button
                    type="button"
                    onClick={acceptGoogleCandidatesForInvalidStops}
                    disabled={isPending}
                    className="inline-flex h-10 items-center justify-center gap-2 bg-amber-900 px-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Accept All Google Results
                  </button>
                </div>
              </div>
            ) : null}

            {selectedStop ? (
              <div className="border border-line bg-panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase text-muted">
                    Selection
                  </h2>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted" />
                    <button
                      type="button"
                      onClick={() => setSelectedStopId(undefined)}
                      className="inline-flex h-8 w-8 items-center justify-center border border-line bg-panel-subtle hover:border-accent hover:text-accent"
                      aria-label="Close selection"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase text-muted">
                      Address
                    </span>
                    <input
                      ref={addressInputRef}
                      value={selectedStop.address}
                      onChange={(event) =>
                        updateStop(selectedStop.id, {
                          address: event.target.value,
                          normalizedAddress: undefined,
                          latitude: undefined,
                          longitude: undefined,
                          placeId: undefined,
                          status: "needs_address_validation",
                          issue: "Address needs geocoding",
                        })
                      }
                      className="h-10 w-full border border-line bg-white px-3 text-sm"
                    />
                  </label>
                  <div
                    className={classNames(
                      "border px-3 py-2 text-xs",
                      selectedStop.status === "valid" &&
                        "border-emerald-200 bg-emerald-50 text-emerald-800",
                      selectedStop.status === "needs_address_validation" &&
                        "border-amber-200 bg-amber-50 text-amber-800",
                      selectedStop.status === "invalid" &&
                        "border-red-200 bg-red-50 text-red-800",
                    )}
                  >
                    <div className="font-semibold capitalize">
                      {selectedStop.status.replaceAll("_", " ")}
                    </div>
                    {selectedStop.issue ? (
                      <div className="mt-1">{selectedStop.issue}</div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase text-muted">
                        Latitude
                      </span>
                      <input
                        value={selectedStop.latitude ?? ""}
                        onChange={(event) =>
                          updateStop(selectedStop.id, {
                            latitude: parseCoordinate(event.target.value),
                          })
                        }
                        className="h-10 w-full border border-line bg-white px-3 font-mono text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase text-muted">
                        Longitude
                      </span>
                      <input
                        value={selectedStop.longitude ?? ""}
                        onChange={(event) =>
                          updateStop(selectedStop.id, {
                            longitude: parseCoordinate(event.target.value),
                          })
                        }
                        className="h-10 w-full border border-line bg-white px-3 font-mono text-sm"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase text-muted">
                      Notes
                    </span>
                    <textarea
                      value={selectedStop.notes ?? ""}
                      onChange={(event) =>
                        updateStop(selectedStop.id, { notes: event.target.value })
                      }
                      rows={3}
                      className="w-full resize-none border border-line bg-white p-3 text-sm"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => validateSelectedStop()}
                      disabled={isPending || !selectedStop.address.trim()}
                      className="inline-flex h-10 items-center justify-center gap-2 bg-foreground px-3 font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Check Address
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateStop(selectedStop.id, {
                          pinned: !selectedStop.pinned,
                        })
                      }
                      className="inline-flex h-10 items-center justify-center gap-2 border border-line bg-panel px-3 font-semibold hover:border-accent"
                    >
                      <Pin className="h-4 w-4" />
                      {selectedStop.pinned ? "Unpin" : "Pin"}
                    </button>
                  </div>
                  {selectedStop.status === "invalid" ? (
                    <button
                      type="button"
                      onClick={() => validateSelectedStop(true)}
                      disabled={isPending || !selectedStop.address.trim()}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 border border-amber-300 bg-amber-50 px-3 font-semibold text-amber-900 hover:border-amber-500 disabled:opacity-40"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Accept Google Result
                    </button>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        updateStop(selectedStop.id, {
                          disabled: !selectedStop.disabled,
                        })
                      }
                      className="inline-flex h-10 w-full items-center justify-center gap-2 border border-line bg-panel px-3 font-semibold hover:border-accent"
                    >
                      {selectedStop.disabled ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <PauseCircle className="h-4 w-4" />
                      )}
                      {selectedStop.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                  <div className="break-all border border-line bg-panel-subtle px-3 py-2 font-mono text-xs text-muted">
                    {selectedStop.placeId ?? "No Google place ID"}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="border border-line bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase text-muted">
                  Navigation
                </h2>
                <Flag className="h-4 w-4 text-muted" />
              </div>
              {optimizedRoute?.visitOrder.length ? (
                <div className="space-y-3">
                  {currentNavigationVisit ? (
                    <div className="border border-line bg-panel-subtle p-3">
                      <div className="font-mono text-xs font-semibold text-muted">
                        Stop {safeNavigationIndex + 1} of{" "}
                        {optimizedRoute.visitOrder.length.toLocaleString()}
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold">
                        {currentNavigationVisit.label}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => goToNavigationStep(safeNavigationIndex - 1)}
                          disabled={safeNavigationIndex === 0}
                          className="inline-flex h-9 items-center justify-center gap-2 border border-line bg-panel px-3 text-sm font-semibold hover:border-accent disabled:opacity-40"
                        >
                          <ArrowUp className="h-4 w-4" />
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => goToNavigationStep(safeNavigationIndex + 1)}
                          disabled={
                            safeNavigationIndex >= optimizedRoute.visitOrder.length - 1
                          }
                          className="inline-flex h-9 items-center justify-center gap-2 bg-foreground px-3 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
                        >
                          Next
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <ol className="max-h-80 space-y-2 overflow-auto pr-1">
                    {optimizedRoute.visitOrder.map((visit, index) => (
                      <li
                        key={`${visit.stopId}-${visit.sequence}`}
                        className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] gap-2 text-sm"
                      >
                        <span className="flex h-7 w-7 items-center justify-center bg-accent font-mono text-xs font-semibold text-white">
                          {visit.sequence}
                        </span>
                        <button
                          type="button"
                          onClick={() => goToNavigationStep(index)}
                          className={classNames(
                            "min-w-0 border border-line bg-panel-subtle px-2 py-1 text-left hover:border-accent",
                            safeNavigationIndex === index && "border-accent bg-emerald-50",
                          )}
                        >
                          <span className="block truncate font-medium">
                            {visit.label}
                          </span>
                          <span className="block font-mono text-xs text-muted">
                            {visit.role ?? "stop"}
                          </span>
                        </button>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => moveVisit(visit.stopId, -1)}
                            disabled={index === 0}
                            className="inline-flex h-7 w-8 items-center justify-center border border-line bg-panel text-xs hover:border-accent disabled:opacity-40"
                            aria-label={`Move ${visit.label} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveVisit(visit.stopId, 1)}
                            disabled={index === optimizedRoute.visitOrder.length - 1}
                            className="inline-flex h-7 w-8 items-center justify-center border border-line bg-panel text-xs hover:border-accent disabled:opacity-40"
                            aria-label={`Move ${visit.label} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={applyOptimizedOrderToStops}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 border border-line bg-panel px-3 text-sm font-semibold hover:border-accent"
                  >
                    Apply Order To List
                  </button>
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-muted">
                  No route yet
                </div>
              )}
            </div>

            <div className="border border-line bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase text-muted">
                  Export
                </h2>
                <Download className="h-4 w-4 text-muted" />
              </div>
              <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-5">
                <button
                  type="button"
                  onClick={() => exportFile("csv")}
                  className="h-10 border border-line bg-panel text-sm font-semibold hover:border-accent"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportFile("json")}
                  className="h-10 border border-line bg-panel text-sm font-semibold hover:border-accent"
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportFile("kml")}
                  className="h-10 border border-line bg-panel text-sm font-semibold hover:border-accent"
                >
                  KML
                </button>
                <button
                  type="button"
                  onClick={() => exportFile("gpx")}
                  className="h-10 border border-line bg-panel text-sm font-semibold hover:border-accent"
                >
                  GPX
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  className="h-10 border border-line bg-panel text-sm font-semibold hover:border-accent"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="border border-line bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase text-muted">
                  System
                </h2>
                <Cloud className="h-4 w-4 text-muted" />
              </div>
              <div className="space-y-2">
                <StatusPill
                  active={Boolean(systemStatus?.projectId)}
                  label="Project ID"
                />
                <StatusPill
                  active={Boolean(systemStatus?.serviceAccount)}
                  label="Service account"
                />
                <StatusPill
                  active={Boolean(systemStatus?.routeOptimizationBucket)}
                  label="Storage bucket"
                />
              </div>
              {batchJob ? (
                <div className="mt-4 border border-line bg-panel-subtle px-3 py-2 text-xs text-muted">
                  <div className="font-mono text-foreground">{batchJob.status}</div>
                  <div className="mt-1 break-all">{batchJob.operationName}</div>
                  {batchJob.message ? (
                    <div className="mt-1 text-warning">{batchJob.message}</div>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <div
                  aria-live="polite"
                  className="mt-4 border border-line bg-panel-subtle px-3 py-2 text-sm text-foreground"
                >
                  {notice}
                </div>
              ) : null}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
