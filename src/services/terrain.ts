import type { ConditionResult, ObservationLocation, TerrainProfile } from '../types';

const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const EARTH_RADIUS = 6_371_000;
const EFFECTIVE_EARTH_RADIUS = EARTH_RADIUS * 7 / 6;
const DISTANCES_KM = [.25, .5, 1, 2, 4, 8, 16, 30, 50];
const AZIMUTH_STEP = 10;
const cache = new Map<string, TerrainProfile>();

interface SamplePoint {
  latitude: number;
  longitude: number;
  azimuth?: number;
  distanceKm?: number;
}

function destination(latitude: number, longitude: number, azimuth: number, distanceKm: number) {
  const angularDistance = distanceKm * 1_000 / EARTH_RADIUS;
  const bearing = azimuth * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
  };
}

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function fetchElevationBatch(url: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (response.status !== 429 || attempt === 2) return response;
    const retryAfter = Number(response.headers.get('Retry-After'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 800 * 2 ** attempt;
    await waitForRetry(delay, signal);
  }
  throw new Error('周辺標高を取得できませんでした。');
}

async function requestElevations(points: SamplePoint[], signal?: AbortSignal) {
  const result: number[] = [];
  for (let offset = 0; offset < points.length; offset += 100) {
    const batch = points.slice(offset, offset + 100);
    const params = new URLSearchParams({
      latitude: batch.map((point) => point.latitude.toFixed(5)).join(','),
      longitude: batch.map((point) => point.longitude.toFixed(5)).join(','),
    });
    const response = await fetchElevationBatch(`${ELEVATION_URL}?${params}`, signal);
    if (!response.ok) throw new Error('周辺標高を取得できませんでした。');
    const payload = await response.json() as { elevation?: Array<number | null> };
    if (!payload.elevation || payload.elevation.length !== batch.length) throw new Error('周辺標高の応答が不正です。');
    if (payload.elevation.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('周辺標高データに欠損があります。');
    }
    result.push(...payload.elevation as number[]);
  }
  return result;
}

export async function fetchTerrainProfile(
  location: ObservationLocation,
  signal?: AbortSignal,
): Promise<ConditionResult<TerrainProfile>> {
  const cacheKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  const cached = cache.get(cacheKey);
  if (cached) return { status: 'available', data: cached, message: '保存済みの地形プロファイルを使用しています。' };

  const points: SamplePoint[] = [{ latitude: location.latitude, longitude: location.longitude }];
  for (let azimuth = 0; azimuth < 360; azimuth += AZIMUTH_STEP) {
    for (const distanceKm of DISTANCES_KM) {
      points.push({ ...destination(location.latitude, location.longitude, azimuth, distanceKm), azimuth, distanceKm });
    }
  }
  const elevations = await requestElevations(points, signal);
  const observerElevation = elevations[0];
  const samples = Array.from({ length: 360 / AZIMUTH_STEP }, (_, index) => {
    const azimuth = index * AZIMUTH_STEP;
    let maximumAltitude = -5;
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      if (point.azimuth !== azimuth || point.distanceKm === undefined) continue;
      const distance = point.distanceKm * 1_000;
      const curvatureDrop = distance * distance / (2 * EFFECTIVE_EARTH_RADIUS);
      const relativeHeight = elevations[pointIndex] - observerElevation - curvatureDrop;
      const altitude = Math.atan2(relativeHeight, distance) * 180 / Math.PI;
      maximumAltitude = Math.max(maximumAltitude, altitude);
    }
    return { azimuth, altitude: Math.max(-5, Math.min(45, maximumAltitude)) };
  });
  const profile: TerrainProfile = {
    observerElevation,
    samples,
    provenance: {
      source: 'Open-Meteo Elevation API / Copernicus DEM GLO-90',
      sourceUrl: 'https://open-meteo.com/en/docs/elevation-api',
      resolution: '標高約90 m、方位10°・距離0.25〜50 kmを標本化',
      availableFrom: 'Copernicus DEM 2021 release',
      isEstimated: true,
      note: 'DEMと地球曲率（標準屈折を考慮）から算出。建物や樹木など局所的な遮蔽物は含みません。',
    },
  };
  cache.set(cacheKey, profile);
  return { status: 'available', data: profile, message: '周辺標高から地平線を推定しました。' };
}
