import type { LocationSearchResult } from '../types';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const TIME_API_URL = 'https://timeapi.io/api/timezone/coordinate';

interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    'accept-language': 'ja',
  });
  const response = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('場所を検索できませんでした。');
  const places = await response.json() as NominatimPlace[];
  return places.map((place) => ({
    id: String(place.place_id),
    name: place.display_name,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
  }));
}

export async function reverseLocation(latitude: number, longitude: number) {
  try {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      zoom: '10',
      'accept-language': 'ja',
    });
    const response = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '現在地';
    const place = await response.json() as { display_name?: string };
    return place.display_name ?? '現在地';
  } catch {
    return '現在地';
  }
}

export async function resolveTimezone(latitude: number, longitude: number) {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  try {
    const response = await fetch(`${TIME_API_URL}?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    const data = await response.json() as { timeZone?: string };
    if (!data.timeZone) throw new Error();
    new Intl.DateTimeFormat('en-US', { timeZone: data.timeZone }).format(new Date());
    return data.timeZone;
  } catch {
    throw new Error('この地点のタイムゾーンを取得できませんでした。再試行するか、手動で設定してください。');
  }
}

export function getCurrentCoordinates() {
  return new Promise<{ latitude: number; longitude: number; elevation: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('このブラウザは位置情報に対応していません。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        elevation: coords.altitude ?? 0,
      }),
      () => reject(new Error('現在地を取得できませんでした。ブラウザの位置情報を許可してください。')),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 300_000 },
    );
  });
}

export function watchCurrentCoordinates(
  onPosition: (coordinates: { latitude: number; longitude: number; elevation: number }) => void,
  onError: () => void,
) {
  if (!navigator.geolocation) {
    queueMicrotask(onError);
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(
    ({ coords }) => onPosition({
      latitude: coords.latitude,
      longitude: coords.longitude,
      elevation: coords.altitude ?? 0,
    }),
    onError,
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
