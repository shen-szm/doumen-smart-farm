import { DOUMEN } from './weather.mjs';

const SOURCE = Object.freeze({
  name: 'Open-Meteo · ERA5-Land 再分析',
  url: 'https://open-meteo.com/en/docs/historical-weather-api',
  methodUrl: 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land',
});
const STANDARD = Object.freeze({
  name: 'GB/T 20481-2017《气象干旱等级》',
  url: 'https://cmdp.ncc-cma.net/download/Drought/GBT20481-2017.pdf',
});
// ERA5 原生 0-7 / 7-28 / 28-100 cm 三层，Open-Meteo 的细分变量彼此重复，仅取代表层。
const LAYERS = Object.freeze([
  Object.freeze({ id: 'surface', depth: '0–7 cm', field: 'soil_moisture_0_to_1cm', label: '表层' }),
  Object.freeze({ id: 'root', depth: '7–28 cm', field: 'soil_moisture_9_to_27cm', label: '根区' }),
  Object.freeze({ id: 'deep', depth: '28–100 cm', field: 'soil_moisture_27_to_81cm', label: '深层' }),
]);
// 珠三角冲积平原以粉壤土/壤土为主，田间持水量取 FAO-56 表 19 区间中值（m³/m³）。
const FIELD_CAPACITY = 0.30;
const FIELD_CAPACITY_NOTE = 'FAO-56 表 19 · 粉壤土/壤土田间持水量区间中值';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 60;

export const SOIL_GRADES = Object.freeze([
  Object.freeze({ id: 'waterlogged', label: '过湿', range: 'R > 90%', min: 90 }),
  Object.freeze({ id: 'suitable', label: '适宜', range: '60 ≤ R ≤ 90%', min: 60 }),
  Object.freeze({ id: 'mild', label: '轻旱', range: '50 ≤ R < 60%', min: 50 }),
  Object.freeze({ id: 'moderate', label: '中旱', range: '40 ≤ R < 50%', min: 40 }),
  Object.freeze({ id: 'severe', label: '重旱', range: '30 ≤ R < 40%', min: 30 }),
  Object.freeze({ id: 'extreme', label: '特旱', range: 'R < 30%', min: 0 }),
]);

export function moistureGrade(relative) {
  if (!Number.isFinite(relative)) return null;
  return SOIL_GRADES.find(({ min }) => relative >= min)?.id ?? null;
}

export const emptySoilProfile = Object.freeze({
  status: 'unavailable',
  source: SOURCE,
  standard: STANDARD,
  location: DOUMEN,
  fetchedAt: null,
  days: [],
});

const isoDate = (date) => date.toISOString().slice(0, 10);

export function buildArchiveUrl(now = Date.now()) {
  const end = new Date(now - 6 * DAY_MS);
  const start = new Date(end - (WINDOW_DAYS - 1) * DAY_MS);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    latitude: DOUMEN.latitude,
    longitude: DOUMEN.longitude,
    start_date: isoDate(start),
    end_date: isoDate(end),
    hourly: LAYERS.map(({ field }) => field).join(','),
    timezone: 'Asia/Shanghai',
    cell_selection: 'land',
    models: 'era5_land',
  });
  return url;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function dailyMean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function normalizeSoilProfile(payload, fetchedAt) {
  const hourly = payload?.hourly;
  if (!Array.isArray(hourly?.time) || !hourly.time.length || !LAYERS.every(({ field }) => Array.isArray(hourly[field]))) {
    throw new Error('Incomplete Open-Meteo archive response');
  }
  if (Math.abs(payload.latitude - 22.2) > 0.2 || Math.abs(payload.longitude - 113.3) > 0.2) {
    throw new Error('Unexpected archive grid coordinates');
  }

  const buckets = new Map();
  hourly.time.forEach((time, index) => {
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) {
      throw new Error('Unexpected archive time format');
    }
    const date = time.slice(0, 10);
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = new Map(LAYERS.map(({ id }) => [id, []]));
      buckets.set(date, bucket);
    }
    for (const { id, field } of LAYERS) {
      const value = numberOrNull(hourly[field][index]);
      if (value !== null) bucket.get(id).push(value);
    }
  });

  const days = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => {
    const moisture = {};
    const relative = {};
    const grade = {};
    for (const { id } of LAYERS) {
      const mean = dailyMean(bucket.get(id));
      moisture[id] = mean === null ? null : Number((mean * 100).toFixed(1));
      relative[id] = mean === null ? null : Number(((mean / FIELD_CAPACITY) * 100).toFixed(0));
      grade[id] = moistureGrade(relative[id]);
    }
    return { date, moisture, relative, grade };
  });

  const complete = days.filter(({ moisture }) => LAYERS.every(({ id }) => moisture[id] !== null));
  if (complete.length < 14) throw new Error('Archive soil record is too short');

  return {
    status: 'current',
    source: SOURCE,
    standard: STANDARD,
    location: DOUMEN,
    grid: { latitude: numberOrNull(payload.latitude), longitude: numberOrNull(payload.longitude) },
    fetchedAt: fetchedAt.toISOString(),
    window: { days: WINDOW_DAYS, timeZone: 'Asia/Shanghai', unit: 'm³/m³ · 体积含水量' },
    fieldCapacity: { value: FIELD_CAPACITY, note: FIELD_CAPACITY_NOTE, formula: '相对湿度 R = 体积含水量 ÷ 田间持水量 × 100%' },
    layers: LAYERS.map(({ id, depth, label }) => ({ id, depth, label })),
    days,
  };
}

export async function fetchSoilProfile(fetcher = fetch, now = () => Date.now()) {
  const response = await fetcher(buildArchiveUrl(now()), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Open-Meteo archive returned HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeSoilProfile(payload, new Date(now()));
}
