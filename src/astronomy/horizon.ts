import type { SkyPoint, TerrainProfile } from '../types';

export function horizonAltitudeAt(azimuth: number, terrain?: TerrainProfile) {
  const samples = terrain?.samples;
  if (!samples?.length) return 0;
  const normalized = ((azimuth % 360) + 360) % 360;
  let upperIndex = samples.findIndex((sample) => sample.azimuth >= normalized);
  if (upperIndex < 0) upperIndex = 0;
  const upper = samples[upperIndex];
  const lower = samples[(upperIndex - 1 + samples.length) % samples.length];
  const afterLastSample = upperIndex === 0 && normalized > upper.azimuth;
  const lowerAzimuth = upperIndex === 0 && !afterLastSample ? lower.azimuth - 360 : lower.azimuth;
  const upperAzimuth = afterLastSample ? upper.azimuth + 360 : upper.azimuth;
  const span = upperAzimuth - lowerAzimuth;
  const fraction = span === 0 ? 0 : (normalized - lowerAzimuth) / span;
  return lower.altitude + (upper.altitude - lower.altitude) * Math.max(0, Math.min(1, fraction));
}

export function isPointVisible(point: Pick<SkyPoint, 'altitude' | 'azimuth'>, terrain?: TerrainProfile) {
  return point.altitude >= Math.max(0, horizonAltitudeAt(point.azimuth, terrain));
}
