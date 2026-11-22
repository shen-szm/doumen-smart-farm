import { DOUMEN } from './weather.mjs';

const SOURCE = Object.freeze({
  name: 'NASA POWER · 农业气象',
  url: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
  methodUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm',
});
const METHOD_NOTE = Object.freeze({
  et0: 'FAO-56 Penman-Monteith 公式（式 6、11–13、21、39–47），日步长，土壤热通量 G=0，地表反照率 0.23',
  kc: 'FAO-56 表 12 番茄作物系数：初期 0.60 / 中期 1.15 / 末期 0.80',
  effectiveRain: '有效降雨按降雨量 × 0.8 计（FAO-56 第 7 章湿润地区参考比例）',
  irrigation: '灌溉参考量 = 近 10 日 ΣETc(中期) − 近 10 日 Σ有效降雨，取正值；1 mm ≈ 0.667 m³/亩',
});
const PARAMETERS = ['PRECTOTCORR', 'T2M', 'T2M_MAX', 'T2M_MIN', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'PS'];
const WINDOW_DAYS = 90;
const BALANCE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const ELEVATION = 5; // 斗门镇沿海平原（m）
const ALBEDO = 0.23;
const SOLAR_CONSTANT = 0.0820; // MJ m-2 min-1
const SIGMA = 4.903e-9; // MJ K-4 m-2 day-1
const KC = Object.freeze({ crop: '番茄（FAO-56 表 12）', initial: 0.60, mid: 1.15, late: 0.80 });
const EFFECTIVE_RAIN_RATIO = 0.8;

// QX/T 208-2013《水稻高温热害等级》：日最高气温≥35℃且日均温≥30℃持续≥3天。
function heatStressRuns(daily) {
  const runs = [];
  let run = null;
  for (const day of daily) {
    const hit = day.tmax >= 35 && day.t2m >= 30;
    if (hit) {
      run ??= { start: day.date, days: 0, tmaxPeak: -Infinity };
      run.days += 1;
      run.tmaxPeak = Math.max(run.tmaxPeak, day.tmax);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs.filter(({ days }) => days >= 3).map((run) => ({
    type: '高温热害',
    level: run.days >= 9 ? '重度' : run.days >= 6 ? '中度' : '轻度',
    window: `${run.start} 起持续 ${run.days} 天`,
    detail: `日最高气温≥35℃且日均温≥30℃，期间最高 ${run.tmaxPeak.toFixed(1)}℃`,
    standard: 'QX/T 208-2013《水稻高温热害等级》',
  }));
}

// GB/T 28592-2012《降水量等级》：24 小时雨量 50/100/250 mm 分档。
function rainstormDays(daily) {
  return daily.filter(({ precip }) => precip >= 50).map((day) => ({
    type: '暴雨',
    level: day.precip >= 250 ? '特大暴雨' : day.precip >= 100 ? '大暴雨' : '暴雨',
    window: day.date,
    detail: `日雨量 ${day.precip.toFixed(1)} mm`,
    standard: 'GB/T 28592-2012《降水量等级》',
  }));
}

// GB/T 34816-2017《寒露风等级》华南常规型：日均温≤23℃持续≥3天，仅统计晚稻敏感期 9–10 月。
function autumnChillRuns(daily) {
  const season = daily.filter(({ date }) => /^\d{4}-(09|10)-/.test(date));
  const runs = [];
  let run = null;
  for (const day of season) {
    const hit = day.t2m <= 23;
    if (hit) {
      run ??= { start: day.date, days: 0, coldest: Infinity };
      run.days += 1;
      run.coldest = Math.min(run.coldest, day.t2m);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs.filter(({ days }) => days >= 3).map((run) => ({
    type: '寒露风',
    level: run.days >= 5 || run.coldest <= 20 ? '重度' : '轻度',
    window: `${run.start} 起持续 ${run.days} 天`,
    detail: `日均温≤23℃持续 ${run.days} 天，期间最低日均温 ${run.coldest.toFixed(1)}℃`,
    standard: 'GB/T 34816-2017《寒露风等级》· 华南常规型',
  }));
}

const saturationVapourPressure = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

export function referenceEvapotranspiration({ t2m, tmax, tmin, rh, ws, srad, ps }, date) {
  const dayOfYear = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / DAY_MS) + 1;
  const latitude = (DOUMEN.latitude * Math.PI) / 180;

  // FAO-56 式 21：天顶外辐射 Ra 与相对日地距离、赤纬、日落时角。
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const declination = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);
  const sunsetAngle = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latitude) * Math.tan(declination))));
  const ra = ((24 * 60) / Math.PI) * SOLAR_CONSTANT * dr
    * (sunsetAngle * Math.sin(latitude) * Math.sin(declination)
      + Math.cos(latitude) * Math.cos(declination) * Math.sin(sunsetAngle));

  const rso = (0.75 + 2e-5 * ELEVATION) * ra;
  const rns = (1 - ALBEDO) * srad;
  const es = (saturationVapourPressure(tmax) + saturationVapourPressure(tmin)) / 2;
  const ea = (rh / 100) * es;
  const clearSkyRatio = Math.min(1, srad / rso);
  const rnl = SIGMA * ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2)
    * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * clearSkyRatio - 0.35);
  const netRadiation = rns - rnl;

  const delta = (4098 * saturationVapourPressure(t2m)) / Math.pow(t2m + 237.3, 2);
  const pressure = Number.isFinite(ps) ? ps : 101.3 * Math.pow((293 - 0.0065 * ELEVATION) / 293, 5.26);
  const psychrometric = 0.665e-3 * pressure;

  const numerator = 0.408 * delta * netRadiation
    + psychrometric * (900 / (t2m + 273)) * ws * (es - ea);
  const denominator = delta + psychrometric * (1 + 0.34 * ws);
  return numerator / denominator;
}

