import { Body, Equator, Horizon, Illumination, MoonPhase, Observer, SiderealTime } from 'astronomy-engine';
import { CATALOG_STARS } from '../data/catalog';
import type { ObservationConditions, ObservationLocation, SkyModel, SkyPoint } from '../types';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

interface EquatorialPosition {
  ra: number;
  dec: number;
}

function julianDate(date: Date) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function precessFromJ2000(raHours: number, decDegrees: number, date: Date): EquatorialPosition {
  const centuries = (julianDate(date) - 2_451_545) / 36_525;
  const zeta = (2306.2181 * centuries + .30188 * centuries ** 2 + .017998 * centuries ** 3) / 3600 * DEG;
  const z = (2306.2181 * centuries + 1.09468 * centuries ** 2 + .018203 * centuries ** 3) / 3600 * DEG;
  const theta = (2004.3109 * centuries - .42665 * centuries ** 2 - .041833 * centuries ** 3) / 3600 * DEG;
  const ra = raHours * 15 * DEG;
  const dec = decDegrees * DEG;
  const a = Math.cos(dec) * Math.sin(ra + zeta);
  const b = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
  const c = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
  return {
    ra: ((((Math.atan2(a, b) + z) * RAD) % 360) + 360) % 360 / 15,
    dec: Math.asin(Math.max(-1, Math.min(1, c))) * RAD,
  };
}

function horizontalPosition(raHours: number, decDegrees: number, siderealDegrees: number, latitudeDegrees: number) {
  const hourAngle = ((((siderealDegrees - raHours * 15) % 360) + 540) % 360 - 180) * DEG;
  const dec = decDegrees * DEG;
  const latitude = latitudeDegrees * DEG;
  const altitudeRadians = Math.asin(
    Math.sin(dec) * Math.sin(latitude) + Math.cos(dec) * Math.cos(latitude) * Math.cos(hourAngle),
  );
  let altitude = altitudeRadians * RAD;
  const azimuth = ((Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(dec) * Math.cos(latitude),
  ) * RAD + 180) % 360 + 360) % 360;

  if (altitude > -1 && altitude < 89.9) {
    altitude += 1.02 / Math.tan((altitude + 10.3 / (altitude + 5.11)) * DEG) / 60;
  }
  return { altitude, azimuth };
}

function starPoints(date: Date, observer: Observer, maximumMagnitude: number): SkyPoint[] {
  const siderealDegrees = SiderealTime(date) * 15 + observer.longitude;
  return CATALOG_STARS
    .filter((star) => star.magnitude <= maximumMagnitude)
    .map((star) => {
      const equatorial = precessFromJ2000(star.ra, star.dec, date);
      const horizontal = horizontalPosition(equatorial.ra, equatorial.dec, siderealDegrees, observer.latitude);
      return { ...horizontal, id: star.id, name: star.name, magnitude: star.magnitude, color: star.color, kind: 'star' as const };
    });
}

const BODY_DEFINITIONS = [
  { body: Body.Sun, id: 'sun', name: '太陽', kind: 'sun' as const, color: '#ffd79a' },
  { body: Body.Moon, id: 'moon', name: '月', kind: 'moon' as const, color: '#fff5d6' },
  { body: Body.Mercury, id: 'mercury', name: '水星', kind: 'planet' as const, color: '#d7c6b0' },
  { body: Body.Venus, id: 'venus', name: '金星', kind: 'planet' as const, color: '#fff0bd' },
  { body: Body.Mars, id: 'mars', name: '火星', kind: 'planet' as const, color: '#ff9b77' },
  { body: Body.Jupiter, id: 'jupiter', name: '木星', kind: 'planet' as const, color: '#ffe0ae' },
  { body: Body.Saturn, id: 'saturn', name: '土星', kind: 'planet' as const, color: '#ecd39b' },
] as const;

function bodyPoints(date: Date, observer: Observer): SkyPoint[] {
  return BODY_DEFINITIONS.map(({ body, id, name, kind, color }) => {
    const equatorial = Equator(body, date, observer, true, true);
    const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal');
    const magnitude = body === Body.Sun ? -26.7 : body === Body.Moon ? -12.5 : Illumination(body, date).mag;
    return { id, name, altitude: horizontal.altitude, azimuth: horizontal.azimuth, magnitude, color, kind };
  });
}

function naturalLimitingMagnitude(sunAltitude: number, moonAltitude: number, moonLight: number) {
  if (sunAltitude > -4) return -1;
  if (sunAltitude > -10) return 1.8;
  if (sunAltitude > -18) return 4.2;
  return Math.max(3.8, 6.5 - (moonAltitude > 0 ? moonLight * 1.35 : 0));
}

export function calculateSky(
  date: Date,
  location: ObservationLocation,
  requestedMagnitude: number,
  conditions: ObservationConditions = {},
): SkyModel {
  const elevation = conditions.terrain?.observerElevation ?? location.elevation;
  const observer = new Observer(location.latitude, location.longitude, elevation);
  const bodies = bodyPoints(date, observer);
  const sunAltitude = bodies.find((body) => body.kind === 'sun')?.altitude ?? -90;
  const moonAltitude = bodies.find((body) => body.kind === 'moon')?.altitude ?? -90;
  const moonPhase = MoonPhase(date);
  const moonIllumination = (1 - Math.cos(moonPhase * DEG)) / 2;
  const selectedLimit = Math.max(1, Math.min(6.5, requestedMagnitude));
  const limit = Math.min(
    selectedLimit,
    naturalLimitingMagnitude(sunAltitude, moonAltitude, moonIllumination),
    conditions.weather?.limitingMagnitude ?? Number.POSITIVE_INFINITY,
    conditions.lightPollution?.limitingMagnitude ?? Number.POSITIVE_INFINITY,
  );

  return {
    stars: starPoints(date, observer, limit),
    bodies,
    sunAltitude,
    moonIllumination,
    moonPhase,
    limitingMagnitude: limit,
    conditions,
  };
}

export function describeMoonPhase(phase: number) {
  if (phase < 22.5 || phase >= 337.5) return '新月';
  if (phase < 67.5) return '三日月';
  if (phase < 112.5) return '上弦';
  if (phase < 157.5) return '十三夜';
  if (phase < 202.5) return '満月';
  if (phase < 247.5) return '寝待月';
  if (phase < 292.5) return '下弦';
  return '有明月';
}
