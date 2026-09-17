import { useEffect, useRef, useState } from 'react';
import { horizonAltitudeAt, isPointVisible } from '../astronomy/horizon';
import { CONSTELLATIONS } from '../data/stars';
import type {
  DeviceSensorStatus,
  DeviceSkyView,
  DisplayOptions,
  GpsStatus,
  ObservationLocation,
  SkyModel,
  SkyPoint,
} from '../types';

interface SkyCanvasProps {
  sky: SkyModel;
  options: DisplayOptions;
  mobileFullscreen: boolean;
  compassEnabled: boolean;
  deviceView: DeviceSkyView | null;
  sensorStatus: DeviceSensorStatus;
  gpsStatus: GpsStatus;
  location: ObservationLocation;
}

interface Point { x: number; y: number; }
interface Vector { east: number; north: number; up: number; }

const DEG = Math.PI / 180;
const TARGET_ANGLE = Math.cos(12 * DEG);

function skyVector(point: Pick<SkyPoint, 'altitude' | 'azimuth'>): Vector {
  const altitude = point.altitude * DEG;
  const azimuth = point.azimuth * DEG;
  const horizontal = Math.cos(altitude);
  return {
    east: horizontal * Math.sin(azimuth),
    north: horizontal * Math.cos(azimuth),
    up: Math.sin(altitude),
  };
}

function dot(left: Vector, right: Vector) {
  return left.east * right.east + left.north * right.north + left.up * right.up;
}

function cameraAxes(view: DeviceSkyView) {
  return { forward: view.forward, right: view.right, up: view.up };
}

function sensorMessage(status: DeviceSensorStatus) {
  if (status === 'active') return 'コンパス追従中';
  if (status === 'requesting') return '方位センサーを待っています…';
  if (status === 'denied') return '方位センサーの利用が許可されていません';
  if (status === 'unsupported') return 'この端末は方位センサーに対応していません';
  if (status === 'error') return '方位センサーを開始できませんでした';
  return '方位センサー準備中';
}

function gpsMessage(status: GpsStatus) {
  if (status === 'active') return 'GPS取得済み';
  if (status === 'requesting') return 'GPSを取得しています…';
  if (status === 'error') return 'GPSを取得できませんでした';
  return 'GPS待機中';
}

function kindName(kind: SkyPoint['kind']) {
  if (kind === 'star') return '恒星';
  if (kind === 'planet') return '惑星';
  if (kind === 'moon') return '月';
  return '太陽';
}

