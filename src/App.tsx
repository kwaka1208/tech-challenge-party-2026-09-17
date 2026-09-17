import { useEffect, useMemo, useRef, useState } from 'react';
import { isPointVisible } from './astronomy/horizon';
import { calculateSky, describeMoonPhase } from './astronomy/sky';
import { formatObservationDate, localObservationToUtc } from './astronomy/time';
import { ControlPanel } from './components/ControlPanel';
import { ObservationConditionsPanel } from './components/ObservationConditionsPanel';
import { SkyCanvas } from './components/SkyCanvas';
import { useDeviceSkyView } from './hooks/useDeviceSkyView';
import { fetchLightPollution } from './services/lightPollution';
import { resolveTimezone, reverseLocation, watchCurrentCoordinates } from './services/location';
import { fetchTerrainProfile } from './services/terrain';
import { fetchHistoricalWeather } from './services/weather';
import type {
  ConditionResult,
  ConditionState,
  DisplayOptions,
  EnvironmentState,
  GpsStatus,
  ObservationConditions,
  ObservationLocation,
} from './types';

const initialLocation: ObservationLocation = {
  name: '東京都、日本',
  latitude: 35.6812,
  longitude: 139.7671,
  elevation: 40,
  timezone: 'Asia/Tokyo',
};

function loadingEnvironment(): EnvironmentState {
  return {
    weather: { status: 'loading', message: '過去天候を取得しています…' },
    lightPollution: { status: 'loading', message: '衛星夜間光を取得しています…' },
    terrain: { status: 'loading', message: '周辺標高を取得しています…' },
  };
}

async function settleCondition<T>(promise: Promise<ConditionResult<T>>, signal: AbortSignal): Promise<ConditionState<T>> {
  try {
    return await promise;
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'error', message: error instanceof Error ? error.message : 'データを取得できませんでした。' };
  }
}

