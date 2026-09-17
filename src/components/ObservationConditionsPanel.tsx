import type { ConditionState, DataProvenance, DisplayOptions, EnvironmentState } from '../types';

interface ObservationConditionsPanelProps {
  environment: EnvironmentState;
  options: DisplayOptions;
  onOptionsChange: (value: DisplayOptions) => void;
}

const STATUS_LABELS = {
  loading: '取得中',
  available: '取得済み',
  estimated: '推定',
  unavailable: '年代外',
  error: '取得失敗',
} as const;

function PanelSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch-row panel-switch-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" aria-hidden="true"><span /></span>
    </label>
  );
}

function ConditionCard<T extends { provenance: DataProvenance }>({
  title,
  icon,
  state,
  enabled,
  describe,
}: {
  title: string;
  icon: string;
  state: ConditionState<T>;
  enabled: boolean;
  describe: (data: T) => string;
}) {
  const provenance = state.data?.provenance;
  return (
    <article className={`condition-card ${enabled ? `status-${state.status}` : 'status-off'}`}>
      <div className="condition-heading">
        <span aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
        <strong>{enabled ? STATUS_LABELS[state.status] : 'OFF'}</strong>
      </div>
      <p className="condition-value">{state.data ? describe(state.data) : state.message}</p>
      {(state.data || !enabled) && (
        <p className="condition-message">{enabled ? state.message : '星空への反映を停止しています。'}</p>
      )}
      {provenance && (
        <details>
          <summary>出典と精度</summary>
          <p>{provenance.resolution}</p>
          <p>{provenance.note}</p>
          <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">{provenance.source} ↗</a>
        </details>
      )}
    </article>
  );
}

export function ObservationConditionsPanel({ environment, options, onOptionsChange }: ObservationConditionsPanelProps) {
  const updateOption = (key: keyof DisplayOptions, value: boolean) => onOptionsChange({ ...options, [key]: value });

  return (
    <section className="observation-panel" aria-label="星図の表示設定と観測環境データ">
      <div className="conditions-controls">
        <div className="conditions-controls-heading">
          <span>SKY CONTROLS</span>
          <h3>表示と観測環境</h3>
        </div>
        <div className="conditions-control-groups">
          <div className="conditions-control-group">
            <p>観測環境の反映</p>
            <div className="conditions-switches">
              <PanelSwitch label="過去天候" checked={options.weather} onChange={(value) => updateOption('weather', value)} />
              <PanelSwitch label="光害" checked={options.lightPollution} onChange={(value) => updateOption('lightPollution', value)} />
              <PanelSwitch label="地形遮蔽" checked={options.terrain} onChange={(value) => updateOption('terrain', value)} />
            </div>
          </div>
          <div className="conditions-control-group">
            <p>表示要素</p>
            <div className="conditions-switches">
              <PanelSwitch label="星座線" checked={options.constellations} onChange={(value) => updateOption('constellations', value)} />
              <PanelSwitch label="天体名" checked={options.labels} onChange={(value) => updateOption('labels', value)} />
              <PanelSwitch label="太陽・月・惑星" checked={options.planets} onChange={(value) => updateOption('planets', value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="conditions-panel">
        <ConditionCard
          title="過去天候"
          icon="☁"
          state={environment.weather}
          enabled={options.weather}
          describe={(weather) => `雲量 ${Math.round(weather.cloudCover)}% · 湿度 ${Math.round(weather.relativeHumidity)}% · 降水 ${weather.precipitation.toFixed(1)} mm`}
        />
        <ConditionCard
          title="夜間光"
          icon="◉"
          state={environment.lightPollution}
          enabled={options.lightPollution}
          describe={(light) => `Bortle ${light.bortleClass} 相当 · ${light.radiance.toFixed(1)} nW/(cm² sr)`}
        />
        <ConditionCard
          title="地形遮蔽"
          icon="⌁"
          state={environment.terrain}
          enabled={options.terrain}
          describe={(terrain) => `観測標高 ${Math.round(terrain.observerElevation)} m · 最大仰角 ${Math.max(0, ...terrain.samples.map((sample) => sample.altitude)).toFixed(1)}°`}
        />
      </div>
    </section>
  );
}
