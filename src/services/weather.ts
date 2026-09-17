import type { ConditionResult, ObservationLocation, WeatherConditions } from '../types';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FIRST_AVAILABLE = Date.UTC(1940, 0, 1);
const ARCHIVE_DELAY_MS = 5 * 86_400_000;

interface ArchiveResponse {
  hourly?: {
    time?: string[];
    cloud_cover?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    visibility?: Array<number | null>;
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function requiredFiniteValue(value: number | null | undefined, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`過去天候の${label}が欠損しています。`);
  }
  return value;
}

function weatherLimitingMagnitude(cloudCover: number, humidity: number, precipitation: number, visibility?: number) {
  let limit = cloudCover >= 98 ? -1 : cloudCover >= 90 ? .5 : cloudCover >= 75 ? 2
    : cloudCover >= 60 ? 3 : cloudCover >= 40 ? 4.2 : cloudCover >= 20 ? 5.4 : 6.5;
  if (precipitation >= 2) limit = Math.min(limit, .5);
  else if (precipitation > .1) limit = Math.min(limit, 2.5);
  if (humidity >= 95) limit = Math.min(limit, 3.8);
  else if (humidity >= 85) limit = Math.min(limit, 5.2);
  if (visibility !== undefined) {
    if (visibility < 1_000) limit = Math.min(limit, 0);
    else if (visibility < 5_000) limit = Math.min(limit, 2);
    else if (visibility < 10_000) limit = Math.min(limit, 4.5);
  }
  return limit;
}

export async function fetchHistoricalWeather(
  date: Date,
  location: ObservationLocation,
  signal?: AbortSignal,
): Promise<ConditionResult<WeatherConditions>> {
  const timestamp = date.getTime();
  if (timestamp < FIRST_AVAILABLE) {
    return { status: 'unavailable', message: '1940年より前は再解析データの対象外です。' };
  }
  if (timestamp > Date.now() - ARCHIVE_DELAY_MS) {
    return { status: 'unavailable', message: '未来または直近5日間は過去天候の対象外です。' };
  }

  const day = isoDate(date);
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    start_date: day,
    end_date: day,
    hourly: 'cloud_cover,relative_humidity_2m,precipitation,visibility',
    timezone: 'GMT',
  });
  const response = await fetch(`${ARCHIVE_URL}?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('過去天候を取得できませんでした。');
  const payload = await response.json() as ArchiveResponse;
  const hourly = payload.hourly;
  if (!hourly?.time?.length) throw new Error('過去天候の応答に時系列データがありません。');

  const target = date.getTime();
  const index = hourly.time.reduce((nearest, value, current) => {
    const currentDistance = Math.abs(Date.parse(`${value}Z`) - target);
    const nearestDistance = Math.abs(Date.parse(`${hourly.time?.[nearest]}Z`) - target);
    return currentDistance < nearestDistance ? current : nearest;
  }, 0);
  const cloudCover = requiredFiniteValue(hourly.cloud_cover?.[index], '雲量');
  const relativeHumidity = requiredFiniteValue(hourly.relative_humidity_2m?.[index], '相対湿度');
  const precipitation = requiredFiniteValue(hourly.precipitation?.[index], '降水量');
  const rawVisibility = hourly.visibility?.[index];
  const visibility = typeof rawVisibility === 'number' && Number.isFinite(rawVisibility) ? rawVisibility : undefined;
  const observedAt = `${hourly.time[index]}Z`;

  return {
    status: 'estimated',
    message: '観測値と数値モデルを統合した再解析値です。',
    data: {
      cloudCover,
      relativeHumidity,
      precipitation,
      visibility,
      limitingMagnitude: weatherLimitingMagnitude(cloudCover, relativeHumidity, precipitation, visibility),
      provenance: {
        source: 'Open-Meteo Historical Weather API',
        sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
        resolution: '地点・年代により約9〜25 km、1時間間隔',
        availableFrom: '1940-01-01',
        observedAt,
        isEstimated: true,
        note: '気象観測と再解析モデルによる推定であり、地点での実測値ではありません。',
      },
    },
  };
}
