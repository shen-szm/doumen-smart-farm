const CITY_ID = '101280702';
const FEED = `https://d1.weather.com.cn/sk_2d/${CITY_ID}.html`;
const SOURCE = Object.freeze({ name: '中国天气网 · 斗门天气实况', url: `https://www.weather.com.cn/weather1d/${CITY_ID}.shtml` });
const LOCATION = Object.freeze({ name: '珠海市斗门区' });
const HOUR = 3_600_000;

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

export async function fetchObservations(fetcher = fetch, now = () => Date.now()) {
  const response = await fetcher(FEED, {
    headers: { Referer: SOURCE.url },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`China Weather observation HTTP ${response.status}`);
  return normalizeObservations(await response.text(), now());
}
