import { asset } from "./data.js";

const cap = "https://www.cneb.gov.cn/yjxx/";

export const officialArchive = [
  { id: "20261003-orange", title: "暴雨橙色预警", color: "orange", area: "白蕉镇、井岸镇", startsAt: "2026-10-03T02:55:00+08:00",
    description: "斗门区气象台发布白蕉镇、井岸镇暴雨橙色预警信号。", url: cap + "csyj/20261003/t20261003_527832603.html" },
  { id: "20261003-yellow", title: "暴雨黄色预警", color: "yellow", area: "白藤街道、莲洲镇、斗门镇、乾务镇", startsAt: "2026-10-03T02:55:00+08:00",
    description: "同次强降雨过程中，斗门区气象台对上述镇街发布暴雨黄色预警。", url: cap + "csyj/20261003/t20261003_527832605.html" },
  { id: "20260914-orange", title: "暴雨橙色预警", color: "orange", area: "莲洲镇、乾务镇、白蕉镇", startsAt: "2026-09-14T14:35:00+08:00",
    description: "三个镇的暴雨预警由黄色升级为橙色，其他三个镇街的黄色信号继续生效。", url: cap + "csyj/20260914/t20260914_527813435.html" },
  { id: "20260727-red", title: "暴雨红色预警", color: "red", area: "斗门区各镇街", startsAt: "2026-07-27T07:15:00+08:00",
    description: "斗门区气象台发布全区各镇街暴雨红色预警信号。", url: cap + "hsyj/20260727/t20260727_527731695.html" },
  { id: "20260725-orange", title: "雷雨大风橙色预警", color: "orange", area: "斗门区各镇街", startsAt: "2026-07-25T17:00:00+08:00",
    description: "斗门区气象台发布各街镇雷雨大风橙色预警信号。", url: cap + "csyj/20260725/t20260725_527729295.html" },
  { id: "20250924-blue", title: "台风蓝色预警", color: "blue", area: "珠海全市（含斗门）", startsAt: "2025-09-24T21:30:00+08:00",
    issuer: "珠海市气象局", description: "台风「桦加沙」远离后，珠海市气象局将全市台风预警下调为蓝色。",
    url: "https://pub-zhtb.hizh.cn/a/202509/24/AP68d3f5b1e4b082260c2e2e7a.html" },
].map((record) => ({ issuer: "斗门区气象台", ...record }));

export const levels = { red: "红色", orange: "橙色", yellow: "黄色", blue: "蓝色", white: "白色" };

export function alertTone(alert) {
  if (Object.hasOwn(levels, alert?.color)) return alert.color;
  return Object.keys(levels).find((color) => String(alert?.severity ?? "").includes(levels[color])) ?? "other";
}

export const fieldImages = [
  { id: "aerial", file: "/media/dahaoyong-aerial.webp", title: "大濠冲农田与村落", context: "无人机航拍 · 2026-07-13", alt: "大濠冲村低空航拍，可见连片农田、沟渠、道路和村落" },
  { id: "overhead", file: "/media/dahaoyong-overhead.webp", title: "田块与灌排沟渠", context: "无人机俯拍 · 2026-07-13", alt: "无人机俯视地块、沟渠和田间道路" },
  { id: "ground", file: "/media/field-ground.webp", title: "地面农田巡查", context: "团队走访照片", alt: "斗门农田近景，可见水面、田埂和背景村居" },
  { id: "orchard", file: "/media/field-orchard.webp", title: "果园地表与树冠", context: "团队走访照片", alt: "果园内部土壤地表和果树树冠" },
  { id: "village", file: "/media/field-village.webp", title: "村边耕作空间", context: "团队走访照片", alt: "村居与近处农作物、田间小路" },
  { id: "planning", file: "/media/dahaoyong-planning-hi.jpg", title: "大濠冲村空间布局专题图", context: "珠海市测绘院 / 广东省地图院 · 2024 年 3 月 · 1:4000", alt: "大濠冲村空间布局专题纸质地图高清翻拍，含彩色地块分区、图例、指北针与比例尺" },
  { id: "tenure", file: "/media/xiaohao-tenure.jpg", title: "小濠冲村土名地界划分初图", context: "村级手绘底图 · 选调生绘制", alt: "小濠冲村传统土名地界手绘地图，标注乌珠咀、大滘围、上帮围、九顷田等位置与虎跳门水道距离" },
  { id: "xiaohao", file: "/media/xiaohai-satellite-detail.webp", title: "小濠冲村影像资料", context: "团队提供的地图影像截图", alt: "小濠冲村居住区与农田的卫星图截图" },
].map((image) => ({ ...image, file: asset(image.file) }));