export const emptyAgro = Object.freeze({
  status: 'unavailable',
  source: SOURCE,
  location: DOUMEN,
  fetchedAt: null,
  daily: [],
});

const isoDate = (date) => date.toISOString().slice(0, 10);

export function buildPowerUrl(now = Date.now()) {
  // POWER 发布滞后约 2 天，窗口终点取 3 天前以避开 -999 缺测尾部；
  // 起点多取一年，用于同期同比。
  const end = new Date(now - 3 * DAY_MS);
  const start = new Date(end - (365 + WINDOW_DAYS - 1) * DAY_MS);
  const url = new URL('https://power.larc.nasa.gov/api/temporal/daily/point');
  url.search = new URLSearchParams({
    parameters: PARAMETERS.join(','),
    community: 'AG',
    longitude: DOUMEN.longitude,
    latitude: DOUMEN.latitude,
    start: isoDate(start).replace(/-/g, ''),
    end: isoDate(end).replace(/-/g, ''),
    format: 'JSON',
    'time-standard': 'LST',
  });
  return url;
}

function numberOrNull(value) {
  return Number.isFinite(value) && value > -900 ? Number(value.toFixed(3)) : null;
}

export function normalizeAgro(payload, fetchedAt) {
  const parameters = payload?.properties?.parameter;
  if (!parameters || !PARAMETERS.every((name) => parameters[name])) {
    throw new Error('Incomplete NASA POWER response');
  }

  const dates = Object.keys(parameters.T2M).sort();
  const dailyFull = [];
  for (const yyyymmdd of dates) {
    const date = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
    const day = {
      date,
      precip: numberOrNull(parameters.PRECTOTCORR[yyyymmdd]),
      t2m: numberOrNull(parameters.T2M[yyyymmdd]),
      tmax: numberOrNull(parameters.T2M_MAX[yyyymmdd]),
      tmin: numberOrNull(parameters.T2M_MIN[yyyymmdd]),
      rh: numberOrNull(parameters.RH2M[yyyymmdd]),
      ws: numberOrNull(parameters.WS2M[yyyymmdd]),
      srad: numberOrNull(parameters.ALLSKY_SFC_SW_DWN[yyyymmdd]),
      ps: numberOrNull(parameters.PS[yyyymmdd]),
    };
    if (Object.values(day).every((value) => value !== null)) day.et0 = Number(referenceEvapotranspiration(day, date).toFixed(2));
    else day.et0 = null;
    dailyFull.push(day);
  }
  const daily = dailyFull.slice(-WINDOW_DAYS);

  // 月度汇总：近 14 个月的降雨、蒸散与气温均值（当月为进行中的 partial）。
  const monthlyMap = new Map();
  for (const day of dailyFull) {
    const month = day.date.slice(0, 7);
    let entry = monthlyMap.get(month);
    if (!entry) {
      entry = { month, precip: 0, precipDays: 0, et0: 0, t2mSum: 0, t2mDays: 0, days: 0 };
      monthlyMap.set(month, entry);
    }
    entry.days += 1;
    if (day.precip != null) { entry.precip += day.precip; if (day.precip > 0.1) entry.precipDays += 1; }
    if (day.et0 != null) entry.et0 += day.et0;
    if (day.t2m != null) { entry.t2mSum += day.t2m; entry.t2mDays += 1; }
  }
  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-14)
    .map(({ month, precip, precipDays, et0, t2mSum, t2mDays, days }) => ({
      month,
      precip: Number(precip.toFixed(1)),
      precipDays,
      et0: Number(et0.toFixed(1)),
      t2mMean: t2mDays ? Number((t2mSum / t2mDays).toFixed(1)) : null,
      daysObserved: days,
    }));

  const et0Days = daily.filter(({ et0, precip }) => et0 !== null && precip !== null);
  if (et0Days.length < 30) throw new Error('NASA POWER record is too short');

  // 同期同比：以当日向前 30 天为窗口，取去年同日期对照。
  const lastYearKey = (date) => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const fullByDate = new Map(dailyFull.map((day) => [day.date, day]));
  const lastYearDaily = et0Days.slice(-30).map((day) => {
    const matched = fullByDate.get(lastYearKey(day.date));
    return { date: lastYearKey(day.date), precip: matched?.precip ?? null, et0: matched?.et0 ?? null };
  });
  const pairs = et0Days.slice(-30).map((day, index) => ({ now: day, last: lastYearDaily[index] }))
    .filter(({ now, last }) => now.et0 != null && last.et0 != null);
  const sumBy = (list, key) => list.reduce((total, day) => total + (day[key] ?? 0), 0);
  const comparison = pairs.length >= 20 ? (() => {
    const precip30 = sumBy(et0Days.slice(-30), 'precip');
    const precipLY = sumBy(lastYearDaily, 'precip');
    const et0Mean = sumBy(et0Days.slice(-30), 'et0') / 30;
    const et0MeanLY = sumBy(lastYearDaily, 'et0') / pairs.length;
    const pct = (value, base) => base > 0 ? Number(((value - base) / base * 100).toFixed(0)) : null;
    return {
      windowDays: 30,
      pairs: pairs.length,
      precip: Number(precip30.toFixed(1)),
      precipLastYear: Number(precipLY.toFixed(1)),
      precipDeltaPct: pct(precip30, precipLY),
      et0Mean: Number(et0Mean.toFixed(2)),
      et0MeanLastYear: Number(et0MeanLY.toFixed(2)),
      et0DeltaPct: pct(et0Mean, et0MeanLY),
    };
  })() : null;

  const recent = et0Days.slice(-BALANCE_DAYS);
  const sum = (key) => recent.reduce((total, day) => total + day[key], 0);
  const precip10 = sum('precip');
  const effectiveRain10 = precip10 * EFFECTIVE_RAIN_RATIO;
  const etcMid10 = sum('et0') * KC.mid;
  const irrigationRefMm = Math.max(0, etcMid10 - effectiveRain10);

  const risks = [...heatStressRuns(daily), ...rainstormDays(daily), ...autumnChillRuns(daily)]
    .sort((a, b) => b.window.localeCompare(a.window));

  return {
    status: 'current',
    source: SOURCE,
    location: DOUMEN,
    elevation: ELEVATION,
    fetchedAt: fetchedAt.toISOString(),
    window: { days: WINDOW_DAYS, timeStandard: 'LST（当地太阳日，与北京时间差约 27 分钟）' },
    kc: KC,
    daily,
    et0: {
      latest: et0Days.at(-1).et0,
      latestDate: et0Days.at(-1).date,
      mean30: Number((et0Days.slice(-30).reduce((total, day) => total + day.et0, 0) / 30).toFixed(2)),
    },
    waterBalance: {
      days: BALANCE_DAYS,
      precip: Number(precip10.toFixed(1)),
      effectiveRain: Number(effectiveRain10.toFixed(1)),
      etcMid: Number(etcMid10.toFixed(1)),
      irrigationRefMm: Number(irrigationRefMm.toFixed(1)),
      irrigationRefM3PerMu: Number((irrigationRefMm * 0.667).toFixed(1)),
      surplus: Number((precip10 - sum('et0')).toFixed(1)),
    },
    lastYearDaily,
    monthly,
    comparison,
    risks,
    method: METHOD_NOTE,
  };
}

export async function fetchAgro(fetcher = fetch, now = () => Date.now()) {
  const response = await fetcher(buildPowerUrl(now()), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeAgro(payload, new Date(now()));
}
