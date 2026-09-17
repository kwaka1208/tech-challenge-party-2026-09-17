import { useEffect, useMemo, useRef, useState } from 'react';
import { isPointVisible } from './astronomy/horizon';
import { calculateSky, describeMoonPhase } from './astronomy/sky';
import { formatObservationDate, localObservationToUtc } from './astronomy/time';
import { ControlPanel } from './components/ControlPanel';
import { ObservationConditionsPanel } from './components/ObservationConditionsPanel';
import { SkyCanvas } from './components/SkyCanvas';
import { fetchLightPollution } from './services/lightPollution';
import { fetchTerrainProfile } from './services/terrain';
import { fetchHistoricalWeather } from './services/weather';
import type {
  ConditionResult,
  ConditionState,
  DisplayOptions,
  EnvironmentState,
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
  const [environment, setEnvironment] = useState<EnvironmentState>(loadingEnvironment);
  const skyCardRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
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

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await skyCardRef.current?.requestFullscreen();
    } catch {
      // Fullscreen may be blocked by the browser or embedding context.
    }
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
              aria-label={isFullscreen ? 'フルスクリーンを終了' : '星空をフルスクリーン表示'}
            >
              <span aria-hidden="true">{isFullscreen ? '↙' : '↗'}</span>
              <strong>{isFullscreen ? '終了' : '全画面'}</strong>
            </button>
            {calculation.sky ? (
              <SkyCanvas sky={calculation.sky} options={options} />
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
