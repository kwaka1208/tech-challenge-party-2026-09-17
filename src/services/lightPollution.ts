import type { ConditionResult, LightPollutionConditions, ObservationLocation } from '../types';

const WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const LAYER = 'VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance';
const FIRST_AVAILABLE = Date.UTC(2012, 0, 19);
const REFERENCE_DATE = '2016-01-01';

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function radianceFromGray(gray: number) {
  return Math.max(0, Math.exp((gray / 255) * Math.log(39.2)) - 1);
}

function classifyBortle(radiance: number) {
  if (radiance < .15) return 1;
  if (radiance < .3) return 2;
  if (radiance < .6) return 3;
  if (radiance < 1.5) return 4;
  if (radiance < 3) return 5;
  if (radiance < 8) return 6;
  if (radiance < 20) return 7;
  if (radiance < 38.2) return 8;
  return 9;
}

const BORTLE_LIMITS = [0, 6.5, 6.5, 6.5, 6.2, 5.7, 5.2, 4.7, 4.2, 3.7];

async function readRadiance(response: Response) {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!response.ok || !contentType.includes('image/png')) throw new Error('NASA夜間光画像を取得できませんでした。');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('夜間光画像を解析できませんでした。');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const values: number[] = [];
    const marginX = Math.floor(bitmap.width * .25);
    const marginY = Math.floor(bitmap.height * .25);
    for (let y = marginY; y < bitmap.height - marginY; y += 1) {
      for (let x = marginX; x < bitmap.width - marginX; x += 1) {
        const offset = (y * bitmap.width + x) * 4;
        if (pixels[offset + 3] < 128) continue;
        if (Math.abs(pixels[offset] - pixels[offset + 1]) > 2 || Math.abs(pixels[offset] - pixels[offset + 2]) > 2) continue;
        values.push(pixels[offset]);
      }
    }
    if (!values.length) throw new Error('指定地点のNASA夜間光データがありません。');
    values.sort((a, b) => a - b);
    return radianceFromGray(values[Math.floor(values.length / 2)]);
  } finally {
    bitmap.close();
  }
}

async function fetchRadiance(date: string, location: ObservationLocation, signal?: AbortSignal) {
  const latitudeSpan = .015;
  const longitudeSpan = latitudeSpan / Math.max(.2, Math.cos(location.latitude * Math.PI / 180));
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: LAYER,
    STYLES: '',
    CRS: 'EPSG:4326',
    BBOX: `${location.latitude - latitudeSpan},${location.longitude - longitudeSpan},${location.latitude + latitudeSpan},${location.longitude + longitudeSpan}`,
    WIDTH: '32',
    HEIGHT: '32',
    FORMAT: 'image/png',
    TIME: date,
    TRANSPARENT: 'TRUE',
  });
  return readRadiance(await fetch(`${WMS_URL}?${params}`, { signal }));
}

export async function fetchLightPollution(
  date: Date,
  location: ObservationLocation,
  signal?: AbortSignal,
): Promise<ConditionResult<LightPollutionConditions>> {
  const latestUsable = Date.now() - 2 * 86_400_000;
  const useRequestedDate = date.getTime() >= FIRST_AVAILABLE && date.getTime() <= latestUsable;
  const requestedDate = isoDate(date);
  let observedAt = useRequestedDate ? requestedDate : REFERENCE_DATE;
  let usedFallback = !useRequestedDate;
  let radiance: number;

  try {
    radiance = await fetchRadiance(observedAt, location, signal);
  } catch (error) {
    if (signal?.aborted || observedAt === REFERENCE_DATE) throw error;
    observedAt = REFERENCE_DATE;
    usedFallback = true;
    radiance = await fetchRadiance(observedAt, location, signal);
  }

  const bortleClass = classifyBortle(radiance);
  return {
    status: 'estimated',
    message: usedFallback
      ? '指定年代に衛星データがないため、2016年の夜間光を代替値として使用しています。'
      : '指定日の衛星夜間光からBortle相当を推定しています。',
    data: {
      radiance,
      bortleClass,
      limitingMagnitude: BORTLE_LIMITS[bortleClass],
      provenance: {
        source: 'NASA GIBS / VIIRS Black Marble VNP46A2',
        sourceUrl: 'https://www.earthdata.nasa.gov/data/projects/black-marble',
        resolution: '約500 m、日次',
        availableFrom: '2012-01-19',
        observedAt,
        isEstimated: true,
        note: usedFallback
          ? '2016年の参照値であり、指定当時の光害を再現するものではありません。'
          : '衛星放射輝度をBortle階級相当へ換算した概算です。',
      },
    },
  };
}