export const doumenStatistics = {
  year: 2025,
  source: "斗门区统计局 · 国民经济和社会发展统计公报",
  url: "https://www.doumen.gov.cn/attachment/0/439/439924/3930118.pdf#page=2",
  results: [
    { label: "粮食产量", value: "3.17", unit: "万吨", growth: "+1.1%" },
    { label: "蔬菜产量", value: "8.61", unit: "万吨", growth: "−1.9%" },
    { label: "水果产量", value: "1.68", unit: "万吨", growth: "+9.5%" },
    { label: "种植业产值", value: "6.45", unit: "亿元" },
  ],
};

export const localReferences = [
  { title: "莲洲镇高标准农田巡查", context: "珠海 · 莲洲镇石龙村", summary: "高标准农田试点将机耕路、沟渠与低洼地块纳入常态巡护。现场记录可按路线整理，便于追溯沟渠淤塞和路基隐患。",
    url: "https://pub-zhtb.hizh.cn/a/202609/07/AP6a9e8737e4b0858d47771e69.html", source: "珠海当地报道" },
  { title: "斗门地表水监测月报", context: "2026 年 9 月 · 地表水监测",
    summary: "磨刀门水道珠海大桥断面为Ⅱ类，虎跳门水道西炮台断面为Ⅲ类，两处监测断面均达标。",
    url: "https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_3958737.html", source: "珠海市生态环境局斗门分局" },
  { title: "蔬菜防灾减灾技术指导", context: "农业农村与农技推广资料",
    summary: "巡查田间排水沟，检查沟渠与排水口，做好抽排准备。风雨结束后查积水、支架与棚体，记录影响范围。",
    url: "https://www.agri.cn/zx/nyyw/202606/t20260618_8845501.htm", source: "中国农业农村信息网" },
];

export const soilReference = {
  site: "中山神湾镇神溪村监测点",
  station: "442000Z010",
  dates: "2024-02-26 至 03-10",
  url: "https://nync.zs.gov.cn/nyfw/bchqb/content/post_2383166.html",
  layers: [["0–20 cm", 40.89], ["20–40 cm", 101.39], ["40–60 cm", 102.70]],
};

// 斗门（珠三角双季稻区）主要作物农事日历，月份为公历。
// 依据广东水稻、荔枝栽培技术规程与斗门镇调研整理。
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

export const villageHighlights = {
  dahao: [
    "连片稻田为主，冬季轮作蔬菜与马铃薯",
    "大庙坑排洪渠承担片区排涝，强降雨前为重点巡查段",
    "拟试点地块位于西部沿海高速旁（依专题图示意勾绘，待基地确认）",
    "空间布局专题图由珠海市测绘院 / 广东省地图院 2024 年 3 月编制，比例尺 1:4000",
  ],
  xiaohao: [
    "荔枝种植与销售为主导产业，果园为墒情与滴灌监测候选场景",
    "传统土名地界完整：乌珠咀、大滘围、上帮围、散壳、北固、九顷田、龙山、洪山、九女塘、南坑水库等",
    "村域距虎跳门水道约 5.6–7.3 km，排涝依托虎跳门水系",
    "土名地界划分初图由驻村选调生绘制，可作为数字地块档案底图",
  ],
};
