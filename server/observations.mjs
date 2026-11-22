const CITY_ID = '101280702';
const FEED = `https://d1.weather.com.cn/sk_2d/${CITY_ID}.html`;
const SOURCE = Object.freeze({ name: '中国天气网 · 斗门天气实况', url: `https://www.weather.com.cn/weather1d/${CITY_ID}.shtml` });
const NMC_STATION_CODE = 'ckONx';
const NMC_STATION_PATH = '/publish/forecast/AGD/doumen.html';
const HISTORY_FEED = `https://www.nmc.cn/rest/weather?stationid=${NMC_STATION_CODE}`;
const HISTORY_SOURCE = Object.freeze({
  name: '中央气象台 · 斗门站', url: `https://www.nmc.cn${NMC_STATION_PATH}`, stationId: '59487',
});
const HISTORY_UNITS = Object.freeze({ temp: '°C', humidity: '%', wind: 'm/s', rain: 'mm', pressure: 'hPa', windDirection: '°' });
const LOCATION = Object.freeze({ name: '珠海市斗门区' });
const HOUR = 3_600_000;

export const emptyHistory = Object.freeze({
  history: Object.freeze([]), historySource: HISTORY_SOURCE, historyStatus: 'unavailable',
  historyUnits: HISTORY_UNITS, historyIntervalSeconds: 3600, historyRainIntervalSeconds: 3600,
});

export const emptyObservations = Object.freeze({
  status: 'unavailable', source: SOURCE, location: LOCATION, fetchedAt: null, current: null,
});

function readNumber(value, suffix = '') {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (suffix && !cleaned.endsWith(suffix)) return null;
  const amount = suffix ? cleaned.slice(0, -suffix.length) : cleaned;
  return /^-?\d+(?:\.\d+)?$/.test(amount) ? Number(amount) : null;
}

function localObservationTime(date, clock, now) {
  const day = typeof date === 'string' && date.match(/^(\d{1,2})月(\d{1,2})日/);
  if (!day || typeof clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new Error('Unexpected China Weather observation time');
  }
  const year = new Date(now + 8 * HOUR).getUTCFullYear();
  const month = day[1].padStart(2, '0');
  const dayOfMonth = day[2].padStart(2, '0');
  for (const y of [year, year - 1, year + 1]) {
    const value = `${y}-${month}-${dayOfMonth}T${clock}:00+08:00`;
    const epoch = Date.parse(value);
    if (epoch <= now + 5 * 60_000 && epoch >= now - 7 * 24 * HOUR &&
      new Date(epoch + 8 * HOUR).toISOString().startsWith(`${y}-${month}-${dayOfMonth}T`)) return value;
  }
  throw new Error('China Weather observation date is out of range');
}

export function normalizeObservations(body, now) {
  const wrapped = body.trim().match(/^var\s+dataSK\s*=\s*(\{[\s\S]*\})\s*;?$/);
  if (!wrapped) throw new Error('Unexpected China Weather observation format');
  const observation = JSON.parse(wrapped[1]);
  if (observation.city !== CITY_ID || observation.cityname !== '斗门') {
    throw new Error('Observation did not match the requested station');
  }
  const time = localObservationTime(observation.date, observation.time, now);
  const current = {
    time,
    temp: readNumber(observation.temp),
    humidity: readNumber(observation.SD, '%'),
    rain: readNumber(observation.rain24h),
    intervalSeconds: 86_400,
    wind: readNumber(observation.wse, 'km/h'),
    gust: null,
    pressure: readNumber(observation.qy),
    visibility: readNumber(observation.njd, 'km'),
    code: null,
    text: observation.weather || null,
    windDirection: observation.WD || null,
    windLevel: observation.WS || null,
  };
  if (current.temp === null && current.humidity === null) throw new Error('Observation is missing basic conditions');
  return {
    status: now - Date.parse(time) > 2 * HOUR ? 'cached' : 'current',
    source: SOURCE, location: LOCATION, fetchedAt: new Date(now).toISOString(), current,
  };
}

function observationValue(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function normalizeObservationHistory(payload, now) {
  const { real, passedchart } = payload?.data ?? {};
  const station = real?.station;
  if (payload?.code !== 0 || station?.code !== NMC_STATION_CODE || station?.city !== '斗门' ||
    station?.province !== '广东省' || station?.url !== NMC_STATION_PATH || !Array.isArray(passedchart)) {
    throw new Error('NMC history did not match the requested station');
  }
  const readings = new Map();
  for (const row of passedchart) {
    if (typeof row?.time !== 'string' || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):00$/.test(row.time)) continue;
    const time = `${row.time.replace(' ', 'T')}:00+08:00`;
    const epoch = Date.parse(time);
    if (!Number.isFinite(epoch) || epoch > now || epoch < now - 48 * HOUR ||
      !new Date(epoch + 8 * HOUR).toISOString().startsWith(row.time.replace(' ', 'T'))) continue;
    readings.set(epoch, {
      time,
      temp: observationValue(row.temperature, -90, 70),
      humidity: observationValue(row.humidity, 0, 100),
      wind: observationValue(row.windSpeed, 0, 150),
      rain: observationValue(row.rain1h, 0, 2000),
      pressure: observationValue(row.pressure, 200, 1300),
      windDirection: observationValue(row.windDirection, 0, 360),
    });
  }
  const latest = Math.max(...Array.from(readings, ([epoch, { time, ...values }]) =>
    Object.values(values).some((value) => value !== null) ? epoch : -Infinity));
  if (!Number.isFinite(latest)) return emptyHistory;
  const history = [...readings]
    .filter(([epoch]) => epoch <= latest && epoch > latest - 24 * HOUR)
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row);
  return {
    ...emptyHistory, history, historyStatus: now - latest > 2 * HOUR ? 'cached' : 'current',
  };
}

export async function fetchCurrentObservation(fetcher, clock) {
  const response = await fetcher(FEED, {
    headers: { Referer: SOURCE.url },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`China Weather observation HTTP ${response.status}`);
  return normalizeObservations(await response.text(), clock());
}

export async function fetchObservationHistory(fetcher, clock) {
  const response = await fetcher(HISTORY_FEED, {
    headers: { Referer: HISTORY_SOURCE.url, Accept: 'application/json' },
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error(`NMC history HTTP ${response.status}`);
  const result = normalizeObservationHistory(await response.json(), clock());
  if (!result.history.length) throw new Error('NMC history is empty');
  return result;
}

export async function fetchObservations(fetcher = fetch, now = () => Date.now()) {
  const [current, history] = await Promise.all([
    fetchCurrentObservation(fetcher, now),
    fetchObservationHistory(fetcher, now).catch(() => emptyHistory),
  ]);
  return { ...current, ...history };
}
