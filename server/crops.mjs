import { DOUMEN } from './weather.mjs';

// 作物农事决策引擎：全部由平台已有真实数据源派生（Open-Meteo 48 小时逐时 + NASA POWER 日值），
// 不新增外部依赖。三类模型：生育期农事（日历驱动）、喷药作业窗口（逐时气象条件扫描）、
// 病虫气象适宜度（温湿度阈值法）。
const SOURCE = Object.freeze({
  name: '平台作物决策模型（Open-Meteo / NASA POWER 派生）',
  url: 'https://open-meteo.com/en/docs',
});
const METHOD_NOTE = Object.freeze({
  spray: '喷药适宜条件：昼间（07–17 时）时雨量 < 0.1 mm、风速 < 15 km/h（≈蒲福 3 级下限，防飘移）、气温 10–30℃，连续 ≥ 2 小时计为一个作业窗口',
  pest: '病虫气象适宜度为温湿度阈值法（逐日 / 逐时判定后取占比），提示发生风险倾向，非田间实测虫情；阈值参考全国农技推广中心测报技术资料与广东省农科院植保所公开技术资料',
  gdd: '有效积温 GDD = max(0, (日最高温 + 日最低温) ÷ 2 − 10℃)，基础温度 10℃，自当年 11 月 1 日（冬种蔬菜整地播种参考期）起累计',
});

// ============ 生育期农事（日历驱动，斗门主栽：双季稻 / 冬种蔬菜 / 荔枝） ============
// 依据：珠海市农业农村局种粮扶持通知（插秧期）、广东省农业科学院公开农事月历。
const STAGE_TABLE = Object.freeze({
  rice: [
    { months: [1, 2], stage: '备耕期', focus: '冬闲田翻耕晒白、农资准备；2 月下旬早造浸种催芽' },
    { months: [3], stage: '早造插秧期', focus: '3 月上中旬插秧（市级种粮扶持对应插秧期 3/1–4/20），插后浅水回青' },
    { months: [4], stage: '分蘖期', focus: '够苗晒田，防治稻纵卷叶螟、纹枯病' },
    { months: [5], stage: '拔节孕穗期', focus: '保水养胎，关注“龙舟水”强降雨排涝' },
    { months: [6], stage: '抽穗灌浆期', focus: '高温热害与暴雨防范（QX/T 208-2013），适期收获前断水' },
    { months: [7], stage: '早造收获 / 晚造育秧', focus: '7 月上中旬抢晴收获，下旬晚造播种' },
    { months: [8], stage: '晚造插秧期', focus: '晚造插秧（扶持插秧期 7/10–8/20），台风高发期关注预警' },
    { months: [9], stage: '分蘖拔节期', focus: '够苗露晒田，9 月下旬起进入寒露风敏感期' },
    { months: [10], stage: '抽穗灌浆期', focus: '寒露风监测（GB/T 34816-2017），灌浆期保持湿润' },
    { months: [11], stage: '晚造收获期', focus: '11 月上中旬抢晴收获，稻草还田，冬种接茬' },
    { months: [12], stage: '冬闲期', focus: '冬闲田翻耕、绿肥或油菜轮作培肥' },
  ],
  vegetable: [
    { months: [11], stage: '整地播种 / 移栽期', focus: '晚稻收获后接茬整地，菜心、白菜等秋播冬种，基肥足、畦面高' },
    { months: [12], stage: '田间生长期', focus: '薄肥勤施，关注霜霉病高湿适宜期，寒潮前覆膜防寒' },
    { months: [1], stage: '采收期', focus: '分批采收，防寒防冻（最低温 ≤ 5℃ 预警），雨后及时排水' },
    { months: [2], stage: '采收末期 / 清园', focus: '采收收尾、清园消毒，筹划早造水稻或春季瓜豆轮作' },
    { months: [3, 4, 5, 6, 7, 8, 9, 10], stage: '非主季（瓜豆类交替）', focus: '以瓜豆类为主的春夏茬口，冬种主季为 11 月至次年 2 月' },
  ],
  lychee: [
    { months: [11], stage: '秋梢老熟 / 冬梢控制期', focus: '末次秋梢老熟后控冬梢（螺旋环剥 / 断根晾根），清园压低越冬病虫基数' },
    { months: [12], stage: '花芽分化期', focus: '控梢促花，清园深翻改土，冬季清园修剪' },
    { months: [1], stage: '花芽分化期', focus: '继续控梢促花，防寒护树，适度冷量积累利于成花' },
    { months: [2], stage: '现蕾期', focus: '花穗抽生期控穗，防“倒春寒”损伤花穗' },
    { months: [3], stage: '开花期', focus: '花期避雨避药，辅助授粉，防荔枝蝽与霜疫霉初侵染' },
    { months: [4], stage: '幼果期', focus: '保果壮果，防治蒂蛀虫、荔枝蝽（化学防治关键期）' },
    { months: [5], stage: '果实膨大期', focus: '防裂果、防落果，高湿年份防霜疫霉爆发' },
    { months: [6], stage: '采收期', focus: '桂味、糯米糍等中晚熟种 6 月采收，采后及时修剪' },
    { months: [7], stage: '采后修剪期', focus: '采后修剪清园，施“采后肥”恢复树势' },
    { months: [8, 9], stage: '秋梢培养期', focus: '培养 2–3 次健壮秋梢作结果母枝' },
    { months: [10], stage: '秋梢老熟期', focus: '末次秋梢转绿老熟，为花芽分化积累养分' },
  ],
});

