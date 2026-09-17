export interface ObservationLocation {
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
}

export interface DisplayOptions {
  constellations: boolean;
  labels: boolean;
  planets: boolean;
  weather: boolean;
  lightPollution: boolean;
  terrain: boolean;
}

export interface StarRecord {
  id: string;
  name: string;
  ra: number;
  dec: number;
  magnitude: number;
  color: string;
}

export interface SkyPoint {
  id: string;
  name: string;
  altitude: number;
  azimuth: number;
  magnitude: number;
  color: string;
  kind: 'star' | 'sun' | 'moon' | 'planet';
}

export interface DataProvenance {
  source: string;
  sourceUrl: string;
  resolution: string;
  availableFrom: string;
  observedAt?: string;
  isEstimated: boolean;
  note: string;
}

export interface WeatherConditions {
  cloudCover: number;
  relativeHumidity: number;
  precipitation: number;
  visibility?: number;
  limitingMagnitude: number;
  provenance: DataProvenance;
}

export interface LightPollutionConditions {
  radiance: number;
  bortleClass: number;
  limitingMagnitude: number;
  provenance: DataProvenance;
}

export interface HorizonSample {
  azimuth: number;
  altitude: number;
}

export interface TerrainProfile {
  observerElevation: number;
  samples: HorizonSample[];
  provenance: DataProvenance;
}

export interface ObservationConditions {
  weather?: WeatherConditions;
  lightPollution?: LightPollutionConditions;
  terrain?: TerrainProfile;
}

export type ConditionStatus = 'loading' | 'available' | 'estimated' | 'unavailable' | 'error';

export interface ConditionState<T> {
  status: ConditionStatus;
  data?: T;
  message: string;
}

export interface EnvironmentState {
  weather: ConditionState<WeatherConditions>;
  lightPollution: ConditionState<LightPollutionConditions>;
  terrain: ConditionState<TerrainProfile>;
}

export type ConditionResult<T> =
  | { status: 'available' | 'estimated'; data: T; message: string }
  | { status: 'unavailable'; message: string };

export interface ConstellationRecord {
  id: string;
  name: string;
  lines: Array<[string, string]>;
}

export interface SkyModel {
  stars: SkyPoint[];
  bodies: SkyPoint[];
  sunAltitude: number;
  moonIllumination: number;
  moonPhase: number;
  limitingMagnitude: number;
  conditions: ObservationConditions;
}

export interface LocationSearchResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}
