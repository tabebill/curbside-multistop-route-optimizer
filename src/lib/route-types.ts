export type StopSource = "address" | "coordinates" | "mixed";

export type StopStatus = "valid" | "needs_address_validation" | "invalid";

export type EndMode = "round_trip" | "last_stop" | "selected_stop";

export const currentLocationStopId = "__current_location__";

export type RouteStop = {
  id: string;
  inputOrder: number;
  address: string;
  normalizedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  source: StopSource;
  status: StopStatus;
  issue?: string;
  duplicateOfInputOrder?: number;
  disabled?: boolean;
  pinned?: boolean;
  notes?: string;
};

export type GeocodeResult = {
  input: string;
  status: "ok" | "failed";
  normalizedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  message?: string;
};

export type CoordinateStop = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type OptimizedVisit = {
  stopId: string;
  label: string;
  sequence: number;
  shipmentIndex: number;
  startTime?: string;
  role?: "start" | "stop" | "end";
};

export type OptimizedRoute = {
  visitOrder: OptimizedVisit[];
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
  skippedShipmentCount: number;
  validationErrors: unknown[];
  mode?: "sync" | "async";
  jobId?: string;
  operationName?: string;
  inputUri?: string;
  outputUri?: string;
};

export type BatchOptimizationJob = {
  jobId: string;
  operationName: string;
  inputUri: string;
  outputUri: string;
  outputPrefix: string;
  status: "submitted" | "running" | "completed" | "failed";
  message?: string;
};