export default function App() {
  const [date, setDate] = useState('2000-01-01');
  const [time, setTime] = useState('21:00');
  const [location, setLocation] = useState(initialLocation);
  const [magnitudeLimit, setMagnitudeLimit] = useState(6.5);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [environment, setEnvironment] = useState<EnvironmentState>(loadingEnvironment);
  const skyCardRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const deviceSky = useDeviceSkyView(isFullscreen && compassEnabled);
  const [options, setOptions] = useState<DisplayOptions>({
    constellations: true,
    labels: true,
    planets: true,
    weather: true,
    lightPollution: true,
    terrain: true,
  });

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === skyCardRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (compassEnabled && (deviceSky.status === 'denied' || deviceSky.status === 'error' || deviceSky.status === 'unsupported')) {
      setCompassEnabled(false);
    }
  }, [compassEnabled, deviceSky.status]);

  const observation = useMemo(() => {
    try {
      return { utc: localObservationToUtc(date, time, location.timezone), error: '' };
    } catch (error) {
      return { utc: null, error: error instanceof Error ? error.message : '観測日時を変換できませんでした。' };
    }
  }, [date, time, location.timezone]);
  const observationTimestamp = observation.utc?.getTime() ?? null;

  useEffect(() => {
    if (!observation.utc) {
      const unavailable = { status: 'unavailable' as const, message: '有効な観測日時を指定してください。' };
      setEnvironment({ weather: unavailable, lightPollution: unavailable, terrain: unavailable });
      return;
    }
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    const signal = controller.signal;
    setEnvironment(loadingEnvironment());

    void settleCondition(fetchHistoricalWeather(observation.utc, location, signal), signal)
      .then((weather) => {
        if (!signal.aborted && requestRef.current === requestId) {
          setEnvironment((current) => ({ ...current, weather }));
        }
      }).catch(() => {
        // Aborted requests are superseded by the next observation input.
      });
    void settleCondition(fetchLightPollution(observation.utc, location, signal), signal)
      .then((lightPollution) => {
        if (!signal.aborted && requestRef.current === requestId) {
          setEnvironment((current) => ({ ...current, lightPollution }));
        }
      }).catch(() => {
        // Aborted requests are superseded by the next observation input.
      });
    void settleCondition(fetchTerrainProfile(location, signal), signal)
      .then((terrain) => {
        if (!signal.aborted && requestRef.current === requestId) {
          setEnvironment((current) => ({ ...current, terrain }));
        }
      }).catch(() => {
        // Aborted requests are superseded by the next observation input.
      });

    return () => controller.abort();
  }, [observationTimestamp, location.latitude, location.longitude, location.elevation]);

  const conditions = useMemo<ObservationConditions>(() => ({
    weather: options.weather ? environment.weather.data : undefined,
    lightPollution: options.lightPollution ? environment.lightPollution.data : undefined,
    terrain: options.terrain ? environment.terrain.data : undefined,
  }), [environment, options.weather, options.lightPollution, options.terrain]);

  const calculation = useMemo(() => {
    if (!observation.utc) return { sky: null, error: observation.error };
    try {
      return { sky: calculateSky(observation.utc, location, magnitudeLimit, conditions), error: '' };
    } catch (error) {
      return { sky: null, error: error instanceof Error ? error.message : '星空を計算できませんでした。' };
    }
  }, [observation, location, magnitudeLimit, conditions]);

  const visibleStars = calculation.sky?.stars.filter((star) => isPointVisible(star, calculation.sky?.conditions.terrain)).length ?? 0;

  useEffect(() => {
    if (!isFullscreen || !deviceSky.isMobile || !compassEnabled || !deviceSky.permissionGranted) {
      setGpsStatus('idle');
      return;
    }

    let cancelled = false;
    let resolving = false;
    let lastAttemptAt = 0;
    let lastAccepted: { latitude: number; longitude: number } | null = null;
    setGpsStatus('requesting');

    const stopWatching = watchCurrentCoordinates(async (coordinates) => {
      const now = Date.now();
      if (resolving || (lastAttemptAt > 0 && now - lastAttemptAt < 30_000)) return;
      if (lastAccepted) {
        const latitudeDistance = (coordinates.latitude - lastAccepted.latitude) * 111_320;
        const longitudeDistance = (coordinates.longitude - lastAccepted.longitude)
          * 111_320 * Math.cos(coordinates.latitude * Math.PI / 180);
        if (Math.hypot(latitudeDistance, longitudeDistance) < 100) return;
      }

      resolving = true;
      lastAttemptAt = now;
      try {
        const [name, timezone] = await Promise.all([
          reverseLocation(coordinates.latitude, coordinates.longitude),
          resolveTimezone(coordinates.latitude, coordinates.longitude),
        ]);
        if (cancelled) return;
        lastAccepted = coordinates;
        setLocation({ ...coordinates, name, timezone });
        setGpsStatus('active');
      } catch {
        if (!cancelled) setGpsStatus('error');
      } finally {
        resolving = false;
      }
    }, () => {
      if (!cancelled) setGpsStatus('error');
    });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [isFullscreen, compassEnabled, deviceSky.isMobile, deviceSky.permissionGranted]);

  const needsSensorPermission = compassEnabled
    && deviceSky.isMobile
    && deviceSky.requiresPermissionPrompt
    && !deviceSky.permissionGranted
    && deviceSky.status !== 'denied'
    && deviceSky.status !== 'error';

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (needsSensorPermission) {
        await deviceSky.prepare();
        return;
      }

      const element = skyCardRef.current;
      if (!element) return;
      const fullscreenRequest = element.requestFullscreen();
      if (deviceSky.isMobile && !deviceSky.permissionGranted && !deviceSky.requiresPermissionPrompt) {
        void deviceSky.prepare();
      }
      await fullscreenRequest;
    } catch {
      // Fullscreen may be blocked by the browser or embedding context.
    }
  };

  const toggleCompass = async () => {
    if (compassEnabled) {
      setCompassEnabled(false);
      return;
    }
    setCompassEnabled(true);
    await deviceSky.prepare();
  };

  return (
    <main className="app-shell" id="top">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="あの日の空 ホーム">
          <span className="brand-orbit" aria-hidden="true"><span>✦</span></span>
          <span>あの日の空</span>
        </a>
        <p>Birthday Sky Archive</p>
        <span className="header-note">ASTRONOMY × MEMORY</span>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="hero-copy">
            <p className="eyebrow">YOUR SKY, THAT NIGHT</p>
            <h1>あの日、空には<br />何が見えていた？</h1>
            <p className="intro">生まれた日、生まれた場所。<br />あなたの物語が始まった夜空をひらきます。</p>
          </div>
          <ControlPanel
            date={date}
            time={time}
            location={location}
            magnitudeLimit={magnitudeLimit}
            error={calculation.error}
            onDateChange={setDate}
            onTimeChange={setTime}
            onLocationChange={setLocation}
            onMagnitudeLimitChange={setMagnitudeLimit}
          />
          <p className="data-credit">恒星 NASA/HEASARC · 天候/標高 Open-Meteo · 夜間光 NASA GIBS · 天体計算 Astronomy Engine</p>
        </aside>

        <section className="sky-stage" aria-label="星空表示領域">
          <div className="stage-heading">
            <div>
              <p className="stage-kicker">THE SKY ABOVE</p>
              <h2>{formatObservationDate(date)}</h2>
              <p>{time} · {location.name}</p>
            </div>
            <span className="mode-badge"><span>◐</span>観測表示</span>
          </div>

          <div className="sky-card" ref={skyCardRef}>
            <button
              className="fullscreen-button"
              type="button"
              onClick={() => void toggleFullscreen()}
              disabled={!document.fullscreenEnabled}
              aria-label={isFullscreen
                ? 'フルスクリーンを終了'
                : needsSensorPermission
                  ? '端末の方位センサーを許可'
                  : '星空をフルスクリーン表示'}
              title={needsSensorPermission ? '最初に方位センサーを許可してください' : undefined}
            >
              <span aria-hidden="true">{isFullscreen ? '↙' : needsSensorPermission ? '◎' : '↗'}</span>
              <strong>{isFullscreen ? '終了' : needsSensorPermission ? 'センサー許可' : '全画面'}</strong>
            </button>
            {isFullscreen && deviceSky.isMobile && (
              <button
                className={`compass-toggle${compassEnabled ? ' active' : ''}`}
                type="button"
                onClick={() => void toggleCompass()}
                aria-pressed={compassEnabled}
                aria-label={deviceSky.status === 'denied' || deviceSky.status === 'error'
                  ? 'コンパス追従を再試行'
                  : compassEnabled ? 'コンパス追従を停止' : 'コンパス追従を開始'}
              >
                <span aria-hidden="true">◎</span>
                <strong>{deviceSky.status === 'denied' || deviceSky.status === 'error'
                  ? 'コンパス再試行'
                  : `コンパス ${compassEnabled ? 'ON' : 'OFF'}`}</strong>
              </button>
            )}
            {calculation.sky ? (
              <SkyCanvas
                sky={calculation.sky}
                options={options}
                mobileFullscreen={isFullscreen && deviceSky.isMobile}
                compassEnabled={compassEnabled}
                deviceView={compassEnabled ? deviceSky.view : null}
                sensorStatus={deviceSky.status}
                gpsStatus={gpsStatus}
                location={location}
              />
            ) : (
              <div className="sky-error"><span>!</span><p>{calculation.error}</p></div>
            )}
            {calculation.sky && (
              <div className="sky-stats">
                <div><span>VISIBLE STARS</span><strong>{visibleStars.toLocaleString()}<small> stars</small></strong></div>
                <div><span>MOON</span><strong>{describeMoonPhase(calculation.sky.moonPhase)}</strong></div>
                <div><span>LIMIT</span><strong>{calculation.sky.limitingMagnitude.toFixed(1)}<small> mag</small></strong></div>
              </div>
            )}
          </div>

          <ObservationConditionsPanel
            environment={environment}
            options={options}
            onOptionsChange={setOptions}
          />
          <div className="stage-footnote">
            <span className="line" />
            <p>天候は再解析、光害は衛星夜間光、地形はDEMによる推定です。各カードで年代・解像度・代替値を確認できます。</p>
          </div>
        </section>
      </section>
    </main>
  );
}