export function SkyCanvas({
  sky,
  options,
  mobileFullscreen,
  compassEnabled,
  deviceView,
  sensorStatus,
  gpsStatus,
  location,
}: SkyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; azimuth: number } | null>(null);
  const azimuthOffsetRef = useRef(0);
  const zoomRef = useRef(1);
  const deviceViewRef = useRef<DeviceSkyView | null>(deviceView);
  const selectedTargetRef = useRef<SkyPoint | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const animationFrameRef = useRef(0);
  const [selectedTarget, setSelectedTarget] = useState<SkyPoint | null>(null);

  const requestDraw = () => {
    if (animationFrameRef.current) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = 0;
      drawRef.current?.();
    });
  };

  useEffect(() => {
    deviceViewRef.current = deviceView;
    requestDraw();
  }, [deviceView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const terrain = sky.conditions.terrain;
    const weather = sky.conditions.weather;
    const lightPollution = sky.conditions.lightPollution;
    const visibleStars = sky.stars.filter((star) => isPointVisible(star, terrain)).sort((a, b) => b.magnitude - a.magnitude);
    const namedStars = visibleStars.filter((star) => star.name);
    const visibleBodies = sky.bodies.filter((body) => isPointVisible(body, terrain));

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const view = mobileFullscreen ? deviceViewRef.current : null;
      const tracking = Boolean(view);
      const axes = view ? cameraAxes(view) : null;
      const center = { x: width / 2, y: height / 2 - (tracking ? 0 : 8) };
      const horizonRadius = Math.min(width, height) * .425;
      const night = sky.sunAltitude <= -10;
      const twilight = sky.sunAltitude > -10 && sky.sunAltitude <= 0;
      const topColor = night ? '#061526' : twilight ? '#17304c' : '#557a9e';
      const bottomColor = night ? '#132b3d' : twilight ? '#a56d70' : '#e7ba8e';
      const background = tracking
        ? context.createLinearGradient(0, 0, 0, height)
        : context.createRadialGradient(center.x, center.y - horizonRadius * .35, 20, center.x, center.y, horizonRadius * 1.2);
      background.addColorStop(0, topColor);
      background.addColorStop(1, bottomColor);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.save();
      context.beginPath();
      if (tracking) context.rect(0, 0, width, height);
      else context.arc(center.x, center.y, horizonRadius, 0, Math.PI * 2);
      context.clip();

      const project = (point: Pick<SkyPoint, 'altitude' | 'azimuth'>): Point | null => {
        if (point.altitude < -1) return null;
        if (tracking && axes) {
          const vector = skyVector(point);
          const depth = dot(vector, axes.forward);
          if (depth <= .05) return null;
          const focalLength = height / (2 * Math.tan(31 * DEG));
          const x = center.x + dot(vector, axes.right) / depth * focalLength;
          const y = center.y - dot(vector, axes.up) / depth * focalLength;
          if (x < -40 || x > width + 40 || y < -40 || y > height + 40) return null;
          return { x, y };
        }
        const distance = ((90 - point.altitude) / 90) * horizonRadius * zoomRef.current;
        if (distance > horizonRadius * 1.04) return null;
        const angle = (point.azimuth - azimuthOffsetRef.current) * DEG;
        return { x: center.x + Math.sin(angle) * distance, y: center.y - Math.cos(angle) * distance };
      };

      if (night && lightPollution) {
        const strength = Math.max(0, Math.min(1, (lightPollution.bortleClass - 1) / 8));
        const glowRadius = tracking ? Math.max(width, height) : horizonRadius;
        const glow = context.createRadialGradient(center.x, center.y, glowRadius * .18, center.x, center.y, glowRadius);
        glow.addColorStop(0, 'rgba(135, 153, 161, 0)');
        glow.addColorStop(.62, `rgba(178, 140, 105, ${strength * .08})`);
        glow.addColorStop(1, `rgba(222, 151, 96, ${strength * .34})`);
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }

      for (const star of visibleStars) {
        const point = project(star);
        if (!point) continue;
        const radius = Math.max(.38, 3.35 - star.magnitude * .45);
        if (radius > 1.65) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3.2);
          glow.addColorStop(0, star.color);
          glow.addColorStop(.2, `${star.color}b8`);
          glow.addColorStop(1, `${star.color}00`);
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, radius * 3.2, 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = Math.max(.5, 1 - Math.max(0, star.magnitude) * .055);
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        if (options.labels && star.name && (tracking || star.magnitude <= .9)) {
          context.fillStyle = 'rgba(234, 241, 247, .74)';
          context.font = "10px 'Noto Sans JP', sans-serif";
          context.fillText(star.name, point.x + radius + 5, point.y - radius - 2);
        }
      }

      if (options.constellations) {
        const projectedNamedStars = new Map<string, Point>();
        for (const star of namedStars) {
          const point = project(star);
          if (point) projectedNamedStars.set(star.id, point);
        }
        context.lineWidth = .65;
        context.strokeStyle = 'rgba(136, 170, 184, .28)';
        context.fillStyle = 'rgba(154, 194, 207, .62)';
        context.font = "10px 'Noto Sans JP', sans-serif";
        for (const constellation of CONSTELLATIONS) {
          const labelPoints: Point[] = [];
          for (const [from, to] of constellation.lines) {
            const start = projectedNamedStars.get(from);
            const end = projectedNamedStars.get(to);
            if (!start || !end) continue;
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
            labelPoints.push(start, end);
          }
          if (options.labels && labelPoints.length) {
            const x = labelPoints.reduce((sum, point) => sum + point.x, 0) / labelPoints.length;
            const y = labelPoints.reduce((sum, point) => sum + point.y, 0) / labelPoints.length;
            context.fillText(constellation.name, x + 7, y - 7);
          }
        }
      }

      if (options.planets) {
        for (const body of visibleBodies) {
          const point = project(body);
          if (!point) continue;
          const radius = body.kind === 'sun' ? 14 : body.kind === 'moon' ? 11 : 3;
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3);
          glow.addColorStop(0, `${body.color}ee`);
          glow.addColorStop(.25, `${body.color}70`);
          glow.addColorStop(1, `${body.color}00`);
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, radius * 3, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = body.kind === 'moon' ? '#fff3d1' : body.color;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fill();
          if (options.labels) {
            context.fillStyle = 'rgba(255, 243, 219, .88)';
            context.font = "11px 'Noto Sans JP', sans-serif";
            context.fillText(body.name, point.x + radius + 6, point.y + 3);
          }
        }
      }

      if (weather && weather.cloudCover > 2) {
        const cloudOpacity = Math.min(.76, weather.cloudCover / 100 * .68 + Math.min(.12, weather.precipitation * .025));
        const cloudRadius = tracking ? Math.max(width, height) * .35 : horizonRadius * .5;
        for (let index = 0; index < 7; index += 1) {
          const angle = (index * 137.5 + 18) * DEG;
          const distance = (tracking ? Math.min(width, height) : horizonRadius) * (.18 + (index % 3) * .2);
          const x = center.x + Math.sin(angle) * distance;
          const y = center.y - Math.cos(angle) * distance;
          const cloud = context.createRadialGradient(x, y, 0, x, y, cloudRadius);
          cloud.addColorStop(0, `rgba(184, 196, 201, ${cloudOpacity * .3})`);
          cloud.addColorStop(.45, `rgba(132, 151, 163, ${cloudOpacity * .17})`);
          cloud.addColorStop(1, 'rgba(95, 115, 130, 0)');
          context.fillStyle = cloud;
          context.fillRect(0, 0, width, height);
        }
      }

      if (terrain?.samples.length) {
        if (tracking) {
          context.strokeStyle = 'rgba(115, 143, 148, .55)';
          context.lineWidth = 1.2;
          let previous: Point | null = null;
          for (let azimuth = 0; azimuth <= 360; azimuth += 1) {
            const point = project({ azimuth, altitude: Math.max(0, horizonAltitudeAt(azimuth, terrain)) });
            if (point && previous && Math.hypot(point.x - previous.x, point.y - previous.y) < width * .2) {
              context.beginPath();
              context.moveTo(previous.x, previous.y);
              context.lineTo(point.x, point.y);
              context.stroke();
            }
            previous = point;
          }
        } else {
          context.beginPath();
          context.arc(center.x, center.y, horizonRadius * 1.02, 0, Math.PI * 2);
          for (let azimuth = 0; azimuth <= 360; azimuth += 2) {
            const altitude = Math.max(0, horizonAltitudeAt(azimuth, terrain));
            const distance = ((90 - altitude) / 90) * horizonRadius * zoomRef.current;
            const angle = (azimuth - azimuthOffsetRef.current) * DEG;
            const x = center.x + Math.sin(angle) * distance;
            const y = center.y - Math.cos(angle) * distance;
            if (azimuth === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.closePath();
          context.fillStyle = 'rgba(3, 12, 19, .94)';
          context.fill('evenodd');
          context.strokeStyle = 'rgba(115, 143, 148, .42)';
          context.lineWidth = 1;
          context.stroke();
        }
      }

      context.restore();
      if (tracking && axes) {
        const targets = options.planets ? [...namedStars, ...visibleBodies] : namedStars;
        let candidate: SkyPoint | null = null;
        let bestAlignment = TARGET_ANGLE;
        for (const target of targets) {
          const alignment = dot(skyVector(target), axes.forward);
          if (alignment > bestAlignment) {
            bestAlignment = alignment;
            candidate = target;
          }
        }
        if (candidate?.id !== selectedTargetRef.current?.id) {
          selectedTargetRef.current = candidate;
          setSelectedTarget(candidate);
        }
      } else {
        if (selectedTargetRef.current) {
          selectedTargetRef.current = null;
          setSelectedTarget(null);
        }
        context.strokeStyle = 'rgba(175, 205, 214, .32)';
        context.lineWidth = 1;
        context.beginPath();
        context.arc(center.x, center.y, horizonRadius, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = 'rgba(209, 225, 231, .7)';
        context.font = "600 10px 'DM Sans', sans-serif";
        context.textAlign = 'center';
        const directions = [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const;
        for (const [label, azimuth] of directions) {
          const angle = (azimuth - azimuthOffsetRef.current) * DEG;
          context.fillText(label, center.x + Math.sin(angle) * (horizonRadius + 17), center.y - Math.cos(angle) * (horizonRadius + 17) + 4);
        }
        context.textAlign = 'start';
      }
    };

    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(requestDraw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (drawRef.current === draw) drawRef.current = null;
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    };
  }, [sky, options, mobileFullscreen]);

  const tracking = mobileFullscreen && Boolean(deviceView);

  return (
    <div className={`sky-canvas-wrap${tracking ? ' device-tracking' : ''}`}>
      <canvas
        ref={canvasRef}
        className="sky-canvas"
        aria-label={tracking
          ? 'GPSと端末の向きに追従する星空。画面中央の方向にある天体情報を表示します。'
          : '指定した日時と場所の全天星図。ドラッグで方角、ホイールで拡大率を変更できます。'}
        onPointerDown={(event) => {
          if (tracking) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, azimuth: azimuthOffsetRef.current };
        }}
        onPointerMove={(event) => {
          if (tracking || !dragRef.current) return;
          azimuthOffsetRef.current = dragRef.current.azimuth + (dragRef.current.x - event.clientX) * .32;
          requestDraw();
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={(event) => {
          if (tracking) return;
          event.preventDefault();
          zoomRef.current = Math.max(.82, Math.min(2.2, zoomRef.current - event.deltaY * .001));
          requestDraw();
        }}
      />
      {!tracking && (
        <div className="canvas-tools" aria-label="星図操作">
          <button type="button" onClick={() => { zoomRef.current = Math.min(2.2, zoomRef.current + .18); requestDraw(); }} aria-label="拡大">＋</button>
          <button type="button" onClick={() => { zoomRef.current = Math.max(.82, zoomRef.current - .18); requestDraw(); }} aria-label="縮小">−</button>
          <button type="button" onClick={() => { zoomRef.current = 1; azimuthOffsetRef.current = 0; requestDraw(); }} aria-label="表示をリセット">↺</button>
        </div>
      )}
      {!mobileFullscreen && <p className="canvas-hint"><span>↔</span> ドラッグして空を見渡す</p>}
      {mobileFullscreen && (
        <div className="device-sky-hud" aria-live="polite">
          <div className="device-status">
            <span className={compassEnabled && sensorStatus === 'active' ? 'active' : ''}>◉ {compassEnabled ? sensorMessage(sensorStatus) : 'コンパス追従OFF'}</span>
            <span className={gpsStatus === 'active' ? 'active' : ''}>⌖ {gpsMessage(gpsStatus)}</span>
          </div>
          {deviceView && (
            <div className="device-heading">
              <strong>{Math.round(deviceView.heading).toString().padStart(3, '0')}°</strong>
              <span>高度 {Math.round(deviceView.altitude)}°</span>
            </div>
          )}
          <div className="device-location">
            {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
          </div>
        </div>
      )}
      {tracking && <div className="sky-reticle" aria-hidden="true"><span /></div>}
      {tracking && selectedTarget && (
        <div className="target-card">
          <span>{kindName(selectedTarget.kind)} · CENTER TARGET</span>
          <strong>{selectedTarget.name}</strong>
          <p>高度 {selectedTarget.altitude.toFixed(1)}° · 方位 {selectedTarget.azimuth.toFixed(1)}° · {selectedTarget.magnitude.toFixed(1)}等級</p>
        </div>
      )}
      {mobileFullscreen && compassEnabled && !deviceView && sensorStatus !== 'requesting' && (
        <p className="device-fallback">端末センサーを利用できないため、通常の星図を表示しています。</p>
      )}
    </div>
  );
}