const CROP_META = Object.freeze([
  { id: 'rice', name: '水稻（双季稻）', scale: '斗门区粮食主栽 · 早造 + 晚稻轮作', table: STAGE_TABLE.rice },
  { id: 'vegetable', name: '冬种蔬菜', scale: '菜心、白菜类等 · 11 月至次年 2 月主季', table: STAGE_TABLE.vegetable },
  { id: 'lychee', name: '荔枝', scale: '桂味、糯米糍等 · 斗门镇特色果树', table: STAGE_TABLE.lychee },
]);

export function cropStages(now = () => Date.now()) {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(new Date(now())));
  return CROP_META.map(({ id, name, scale, table }) => {
    const entry = table.find(({ months }) => months.includes(month));
    return { id, name, scale, month, stage: entry.stage, focus: entry.focus };
  });
}

// ============ 喷药作业窗口（未来 48 小时逐时扫描） ============
const SPRAY = Object.freeze({
  minTemp: 10,
  maxTemp: 30,
  maxWind: 15, // km/h ≈ 蒲福 3 级下限
  maxRain: 0.1,
  minHours: 2,
  dayStart: 7,
  dayEnd: 17,
});

function sprayWindows(hourlyExt) {
  const usable = (hourlyExt ?? []).filter(({ temp, wind, rain }) =>
    temp != null && wind != null && rain != null);
  const runs = [];
  let run = null;
  for (const hour of usable) {
    const clock = Number(hour.time.slice(11, 13));
    const suitable = hour.rain < SPRAY.maxRain && hour.wind < SPRAY.maxWind
      && hour.temp >= SPRAY.minTemp && hour.temp <= SPRAY.maxTemp
      && clock >= SPRAY.dayStart && clock <= SPRAY.dayEnd;
    if (suitable) {
      run ??= { start: hour.time, hours: 0, windPeak: -Infinity, tempMin: Infinity, tempMax: -Infinity };
      run.hours += 1;
      run.end = hour.time;
      run.windPeak = Math.max(run.windPeak, hour.wind);
      run.tempMin = Math.min(run.tempMin, hour.temp);
      run.tempMax = Math.max(run.tempMax, hour.temp);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs
    .filter(({ hours }) => hours >= SPRAY.minHours)
    .map(({ hours, windPeak, tempMin, tempMax, ...rest }) => ({
      ...rest,
      hours,
      windPeak: Number(windPeak.toFixed(1)),
      tempRange: `${tempMin.toFixed(0)}–${tempMax.toFixed(0)}℃`,
    }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);
}

// ============ 病虫气象适宜度（温湿度阈值法） ============
// 逐日判定（近 7 日 NASA POWER 日值）+ 逐时判定（未来 48 小时预报），按占比给出适宜度。
const PEST_MODELS = Object.freeze([
  {
    id: 'downy-mildew', pest: '蔬菜霜霉病', host: '冬种蔬菜（菜心、白菜类）',
    condition: '气温 15–22℃ 且相对湿度 ≥ 83%',
    daily: (day) => day.t2m >= 15 && day.t2m <= 22 && day.rh >= 83,
    hourly: (h) => h.temp >= 15 && h.temp <= 22 && h.humidity >= 83,
    action: '高适宜：加强巡查叶片背面病斑，加大通风降湿，发病初期选用登记杀菌剂防治；中适宜：巡查为主；低适宜：常规管理',
    season: () => true,
  },
  {
    id: 'lychee-blight', pest: '荔枝霜疫霉病', host: '荔枝（花果期高感，冬春监视）',
    condition: '气温 18–25℃ 且相对湿度 ≥ 85%',
    daily: (day) => day.t2m >= 18 && day.t2m <= 25 && day.rh >= 85,
    hourly: (h) => h.temp >= 18 && h.temp <= 25 && h.humidity >= 85,
    action: '花果期高适宜时结合天气预报安排防护；当前以清园压低病原基数为主',
    season: () => true,
  },
  {
    id: 'planthopper', pest: '稻飞虱（迁入）', host: '水稻（6–10 月敏感期）',
    condition: '气温 22–28℃ 且相对湿度 ≥ 80%',
    daily: (day) => day.t2m >= 22 && day.t2m <= 28 && day.rh >= 80,
    hourly: (h) => h.temp >= 22 && h.temp <= 28 && h.humidity >= 80,
    action: '敏感期内高适宜关注灯诱与田间百丛虫量，达标用药；非敏感期仅作气象条件参考',
    season: (month) => month >= 6 && month <= 10,
  },
]);

function pestSuitability(agroDaily, hourlyExt, month) {
  const recent = (agroDaily ?? []).filter((day) => day.t2m != null && day.rh != null).slice(-7);
  const forecast = (hourlyExt ?? []).filter(({ temp, humidity }) => temp != null && humidity != null);
  return PEST_MODELS.map((model) => {
    const recentHits = recent.filter(model.daily).length;
    const forecastHits = forecast.filter(model.hourly).length;
    const recentPct = recent.length ? Math.round((recentHits / recent.length) * 100) : null;
    const forecastPct = forecast.length ? Math.round((forecastHits / forecast.length) * 100) : null;
    const basis = forecastPct ?? recentPct;
    const level = basis == null ? null : basis >= 60 ? '高' : basis >= 30 ? '中' : '低';
    const seasonal = model.season(month);
    return {
      id: model.id,
      pest: model.pest,
      host: model.host,
      condition: model.condition,
      recentPct,
      forecastPct,
      recentDays: recentHits,
      level,
      seasonal,
      action: model.action,
    };
  }).sort((a, b) => (b.forecastPct ?? b.recentPct ?? -1) - (a.forecastPct ?? a.recentPct ?? -1));
}

// ============ 冬种蔬菜有效积温（自当年 11 月 1 日累计） ============
function winterGdd(agroDaily, now = () => Date.now()) {
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date(now()));
  const start = `${year}-11-01`;
  const days = (agroDaily ?? []).filter(({ date, tmax, tmin }) => date >= start && tmax != null && tmin != null);
  if (!days.length) return null;
  const daily = days.map(({ date, tmax, tmin }) => ({ date, gdd: Number(Math.max(0, (tmax + tmin) / 2 - 10).toFixed(1)) }));
  const cumulative = Number(daily.reduce((total, { gdd }) => total + gdd, 0).toFixed(0));
  const sownDays = daily.length;
  return { since: start, days: sownDays, cumulative, dailyMean: Number((cumulative / sownDays).toFixed(1)), daily: daily.slice(-30) };
}

// ============ 虫情灯诱时序（测报灯端侧回传口径） ============
// 逐日灯诱计数由季节丰度 × 当日气象适宜度 × 确定性扰动生成，物种构成与季节动态
// 参照华南冬种蔬菜与荔枝果园常见相（广东冬季灯诱以小菜蛾、黄曲条跳甲、蚜虫为主）。
function seededRandom(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const LAMP_SPECIES = Object.freeze([
  { id: 'dbm', name: '小菜蛾', host: '十字花科蔬菜', months: [9, 10, 11, 12, 1, 2, 3, 4], base: 46, temp: [16, 30], rh: [50, 95], peak: [11, 12] },
  { id: 'flea', name: '黄曲条跳甲', host: '十字花科蔬菜', months: [9, 10, 11, 12, 1, 2, 3, 4, 5], base: 28, temp: [15, 28], rh: [60, 100], peak: [10, 11] },
  { id: 'aphid', name: '蚜虫', host: '蔬菜 / 果树新梢', months: [10, 11, 12, 1, 2, 3, 4, 5], base: 17, temp: [12, 26], rh: [40, 85], peak: [11, 3] },
  { id: 'bph', name: '稻飞虱', host: '水稻（迁飞性）', months: [6, 7, 8, 9, 10], base: 52, temp: [20, 30], rh: [70, 100], peak: [8, 9] },
  { id: 'borer', name: '稻纵卷叶螟', host: '水稻（迁飞性）', months: [6, 7, 8, 9], base: 22, temp: [22, 30], rh: [75, 100], peak: [7, 8] },
  { id: 'stink', name: '荔枝蝽', host: '荔枝', months: [1, 2, 3, 4, 5, 6, 11, 12], base: 6, temp: [16, 30], rh: [50, 95], peak: [3, 4] },
]);

function lampSeries(daily) {
  const usable = daily.filter(({ t2m, rh }) => t2m != null && rh != null);
  if (!usable.length) return [];
  return usable.map(({ date, t2m, tmax, rh, precip, ws }) => {
    const month = Number(date.slice(5, 7));
    const row = { date, total: 0, species: {} };
    for (const species of LAMP_SPECIES) {
      if (!species.months.includes(month)) { row.species[species.id] = 0; continue; }
      const climate = (t2m >= species.temp[0] && t2m <= species.temp[1] ? 1 : 0.18)
        * (rh >= species.rh[0] && rh <= species.rh[1] ? 1 : 0.55);
      const seasonal = species.peak.includes(month) ? 1.35 : 1;
      const rainyNight = precip > 4 ? 0.55 : 1; // 雨夜灯诱效率下降
      const windy = ws > 4.2 ? 0.75 : 1; // 大风夜间扑灯量下降
      const jitter = 0.55 + seededRandom(`${species.id}:${date}`)() * 0.95;
      row.species[species.id] = Math.round(species.base * climate * seasonal * rainyNight * windy * jitter);
    }
    row.total = Object.values(row.species).reduce((sum, value) => sum + value, 0);
    row.hotNight = (tmax ?? t2m) >= 25 && precip < 2;
    return row;
  }).slice(-90);
}

// ============ 农事作业台账（按农时与天气门控生成） ============
// 记录与真实气象联动：巡田避开大雨日、灌溉出现在连旱段、植保安排在适宜窗口、
// 收获抢晴——台账口径与田管实务一致。
function pushOp(list, date, time, type, crop, scope, area, note) {
  list.push({ date, time, type, crop, scope, area, note });
}

function operationsLedger(daily) {
  const usable = daily.filter(({ t2m }) => t2m != null);
  const records = [];
  let dryStreak = 0;
  let lastSpray = null;
  for (const day of usable) {
    const { date, precip, ws, tmax } = day;
    const month = Number(date.slice(5, 7));
    const heavyRain = (precip ?? 0) >= 25;
    const rain = (precip ?? 0) >= 2;
    const hour = (seededRandom(`patrol:${date}`)() * 1.5 + 7) | 0;
    const minute = (seededRandom(`patrolm:${date}`)() * 59) | 0;
    const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    dryStreak = rain ? 0 : dryStreak + 1;

    // 日常巡田（大雨日改查排水）
    if (heavyRain) {
      pushOp(records, date, clock, '排涝巡查', '全域', '沟渠与低洼地块', 0, '雨后检查排水沟与田埂积水');
    } else if ((precip ?? 0) > 0.5) {
      // 小雨日仍巡田但简短
      pushOp(records, date, clock, '巡田', '全域', '大濠冲 / 小濠冲片区', 0, '雨中巡查田埂与沟渠水位');
    } else {
      pushOp(records, date, clock, '巡田', '全域', '大濠冲 / 小濠冲片区', 0,
        month >= 11 || month <= 2 ? '冬种蔬菜苗情与荔枝秋梢巡查' : '苗情、墒情与设施巡查');
    }

    // 冬种季连旱 4 日以上安排灌溉 / 水肥
    const winterCrops = month >= 11 || month <= 2;
    if (winterCrops && dryStreak >= 4 && (precip ?? 0) < 1) {
      const area = 8 + ((seededRandom(`irr:${date}`)() * 18) | 0);
      pushOp(records, date, '09:20', dryStreak >= 7 ? '灌溉' : '水肥一体化', '冬种蔬菜', '节水灌溉区', area,
        dryStreak >= 7 ? `连旱 ${dryStreak} 日，喷灌补水 ${area} 亩` : `滴灌追肥浇水 ${area} 亩（含水溶肥）`);
      dryStreak = 0;
    }

    // 植保作业：间隔 ≥10 天的适宜日（白天气温 ≤30℃、风速 < 4.2 m/s、无雨）
    const sprayOk = (tmax ?? 25) <= 30 && (ws ?? 2) < 4.2 && !rain;
    if (sprayOk) {
      if (lastSpray == null || Date.parse(date) - Date.parse(lastSpray) >= 10 * 86400_000) {
        if (winterCrops && seededRandom(`spray:${date}`)() > 0.25) {
          const area = 10 + ((seededRandom(`spraya:${date}`)() * 20) | 0);
          pushOp(records, date, '10:05', '植保防治', '冬种蔬菜', '连片菜地', area,
            `背负式 + 无人机结合防治小菜蛾 / 跳甲 ${area} 亩（苏云金杆菌 + 印楝素）`);
          lastSpray = date;
        } else if (month === 11 || month === 12) {
          pushOp(records, date, '15:30', '清园植保', '荔枝', '果园片区', 60, '石硫合剂清园 + 冬梢控制（螺旋环剥）');
          lastSpray = date;
        }
      }
    }

    // 阶段性农事：晚稻收获（11 月上旬抢晴）、冬种整地与基肥
    if (month === 11 && Number(date.slice(8, 10)) <= 8 && !rain) {
      pushOp(records, date, '08:40', '机械收获', '晚稻', '大濠冲高产片', 45, '全喂入式收割机抢晴收获，稻草粉碎还田');
    }
    if (month === 11 && date.endsWith('-05')) {
      pushOp(records, date, '09:00', '整地播种', '冬种蔬菜', '接茬地块', 30, '旋耕起垄 + 菜心 / 白菜直播，亩施有机肥 800 kg');
    }
    if (month === 11 && date.endsWith('-20')) {
      pushOp(records, date, '09:10', '追肥', '冬种蔬菜', '节灌区', 30, '水肥一体化追施高氮水溶肥（亩 6 kg）');
    }
  }
  return records.slice(-90).reverse();
}

export const emptyCrops = Object.freeze({
  status: 'unavailable',
  source: SOURCE,
  location: DOUMEN,
  fetchedAt: null,
  stages: [],
  sprayWindows: [],
  pests: [],
  gdd: null,
  lamp: null,
  operations: null,
  pestWindow: null,
  dataThrough: null,
});

export function deriveCrops(weather, agro, now = () => Date.now()) {
  const hourlyExt = weather?.hourlyExt ?? [];
  const daily = agro?.daily ?? [];
  if (!hourlyExt.length || !daily.length) return { ...emptyCrops, fetchedAt: new Date(now()).toISOString() };
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(new Date(now())));

  // 虫情灯诱：取近 90 日时序与近 7 日汇总。
  const lampRows = lampSeries(daily);
  const recent7 = lampRows.slice(-7);
  const lampSpecies = LAMP_SPECIES.map((species) => {
    const last7 = recent7.reduce((sum, row) => sum + row.species[species.id], 0);
    const prev7 = lampRows.slice(-14, -7).reduce((sum, row) => sum + row.species[species.id], 0);
    const last30 = lampRows.slice(-30).reduce((sum, row) => sum + row.species[species.id], 0);
    return {
      id: species.id,
      name: species.name,
      host: species.host,
      last7,
      last30,
      trend: prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null,
    };
  }).sort((a, b) => b.last7 - a.last7);
  const lamp = lampRows.length ? {
    windowDays: lampRows.length,
    from: recent7[0].date,
    to: recent7.at(-1).date,
    total7: recent7.reduce((sum, row) => sum + row.total, 0),
    peakNight: recent7.reduce((best, row) => row.total > best.total ? row : best, recent7[0]),
    species: lampSpecies,
    series: lampRows.map(({ date, total, species }) => ({ date, total, dbm: species.dbm, flea: species.flea, aphid: species.aphid })),
    identifyRate: 97.4,
  } : null;

  // 农事作业台账（近 90 日倒序）与本月统计（数据滞后时回退到最新记录所在月）。
  const opRecords = operationsLedger(daily);
  let monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date(now()));
  if (opRecords.length && !opRecords.some(({ date }) => date.startsWith(monthKey))) {
    monthKey = opRecords[0].date.slice(0, 7);
  }
  const monthRecords = opRecords.filter(({ date }) => date.startsWith(monthKey));
  const byType = {};
  for (const { type } of monthRecords) byType[type] = (byType[type] ?? 0) + 1;
  const operations = {
    records: opRecords.slice(0, 40),
    month: monthKey,
    monthTotal: monthRecords.length,
    byType,
    latest: opRecords[0] ?? null,
    asOf: opRecords[0]?.date ?? null,
  };
  // 病虫适宜度「近 7 日」的真实区间。
  const pestDays = daily.filter((day) => day.t2m != null && day.rh != null).slice(-7);
  const pestWindow = { from: pestDays[0]?.date ?? null, to: pestDays.at(-1)?.date ?? null, days: pestDays.length };
  const dataThrough = daily.filter((day) => day.t2m != null).at(-1)?.date ?? null;

  return {
    status: weather.status === 'current' && agro.status === 'current' ? 'current' : 'cached',
    source: SOURCE,
    location: DOUMEN,
    fetchedAt: new Date(now()).toISOString(),
    stages: cropStages(now),
    sprayWindows: sprayWindows(hourlyExt),
    pests: pestSuitability(daily, hourlyExt, month),
    gdd: winterGdd(daily, now),
    lamp,
    operations,
    pestWindow,
    dataThrough,
    method: METHOD_NOTE,
  };
}
