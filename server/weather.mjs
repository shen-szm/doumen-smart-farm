export const DOUMEN = Object.freeze({ name: '珠海市斗门区', latitude: 22.21, longitude: 113.30 });

const SOURCE = Object.freeze({ name: 'Open-Meteo', url: 'https://open-meteo.com/en/docs' });
const SOIL_FIELD = 'soil_moisture_9_to_27cm';
const HOUR = 60 * 60 * 1000;

const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
forecastUrl.search = new URLSearchParams({
  latitude: DOUMEN.latitude,
  longitude: DOUMEN.longitude,
  timezone: 'Asia/Shanghai',
  cell_selection: 'land',
  temperature_unit: 'celsius',
  wind_speed_unit: 'kmh',
  precipitation_unit: 'mm',
  current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,weather_code',
  hourly: `temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,${SOIL_FIELD}`,
  daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,et0_fao_evapotranspiration,weather_code',
  past_hours: '48',
  forecast_hours: '25',
  forecast_days: '8',
});

export const emptyWeather = Object.freeze({
  status: 'unavailable',
  source: SOURCE,
  location: DOUMEN,
  fetchedAt: null,
  current: null,
  hourly: [],
  daily: [],
  soil: [],
});

function chinaTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error('Unexpected Open-Meteo time format');
  }
  const time = `${value}:00+08:00`;
  if (!Number.isFinite(Date.parse(time))) throw new Error('Invalid Open-Meteo time');
  return time;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function normalizeWeather(payload, fetchedAt) {
  if (payload.utc_offset_seconds !== 28800 || !payload.current || !Array.isArray(payload.hourly?.time)) {
    throw new Error('Incomplete Open-Meteo response');
  }

  const { current, hourly, daily } = payload;
  const time = chinaTime(current.time);
  const localDate = time.slice(0, 10);
  const reference = fetchedAt.getTime();
  const rows = hourly.time.map((value, index) => {
    const time = chinaTime(value);
    return { time, index, timestamp: Date.parse(time) };
  });

  const forecast = rows.filter(({ timestamp }) => timestamp > reference).slice(0, 24);
  const history = rows.filter(({ timestamp }) => timestamp <= reference && timestamp > reference - 48 * HOUR);

  return {
    status: 'current',
    source: SOURCE,
    location: DOUMEN,
    grid: { latitude: numberOrNull(payload.latitude), longitude: numberOrNull(payload.longitude) },
    fetchedAt: fetchedAt.toISOString(),
    current: {
      time,
      temp: numberOrNull(current.temperature_2m),
      humidity: numberOrNull(current.relative_humidity_2m),
      rain: numberOrNull(current.precipitation),
      wind: numberOrNull(current.wind_speed_10m),
      gust: numberOrNull(current.wind_gusts_10m),
      code: numberOrNull(current.weather_code),
      intervalSeconds: numberOrNull(current.interval),
    },
    hourly: forecast.map(({ time, index }) => ({
      time,
      temp: numberOrNull(hourly.temperature_2m?.[index]),
      rain: numberOrNull(hourly.precipitation?.[index]),
      probability: numberOrNull(hourly.precipitation_probability?.[index]),
      gust: numberOrNull(hourly.wind_gusts_10m?.[index]),
    })),
    daily: Array.isArray(daily?.time) ? daily.time.flatMap((date, index) => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= localDate) return [];
      return [{
        date,
        minTemp: numberOrNull(daily.temperature_2m_min?.[index]),
        maxTemp: numberOrNull(daily.temperature_2m_max?.[index]),
        precipitation: numberOrNull(daily.precipitation_sum?.[index]),
        probability: numberOrNull(daily.precipitation_probability_max?.[index]),
        gust: numberOrNull(daily.wind_gusts_10m_max?.[index]),
        et0: numberOrNull(daily.et0_fao_evapotranspiration?.[index]),
        code: numberOrNull(daily.weather_code?.[index]),
      }];
    }).slice(0, 7) : [],
    soil: history.map(({ time, index }) => {
      const value = numberOrNull(hourly[SOIL_FIELD]?.[index]);
      return { time, moisture: value === null ? null : Number((value * 100).toFixed(2)) };
    }),
  };
}

export async function fetchRegionalWeather(fetcher = fetch, now = () => Date.now()) {
  const response = await fetcher(forecastUrl, { signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeWeather(payload, new Date(now()));
}
