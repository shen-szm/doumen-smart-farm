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
  current: 'temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m',
  hourly: `temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,pressure_msl,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,uv_index,${SOIL_FIELD}`,
  daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,et0_fao_evapotranspiration,weather_code,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max',
  minutely_15: 'precipitation',
  forecast_minutely_15: '32',
  past_hours: '48',
  forecast_hours: '73',
  forecast_days: '8',
});

export const emptyWeather = Object.freeze({
  status: 'unavailable',
  source: SOURCE,
  location: DOUMEN,
  fetchedAt: null,
  current: null,
  hourly: [],
  hourlyExt: [],
  minutely: [],
  astro: [],
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
  const forecastExt = rows.filter(({ timestamp }) => timestamp > reference).slice(0, 48);
  const history = rows.filter(({ timestamp }) => timestamp <= reference && timestamp > reference - 48 * HOUR);

  // 临近降雨（Open-Meteo 15 分钟步长 nowcast），仅保留参考时刻之后的非空样本。
  const minutely = Array.isArray(payload.minutely_15?.time) ? payload.minutely_15.time.flatMap((value, index) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
    const time = `${value}:00+08:00`;
    if (Date.parse(time) <= reference) return [];
    const rain = numberOrNull(payload.minutely_15.precipitation?.[index]);
    return rain === null ? [] : [{ time, rain }];
  }) : [];

  const astro = Array.isArray(daily?.time) ? daily.time.flatMap((date, index) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localDate) return [];
    const sunrise = daily.sunrise?.[index];
    const sunset = daily.sunset?.[index];
    if (typeof sunrise !== 'string' || typeof sunset !== 'string') return [];
    const read = (value) => value.slice(11, 16);
    return [{
      date,
      sunrise: read(sunrise),
      sunset: read(sunset),
      daylightMinutes: numberOrNull(daily.daylight_duration?.[index]) != null
        ? Math.round(daily.daylight_duration[index] / 60) : null,
      sunshineHours: numberOrNull(daily.sunshine_duration?.[index]) != null
        ? Number((daily.sunshine_duration[index] / 3600).toFixed(1)) : null,
      uvMax: numberOrNull(daily.uv_index_max?.[index]),
    }];
  }).slice(0, 2) : [];

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
      dewPoint: numberOrNull(current.dew_point_2m),
      apparent: numberOrNull(current.apparent_temperature),
      rain: numberOrNull(current.precipitation),
      wind: numberOrNull(current.wind_speed_10m),
      gust: numberOrNull(current.wind_gusts_10m),
      code: numberOrNull(current.weather_code),
      cloud: numberOrNull(current.cloud_cover),
      pressure: numberOrNull(current.pressure_msl),
      intervalSeconds: numberOrNull(current.interval),
    },
    hourly: forecast.map(({ time, index }) => ({
      time,
      temp: numberOrNull(hourly.temperature_2m?.[index]),
      rain: numberOrNull(hourly.precipitation?.[index]),
      probability: numberOrNull(hourly.precipitation_probability?.[index]),
      gust: numberOrNull(hourly.wind_gusts_10m?.[index]),
    })),
    // 未来 48 小时完整要素，供作物决策（喷药窗口、病虫适宜度）与详情页使用。
    hourlyExt: forecastExt.map(({ time, index }) => ({
      time,
      temp: numberOrNull(hourly.temperature_2m?.[index]),
      humidity: numberOrNull(hourly.relative_humidity_2m?.[index]),
      dewPoint: numberOrNull(hourly.dew_point_2m?.[index]),
      apparent: numberOrNull(hourly.apparent_temperature?.[index]),
      rain: numberOrNull(hourly.precipitation?.[index]),
      probability: numberOrNull(hourly.precipitation_probability?.[index]),
      wind: numberOrNull(hourly.wind_speed_10m?.[index]),
      gust: numberOrNull(hourly.wind_gusts_10m?.[index]),
      cloud: numberOrNull(hourly.cloud_cover?.[index]),
      visibility: numberOrNull(hourly.visibility?.[index]),
      uv: numberOrNull(hourly.uv_index?.[index]),
      pressure: numberOrNull(hourly.pressure_msl?.[index]),
    })),
    minutely,
    astro,
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
        uvMax: numberOrNull(daily.uv_index_max?.[index]),
      }];
    }).slice(0, 7) : [],
    soil: history.map(({ time, index }) => {
      const value = numberOrNull(hourly[SOIL_FIELD]?.[index]);
      return { time, moisture: value === null ? null : Number((value * 100).toFixed(2)) };
    }),
  };
}

export async function fetchRegionalWeather(fetcher = fetch, now = () => Date.now()) {
  const response = await fetcher(forecastUrl, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeWeather(payload, new Date(now()));
}
