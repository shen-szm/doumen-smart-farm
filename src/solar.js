// 二十四节气：由太阳视黄经（Meeus 低阶展开，精度约 0.01°，对应时间误差 < 20 分钟）推算。
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.2422;

const TERMS = [
  ["小寒", 285], ["大寒", 300], ["立春", 315], ["雨水", 330],
  ["惊蛰", 345], ["春分", 0], ["清明", 15], ["谷雨", 30],
  ["立夏", 45], ["小满", 60], ["芒种", 75], ["夏至", 90],
  ["小暑", 105], ["大暑", 120], ["立秋", 135], ["处暑", 150],
  ["白露", 165], ["秋分", 180], ["寒露", 195], ["霜降", 210],
  ["立冬", 225], ["小雪", 240], ["大雪", 255], ["冬至", 270],
];

// 斗门（珠三角双季稻区）各节气的农事要点。
const ADVICE = new Map([
  ["小寒", "冬种作物防寒管护，清沟排水"], ["大寒", "防低温阴雨，检修农田水利"],
  ["立春", "春耕备耕，早稻种子准备与育秧棚检修"], ["雨水", "早稻育秧，果园清园施肥"],
  ["惊蛰", "早稻播种，病虫越冬基数调查"], ["春分", "秧苗管理，荔枝龙眼保花"],
  ["清明", "早稻移栽，防范强对流天气"], ["谷雨", "插秧扫尾，果树保果"],
  ["立夏", "早稻分蘖期水肥管理"], ["小满", "龙舟水防范，排水沟渠巡查"],
  ["芒种", "早稻抽穗，晚稻备耕"], ["夏至", "台风季开启，棚舍加固"],
  ["小暑", "早稻灌浆成熟，防范高温逼熟"], ["大暑", "早稻抢收，晚稻移栽"],
  ["立秋", "晚稻返青分蘖，秋种蔬菜育苗"], ["处暑", "晚稻分蘖，果园秋梢管理"],
  ["白露", "晚稻拔节，防治迁飞性害虫"], ["秋分", "晚稻抽穗扬花，保水护苗"],
  ["寒露", "晚稻灌浆，防范寒露风"], ["霜降", "晚稻成熟收获，冬种准备"],
  ["立冬", "晚稻收尾，冬种蔬菜马铃薯播种"], ["小雪", "冬种作物管护，果树清园"],
  ["大雪", "冬种作物水肥管理，防霜冻"], ["冬至", "农田水利冬修，备耕物资准备"],
]);

function solarLongitude(time) {
  const julianDay = time / DAY_MS + 2440587.5;
  const centuries = (julianDay - 2451545.0) / 36525;
  const meanLongitude = (280.46646 + 36000.76983 * centuries) % 360;
  const meanAnomaly = (357.52911 + 35999.05029 * centuries) * RAD;
  const lambda = meanLongitude + 1.914602 * Math.sin(meanAnomaly) + 0.019993 * Math.sin(2 * meanAnomaly);
  return ((lambda % 360) + 360) % 360;
}

// 迭代逼近太阳到达指定黄经的时刻。
function timeAtLongitude(target, estimate) {
  let time = estimate;
  for (let step = 0; step < 4; step += 1) {
    const drift = ((solarLongitude(time) - target) % 360 + 360) % 360;
    time += (drift < 180 ? -drift : 360 - drift) / 360 * YEAR_DAYS * DAY_MS;
  }
  return time;
}

const beijingDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const calendarGap = (from, to) =>
  Math.round((Date.parse(beijingDay.format(new Date(to))) - Date.parse(beijingDay.format(new Date(from)))) / DAY_MS);

export function solarTerm(date = new Date()) {
  const now = date.getTime();
  const longitude = solarLongitude(now);
  let currentIndex = 0;
  let degreesBehind = Infinity;
  TERMS.forEach(([name, target], index) => {
    const behind = ((longitude - target) % 360 + 360) % 360;
    if (behind < degreesBehind) { degreesBehind = behind; currentIndex = index; }
  });
  const [name, target] = TERMS[currentIndex];
  const [nextName, nextTarget] = TERMS[(currentIndex + 1) % TERMS.length];
  // 节气日按自然日计：交节当天为第 1 天。
  const crossing = timeAtLongitude(target, now - (degreesBehind / 360) * YEAR_DAYS * DAY_MS);
  const nextCrossing = timeAtLongitude(nextTarget, now + ((15 - degreesBehind) / 360) * YEAR_DAYS * DAY_MS);
  return {
    name,
    nextName,
    daysIn: calendarGap(crossing, now) + 1,
    daysToNext: Math.max(1, calendarGap(now, nextCrossing)),
    advice: ADVICE.get(name) ?? "",
  };
}
