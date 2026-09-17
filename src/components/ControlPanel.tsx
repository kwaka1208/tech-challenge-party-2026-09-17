import { useState, type FormEvent } from 'react';
import { getCurrentCoordinates, resolveTimezone, reverseLocation, searchLocations } from '../services/location';
import type { LocationSearchResult, ObservationLocation } from '../types';

interface ControlPanelProps {
  date: string;
  time: string;
  location: ObservationLocation;
  magnitudeLimit: number;
  error: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onLocationChange: (value: ObservationLocation) => void;
  onMagnitudeLimitChange: (value: number) => void;
}

function todayInTimezone(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
}

export function ControlPanel({
  date, time, location, magnitudeLimit, error,
  onDateChange, onTimeChange, onLocationChange, onMagnitudeLimitChange,
}: ControlPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) { setStatus('地名を2文字以上入力してください。'); return; }
    setBusy(true);
    setStatus('場所を検索しています…');
    try {
      const places = await searchLocations(query.trim());
      setResults(places);
      setStatus(places.length ? `${places.length}件見つかりました。` : '場所が見つかりませんでした。');
    } catch (searchError) {
      setStatus(searchError instanceof Error ? searchError.message : '検索に失敗しました。');
    } finally { setBusy(false); }
  };

  const selectLocation = async (place: LocationSearchResult) => {
    setBusy(true);
    setStatus('タイムゾーンを確認しています…');
    try {
      const timezone = await resolveTimezone(place.latitude, place.longitude);
      onLocationChange({ name: place.name, latitude: place.latitude, longitude: place.longitude, elevation: 0, timezone });
      setQuery('');
      setResults([]);
      setStatus('観測地点を設定しました。');
    } catch (locationError) {
      setStatus(locationError instanceof Error ? locationError.message : '観測地点を設定できませんでした。');
    } finally { setBusy(false); }
  };

  const useCurrentLocation = async () => {
    setBusy(true);
    setStatus('現在地を取得しています…');
    try {
      const coordinates = await getCurrentCoordinates();
      const [name, timezone] = await Promise.all([
        reverseLocation(coordinates.latitude, coordinates.longitude),
        resolveTimezone(coordinates.latitude, coordinates.longitude),
      ]);
      onLocationChange({ name, timezone, ...coordinates });
      setStatus('現在地を設定しました。');
    } catch (locationError) {
      setStatus(locationError instanceof Error ? locationError.message : '現在地を取得できませんでした。');
    } finally { setBusy(false); }
  };

  return (
    <div className="controls">
      <section className="control-section">
        <div className="section-heading"><span>01</span><h2>いつの空ですか？</h2></div>
        <div className="field-grid">
          <label className="field">
            <span>日付</span>
            <span className="date-input-wrap">
              <input type="date" min="1900-01-01" max="2100-12-31" value={date} onChange={(event) => onDateChange(event.target.value)} required />
              <button type="button" onClick={() => onDateChange(todayInTimezone(location.timezone))} aria-label="日付を観測地点の今日に設定">今日</button>
            </span>
          </label>
          <label className="field"><span>時刻</span><input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} required /></label>
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>02</span><h2>どこから見ますか？</h2></div>
        <form className="location-search" onSubmit={handleSearch}>
          <label className="field field-wide">
            <span>都市名・地名</span>
            <span className="search-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：東京都、札幌市、Paris" aria-label="観測地点を検索" />
              <button type="submit" disabled={busy}>検索</button>
            </span>
          </label>
        </form>
        {results.length > 0 && <div className="search-results" aria-label="場所の検索結果">{results.map((place) => (
          <button key={place.id} type="button" onClick={() => void selectLocation(place)}><span aria-hidden="true">⌖</span><span>{place.name}</span></button>
        ))}</div>}
        <button className="current-location" type="button" onClick={() => void useCurrentLocation()} disabled={busy}><span aria-hidden="true">◎</span> 現在地を使う</button>
        <p className="selected-location"><span aria-hidden="true">●</span><span>{location.name}</span></p>
        <p className="field-status" aria-live="polite">{status}</p>
        <button className="details-toggle" type="button" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>座標とタイムゾーンを手動設定 <span>{detailsOpen ? '−' : '+'}</span></button>
        {detailsOpen && <div className="location-details">
          <label className="field"><span>緯度</span><input type="number" min="-90" max="90" step="0.0001" value={location.latitude} onChange={(event) => onLocationChange({ ...location, latitude: Number(event.target.value), name: 'カスタム地点' })} /></label>
          <label className="field"><span>経度</span><input type="number" min="-180" max="180" step="0.0001" value={location.longitude} onChange={(event) => onLocationChange({ ...location, longitude: Number(event.target.value), name: 'カスタム地点' })} /></label>
          <label className="field field-wide"><span>IANAタイムゾーン</span><input value={location.timezone} onChange={(event) => onLocationChange({ ...location, timezone: event.target.value })} placeholder="Asia/Tokyo" /></label>
        </div>}
      </section>

      <section className="control-section display-section">
        <div className="section-heading"><span>03</span><h2>星の見え方</h2></div>
        <div className="magnitude-control">
          <div className="magnitude-heading"><span>最大表示等級</span><output>{magnitudeLimit.toFixed(1)} 等級</output></div>
          <input type="range" min="1" max="6.5" step="0.5" value={magnitudeLimit} onChange={(event) => onMagnitudeLimitChange(Number(event.target.value))} aria-label="表示する星の最大等級" />
          <div className="magnitude-scale"><span>明るい星だけ</span><span>暗い星まで</span></div>
          <p>数値が大きいほど暗い星まで表示します。薄明・月光に加え、取得できた過去天候と光害による肉眼の限界も反映されます。</p>
        </div>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
