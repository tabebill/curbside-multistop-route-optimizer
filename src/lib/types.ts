export type ParsedStop = {
  id: string;
  inputOrder: number;
  input: string;
};

export type PinStop = ParsedStop & {
  status: "ok" | "failed";
  address: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  message?: string;
};

export type OptimizedPinsRoute = {
  orderedStopIds: string[];
  distanceMeters: number;
  durationSeconds: number;
  skippedStopIds: string[];
};

export type GeocodeResult = {
  input: string;
  status: "ok" | "failed";
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  message?: string;
};
