// 斗门主要作物农事日历：大屏日历表、作物农事决策、灌溉参考作物共用这一份，保证三处口径一致。
// 本模块不依赖任何运行环境，浏览器（src）与数据接口（server）都直接引用。
// 依据广东省水稻、荔枝栽培技术规程与斗门镇调研整理，月份为公历，下标 0 为 1 月。
export const cropCalendar = {
  note: "依据广东省水稻、荔枝栽培技术规程与斗门镇调研整理，月份为公历",
  crops: [
    { name: "早稻", key: "rice-early", months: ["育秧", "育秧", "移栽", "分蘖", "拔节", "抽穗灌浆", "收获", null, null, null, null, null] },
    { name: "晚稻", key: "rice-late", months: [null, null, null, null, null, null, "育秧移栽", "分蘖", "拔节抽穗", "灌浆", "收获", null] },
    { name: "荔枝", key: "lychee", months: ["控梢促花", "花芽分化", "开花", "幼果发育", "果实发育", "采收", "采后修剪", "培养秋梢", "培养秋梢", "冬梢控制", "冬梢控制", "冬梢控制"] },
    { name: "冬种蔬菜", key: "veg", months: ["田间管护", "采收", "采收", "收获收尾", null, null, null, null, "备耕整地", "育苗", "定植", "田间管护"] },
  ],
};

export const cropStageTones = {
  育: "#4da3ff", 移: "#5ec7e0", 分: "#58c98a", 拔: "#58c98a", 抽: "#e8c95c", 灌: "#e8c95c",
  幼: "#e8c95c", 果: "#e8c95c", 花: "#e2b369", 收: "#f0954a", 采: "#f0954a", 修: "#a08ac2",
  梢: "#7aa668", 控: "#8b9aa8", 备: "#8b9aa8", 育苗: "#4da3ff", 定: "#5ec7e0", 管: "#7aa668", 整: "#8b9aa8",
};

// 各生育期的参考作物系数 Kc（FAO-56 表 12）：水稻 初期 1.05 / 中期 1.20 / 末期 0.75，
// 叶菜类（甘蓝、生菜）初期 0.70 / 中期 1.00 / 末期 0.95；分蘖属发育期，取初期与中期之间。
// 荔枝为多年生果树，不按参考作物法换算灌溉量。
export const CROP_COEFFICIENTS = Object.freeze({
  "rice-early": Object.freeze({ 育秧: 1.05, 移栽: 1.05, 分蘖: 1.15, 拔节: 1.20, 抽穗灌浆: 1.20, 收获: 0.75 }),
  "rice-late": Object.freeze({ 育秧移栽: 1.05, 分蘖: 1.15, 拔节抽穗: 1.20, 灌浆: 1.20, 收获: 0.75 }),
  veg: Object.freeze({ 育苗: 0.70, 定植: 0.70, 田间管护: 1.00, 采收: 0.95, 收获收尾: 0.95 }),
});

// 不纳入区域灌溉参考的生育期：收获期以排水落干为主；秧苗期、育苗期面积很小；备耕期尚无作物。
export const NON_IRRIGATION_STAGES = Object.freeze(["收获", "育秧", "育苗", "备耕整地"]);

// 拟试点地块的规划场景：土壤栽培果蔬，以番茄为参考作物（FAO-56 表 12，中期 Kc 1.15）。
export const PILOT_CROP = Object.freeze({ id: "pilot-veg", name: "拟试点地块果蔬（番茄）", stage: "中期", kc: 1.15, irrigable: true, pilot: true });

// 各作物逐月的农事要点，键为「作物:月份下标」。
const STAGE_NOTES = Object.freeze({
  "rice-early:0": "冬闲田翻耕晒白、备足农资；下旬起浸种催芽，防寒育秧",
  "rice-early:1": "薄膜育秧防「倒春寒」，适时炼苗",
  "rice-early:2": "上中旬移栽（种粮扶持插秧期 3/1–4/20），浅水促回青",
  "rice-early:3": "够苗晒田，关注稻纵卷叶螟与纹枯病",
  "rice-early:4": "「龙舟水」期保水养胎，强降雨前清沟排水",
  "rice-early:5": "防御「雨打禾花」，防范高温热害与暴雨（QX/T 208-2013）",
  "rice-early:6": "上中旬抢晴收获，收获前适时断水、田间排水",
  "rice-late:6": "下旬播种育秧，台风高发期关注预警（晚造扶持插秧期 7/10–8/20）",
  "rice-late:7": "移栽返青、分蘖，够苗晒田；防范台风暴雨",
  "rice-late:8": "9 月下旬起进入寒露风敏感期，保持浅水层",
  "rice-late:9": "寒露风监测（GB/T 34816-2017），灌浆期干湿交替",
  "rice-late:10": "上中旬抢晴收获，稻草还田，接茬冬种",
  "lychee:0": "继续控冬梢，防寒护树；适度冷量积累利于成花",
  "lychee:1": "花穗抽生期控穗，防「倒春寒」损伤花穗",
  "lychee:2": "花期避雨避药，辅助授粉，防荔枝蝽",
  "lychee:3": "保果壮果，防治蒂蛀虫、荔枝蝽（化学防治关键期）",
  "lychee:4": "防裂果、防落果，高湿年份防霜疫霉病",
  "lychee:5": "桂味、糯米糍等中晚熟种采收，采后及时修剪",
  "lychee:6": "采后修剪清园，施采后肥恢复树势",
  "lychee:7": "培养 2–3 次健壮秋梢作结果母枝",
  "lychee:8": "秋梢转绿期防荔枝瘿螨、蒂蛀虫",
  "lychee:9": "末次秋梢老熟后控冬梢（螺旋环剥 / 断根晾根）",
  "lychee:10": "清园压低越冬病虫基数，结合清园植保",
  "lychee:11": "冬季清园修剪、深翻改土",
  "veg:0": "薄肥勤施，寒潮前覆膜防寒，雨后及时排水",
  "veg:1": "分批采收，关注霜霉病高湿适宜期",
  "veg:2": "采收收尾，清园消毒",
  "veg:3": "清园整地，接茬春季瓜豆或早稻",
  "veg:8": "晚稻收获前备耕备肥，规划接茬地块",
  "veg:9": "菜心、白菜等育苗，防黄曲条跳甲",
  "veg:10": "晚稻收获后接茬整地，高畦定植，基肥充足",
  "veg:11": "水肥一体化追肥，关注霜霉病与小菜蛾",
});
// 不在田时的农事要点：生育期一栏已写明「休田期 / 非种植期」，这里只写田块此时的用途。
const OFF_SEASON_NOTES = Object.freeze({
  "rice-early": "冬季轮作蔬菜或冬闲翻耕",
  "rice-late": "田块种植早稻",
  veg: "田块种植水稻",
});

export const monthIndexOf = (date) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", month: "numeric" }).format(date)) - 1;

// 本月在田作物及生育期：在田的返回日历里的生育期名称，不在田的标为休田期 / 非种植期。
export function cropStagesFor(month) {
  return cropCalendar.crops.map(({ name, key, months }) => {
    const stage = months[month] ?? null;
    const kc = stage ? CROP_COEFFICIENTS[key]?.[stage] ?? null : null;
    return {
      id: key,
      name,
      stage: stage ?? (key === "veg" ? "非种植期" : "休田期"),
      inSeason: Boolean(stage),
      kc,
      irrigable: Boolean(stage) && kc != null && !NON_IRRIGATION_STAGES.includes(stage),
      focus: stage ? STAGE_NOTES[`${key}:${month}`] ?? "" : OFF_SEASON_NOTES[key],
    };
  });
}
