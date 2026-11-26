import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowSquareOut, CaretRight, ChartLineDown, ChartLineUp, CheckCircle, Circle,
  Cloud, CloudFog, CloudRain, CloudSun, MagnifyingGlassMinus, MagnifyingGlassPlus, MapPin,
  Printer, Sun, VideoCamera, X,
} from "@phosphor-icons/react";
import { DETAIL_IMAGERY, FieldMap, villages, PILOT_FIELD } from "./FieldMap.jsx";
import {
  AgroChart, ClimateChart, DailyForecastChart, ForecastChart, MonthlyChart, NdviChart, ObservationChart, OperationsChart, OutputChart,
  PestChart, ReplayChart, RootZoneChart, SoilChart, SoilProfileChart, WaterBalanceChart, WindPressureChart, YieldChart,
} from "./charts.jsx";
import {
  alertUrl, asset, formatTime, getJson, guidanceUrl, number, rainRisk, replayTime,
  shanghai, stationUrl, stormUrl, useActiveAlerts, useReading, weatherText,
} from "./data.js";
import { alertTone, cropCalendar, cropStageTones, doumenStatistics, fieldImages, levels, localReferences, officialArchive, quarterlyAgriculture, rainfallRecord, soilReference, villageHighlights } from "./records.js";
import { gradeOf, soilGradeScale } from "./grades.js";
import { solarTerm } from "./solar.js";

const cameraUrl = import.meta.env.VITE_CAMERA_HLS_URL;
const wave = (source) => source?.status === "current" ? "自动更新" : source?.status === "cached" ? "缓存快照"
  : source ? "暂不可用" : "正在获取";
// 「最近核对」：有的数据源并不是每天都有新数据（云量、发布周期），所以显示最近一次与来源核对的时间。
const checkedText = (source) => `${formatTime(source?.checkedAt, "date")}${source?.status === "cached" ? "（之后未能连上来源，显示的是上次核对的结果）" : ""}`;
// 数据「还没到」和「取不到」要分清楚：没到说获取中，取不到说暂不可用，不能让人干等。
const hasData = (source) => source != null && source.status !== "unavailable";
const pendingText = (source, label = "") => source?.status === "unavailable" ? `${label}暂不可用` : `${label}获取中`;
// 只把还没结束的喷药时段当作可以安排的时段：缓存或过期的预报里会剩下已经过去的时间。
const upcomingSpray = (crops, now = Date.now()) => (crops?.sprayWindows ?? []).filter(({ end }) => Date.parse(end) > now);

// 数值直接显示，不做滚动动效：运营屏上的读数要一眼看到准数。
function CountNumber({ value, digits = 0, unit }) {
  return <strong>{Number.isFinite(value) ? value.toFixed(digits) : "—"}{unit && <small> {unit}</small>}</strong>;
}

// 读数旁的时间：当天只显示时分，更早的显示月日；按日的数据（零点时刻或只有日期）只显示月日。
function stamp(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  const date = new Date(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5).replace("-", "/");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: shanghai }).format(date);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: shanghai }).format(new Date());
  const clock = formatTime(date, "hour");
  if (date.toISOString().slice(11) === "00:00:00.000Z" || clock === "00:00") return day.slice(5).replace("-", "/");
  if (day === today) return clock;
  return formatTime(date);
}

function ClockDisplay() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="clock-display">
    <span>{new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, dateStyle: "medium" }).format(now)}</span>
    <strong>{new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, timeStyle: "medium", hourCycle: "h23" }).format(now)}</strong>
  </div>;
}

// 面板标题只用文字：运营屏上标题前的装饰图标并不传达信息。
function PanelTitle({ title, action, onClick }) {
  return <div className="panel-title">
    <h2>{title}</h2>
    {onClick && <button className="text-button" type="button" onClick={onClick}>
      {action} <CaretRight size={13} />
    </button>}
  </div>;
}

function Metric({ label, value, unit, children }) {
  return <div className="metric"><span>{label}</span>{children ?? <strong>{number(value, ["mm", "°C"].includes(unit) ? 1 : 0)} <small>{unit}</small></strong>}</div>;
}

function GradeBadge({ grade, title }) {
  const meta = gradeOf(grade);
  if (!meta) return <span className="grade-badge grade-unknown">—</span>;
  return <span className="grade-badge" title={title}
    style={{ color: meta.text, borderColor: meta.border, background: meta.bg }}>{meta.label}</span>;
}

function TermChip() {
  const term = useMemo(() => solarTerm(), []);
  return <div className="term-chip" title={term.advice}>
    <strong>{term.name}</strong>
    <span>第 {term.daysIn} 天</span>
    <small>距{term.nextName} {term.daysToNext} 天</small>
  </div>;
}

// 顶部读数条：指标、数值、时间三样，不放图标和走势线。
function KpiStrip({ observations, profile, agro, alerts, onOpen }) {
  const current = observations?.current;
  const latest = profile?.days?.at(-1);
  const active = alerts?.status === "current" ? alerts.alerts : null;
  const cards = [
    { label: "气温", value: current?.temp, digits: 1, unit: "°C", note: "斗门站", time: current?.time, view: "weather" },
    { label: "相对湿度", value: current?.humidity, unit: "%", note: "斗门站", time: current?.time, view: "weather" },
    { label: "24 小时雨量", value: current?.rain, digits: 1, unit: "mm", note: "斗门站", time: current?.time, view: "weather" },
    { label: "根区土壤墒情", value: latest?.relative?.root, unit: "%", grade: latest?.grade?.root,
      note: latest ? "7–28 cm" : wave(profile), time: latest?.date, view: "soil" },
    { label: "参考蒸散量", value: agro?.et0?.latest, digits: 2, unit: "mm/d",
      note: agro?.et0?.latestDate ? `近 30 日均 ${number(agro.et0.mean30, 2)}` : wave(agro), time: agro?.et0?.latestDate, view: "agro" },
    { label: "生效预警", value: active ? active.length : NaN, unit: "条",
      tone: active?.length ? "hot" : "calm", note: active ? (active.length ? "珠海市 / 斗门区" : "当前无生效预警") : wave(alerts),
      time: alerts?.fetchedAt, view: "risk" },
  ];
  return <div className="kpi-strip" aria-label="农情关键指标">
    {cards.map(({ label, value, digits = 0, unit, grade, tone, note, time, view }) => (
      <button key={label} type="button" className={`kpi-card ${tone ?? ""}`} onClick={() => onOpen(view)} title="查看详情">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value"><CountNumber value={value} digits={digits} unit={unit} />
          {grade && <GradeBadge grade={grade} title="土壤相对湿度分级" />}</span>
        <span className="kpi-foot"><small>{note}</small>{time && <small>{stamp(time)}</small>}</span>
      </button>))}
  </div>;
}

function WeatherPanel({ weather, regional, onOpen }) {
  const current = weather?.current;
  const grid = regional?.current;
  const astro = regional?.astro?.[0];
  const condition = current ? (current.text ?? weatherText(current.code))
    : weather?.status === "unavailable" ? "实况暂不可用" : "天气待更新";
  const Icon = condition === "晴" ? Sun : condition === "阴" ? Cloud : condition.includes("雨") ? CloudRain : condition.includes("雾") ? CloudFog : CloudSun;
  return <section className="panel weather-panel">
    <PanelTitle title="斗门站实况" action="逐时实况" onClick={onOpen} />
    <div className="weather-core">
      {current && <Icon className="weather-icon" size={34} weight="duotone" />}
      <div><strong>{number(current?.temp, 1)}<small>°C</small></strong>
        <p>{condition} {current?.windDirection && <span>· {current.windDirection}{current.windLevel ? ` ${current.windLevel}` : ""}</span>}</p></div>
    </div>
    <div className="weather-grid">
      <Metric label="相对湿度" value={current?.humidity} unit="%" />
      <Metric label="风速" value={current?.wind} unit="km/h" />
      <Metric label="气压" value={current?.pressure} unit="hPa" />
      <Metric label="24 小时雨量" value={current?.rain} unit="mm" />
      <Metric label="露点温度" value={grid?.dewPoint} unit="°C" />
      <Metric label="体感温度" value={grid?.apparent} unit="°C" />
    </div>
    <div className="panel-footer">
      <span>{current?.time ? `${stamp(current.time)} 观测${weather.status === "cached" ? " · 最近记录" : ""}` : wave(weather)}</span>
      {astro && <span>日出 {astro.sunrise} · 日落 {astro.sunset}</span>}
    </div>
  </section>;
}

// 临近降雨（15 分钟步长 nowcast）：只看当前时刻之后的样本，给出未来 8 小时内的降雨起始提示。
function nowcastOf(minutely, now = Date.now()) {
  const ahead = (minutely ?? []).filter(({ time }) => Date.parse(time) > now + 15 * 60_000);
  if (!ahead.length) return null;
  const onset = ahead.find(({ rain }) => rain > 0.1);
  if (!onset) return { soon: false, text: `未来 ${Math.round((ahead.length * 15) / 60)} 小时无降雨` };
  const minutes = Math.round((Date.parse(onset.time) - now) / 60_000);
  return { soon: true, text: minutes <= 90 ? `临近降雨：约 ${minutes} 分钟后开始，宜提前收拢露天农资` : `临近降雨：约 ${Math.round(minutes / 60)} 小时后开始` };
}

function ForecastPanel({ weather, risk, onOpen }) {
  const nowcast = nowcastOf(weather?.minutely);
  return <section className="panel forecast-panel">
    <PanelTitle title="未来 24 小时预报" action="详细" onClick={onOpen} />
    <div className="forecast-summary">
      <div><span>{weather?.status === "cached" ? "上次预报 · 累计降雨" : "累计降雨"}</span><strong>{number(risk.total, 1)} <small>mm</small></strong></div>
      <div className="forecast-side">
        {nowcast && <div className={`nowcast-strip ${nowcast.soon ? "nowcast-rain" : ""}`} role="status">
          {nowcast.text}
        </div>}
        <div className="chart-legend">
          <span><i className="legend-rain" />雨量</span>
          <span><i className="legend-probability" />降雨概率</span>
        </div>
      </div>
    </div>
    <ForecastChart hours={weather?.hourly} empty={weather?.status === "unavailable" ? "天气预报暂不可用"
      : weather == null ? "预报获取中" : "暂无逐小时降雨数据"} />
  </section>;
}

function SoilPanel({ profile, onOpen }) {
  const latest = profile?.days?.at(-1);
  const layers = profile?.layers ?? [];
  return <section className="panel soil-panel">
    <PanelTitle title="土壤墒情" action="详细" onClick={onOpen} />
    {latest ? <div className="layer-bars">
      {layers.map(({ id, depth, label }) => <div key={id} className="layer-row"
        title={`${label} ${depth} · 体积含水量 ${number(latest.moisture[id], 1)}% · 相对湿度 ${number(latest.relative[id])}%`}>
        <span className="layer-name">{label}<small>{depth}</small></span>
        <span className="layer-track"><i style={{
          width: `${Math.min(100, (latest.relative[id] / 125) * 100)}%`,
          background: gradeOf(latest.grade[id])?.color,
        }} /></span>
        <strong className="layer-value">{number(latest.moisture[id], 1)}<small>%</small></strong>
        <GradeBadge grade={latest.grade[id]} />
      </div>)}
    </div> : <p className="chart-empty">{pendingText(profile, "剖面数据")}</p>}
    <RootZoneChart days={profile?.days} fieldCapacity={profile?.fieldCapacity?.value} />
    <div className="panel-footer"><span>根区体积含水量 · 7–28 cm</span><time>{latest?.date ?? "—"}</time></div>
  </section>;
}

function LevelBadge({ alert }) {
  const tone = alertTone(alert);
  return <span className={`level-badge level-${tone}`}>{levels[tone] ?? "官方"}</span>;
}

function AlertRow({ alert, onClick, pulse = false }) {
  const tone = alertTone(alert);
  return <button type="button" className={`alert-row ${pulse && (tone === "red" || tone === "orange") ? "alert-pulse" : ""}`} onClick={onClick}>
    <LevelBadge alert={alert} />
    <span><strong>{alert.title}</strong><small>{alert.area || "影响范围见原文"}</small></span>
    <CaretRight size={16} />
  </button>;
}

// 右栏预警面板：生效中的预警排在最前，各带一行状态；没有生效预警时列出最近的记录，值班时看得到近期发生过什么。
function RiskPanel({ risk, alerts, history, onRisk, onAction, onArchive, onAlert }) {
  const official = alerts?.alerts ?? [];
  const activeIds = new Set(official.map(({ id }) => id));
  const past = [...(history?.alerts ?? []), ...officialArchive]
    .filter(({ id }) => !activeIds.has(id))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const status = !alerts ? "预警查询中" : alerts.status !== "current" ? "预警暂不可查询"
    : official.length ? `${official.length} 条生效中` : "当前无生效预警";
  return <section className="panel risk-panel">
    <PanelTitle title="气象预警" action="预警档案" onClick={onRisk} />
    <p className="panel-status">{status}{alerts?.fetchedAt ? ` · ${stamp(alerts.fetchedAt)} 更新` : ""}</p>
    <div className="risk-list">
      {official.map((alert) => <AlertRow key={alert.id} alert={alert} pulse onClick={() => onAlert(alert)} />)}
      {past.slice(0, Math.max(0, 3 - official.length)).map((alert) => <button key={alert.id} type="button" className="risk-line"
        onClick={() => onAlert(alert, true)} title={alert.area ? `${alert.title} · ${alert.area}` : alert.title}>
        <LevelBadge alert={alert} />
        <strong>{alert.title}</strong>
        <time>{formatTime(alert.startsAt)}</time>
      </button>)}
    </div>
    <div className="risk-links">
      <button type="button" className={`risk-chip ${risk.high ? "risk-chip-high" : ""}`} onClick={onAction}
        title={risk.high ? "累计雨量已达排水提示阈值" : "查看农事处置建议"}>
        <span>{risk.high ? "排水提示" : "处置建议"}</span><CaretRight size={13} />
      </button>
      <button type="button" className="risk-chip" onClick={() => onArchive("all")}>
        <span>历史记录</span><span>{officialArchive.length + (history?.alerts?.length ?? 0)} 条</span>
      </button>
    </div>
  </section>;
}

// 品牌标识：「田」字方格，一块地分成四畦。自己画的内联图形，不用图标库里的通用图标。
function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 28 28" width="30" height="30" aria-hidden="true">
    <rect x="14" y="2" width="12" height="12" fill="currentColor" opacity=".28" />
    <rect x="2" y="2" width="24" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <path d="M14 2v24M2 14h24" stroke="currentColor" strokeWidth="2.2" />
  </svg>;
}

const clipClock = (seconds) => `${String(Math.floor((seconds ?? 0) / 60)).padStart(2, "0")}:${String((seconds ?? 0) % 60).padStart(2, "0")}`;

// 现场录像：循环、静音。浏览器只允许静音的视频自动播放，所以始终不设声音。
// 个别浏览器或省电模式会拦下自动播放，这时给出「点击播放」，由使用者点一下开始。
function MonitorVideo({ clip }) {
  const video = useRef(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const start = () => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    element.volume = 0;
    element.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  };
  useEffect(() => { start(); }, []);
  if (failed) return <p className="monitor-failed">录像暂时无法播放</p>;
  return <>
    <video ref={video} className="monitor-video" src={asset(`/media/monitor/${clip.file}`)}
      poster={clip.poster ? asset(`/media/monitor/${clip.poster}`) : undefined}
      loop muted autoPlay playsInline preload="auto" disablePictureInPicture disableRemotePlayback
      onError={() => setFailed(true)} />
    {blocked && <button type="button" className="monitor-play" onClick={start}>点击播放</button>}
  </>;
}

// 右栏现场监控：循环、静音播放最近一段现场录像，点「放大」看大图。
function MonitorPanel({ clips, onOpen, onArchive }) {
  const clip = clips?.[0];
  return <section className="panel monitor-panel">
    <PanelTitle title="现场监控" action="影像档案" onClick={onArchive} />
    {clip ? <>
      <div className="monitor-stage">
        <MonitorVideo key={clip.date} clip={clip} />
        <span className="monitor-tag">回放</span>
        <span className="monitor-date">{monthDay(clip.date)}</span>
        <button type="button" className="monitor-expand" onClick={onOpen}>放大</button>
      </div>
      <div className="panel-footer"><span>{clipClock(clip.duration)} · 循环 · 静音</span><span>{clip.note ?? "现场录像"}</span></div>
    </> : <p className="detail-empty">{clips ? "暂无现场录像" : "录像加载中"}</p>}
  </section>;
}

function MonitorDetails({ clips }) {
  const list = clips ?? [];
  const [index, setIndex] = useState(0);
  const clip = list[index] ?? list[0];
  return list.length ? <>
    {list.length > 1 && <div className="range-tabs" role="group" aria-label="录像日期">
      {list.map((item, order) => <button key={item.date} type="button" aria-pressed={clip?.date === item.date}
        onClick={() => setIndex(order)}>{item.date}</button>)}
    </div>}
    {clip && <>
      <div className="monitor-stage monitor-stage-large"><MonitorVideo key={clip.date} clip={clip} /><span className="monitor-tag">回放</span></div>
      <Metadata rows={[
        ["录像日期", clip.date],
        ["时长", clipClock(clip.duration)],
        ["拍摄方式", clip.note ?? "—"],
        ["播放方式", "循环播放，无声音"],
        ["原始文件", clip.source],
      ]} />
    </>}
  </> : <p className="detail-empty">暂无现场录像</p>;
}

// 分析区的一格：滚到附近才初始化图表，首屏加载不受影响。
function AnalysisPanel({ title, meta, action = "详情", onClick, source, children }) {
  const host = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShown(true);
      observer.disconnect();
    }, { rootMargin: "360px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <section className="panel analysis-panel" ref={host}>
    <PanelTitle title={title} action={onClick ? action : undefined} onClick={onClick} />
    {meta && hasData(source) && <p className="panel-status">{meta}</p>}
    {source?.status === "unavailable" ? <p className="chart-empty">这项数据暂不可用</p>
      : hasData(source) ? (shown ? children : <div className="analysis-chart" />) : <div className="analysis-chart" />}
  </section>;
}

// 页面下方的「农情分析」：各路时序数据摊开成图表，数据与首屏、弹层同源。
function AnalysisSection({ observations, weather, profile, agro, crops, ndvi, satelliteSoil, onOpen, onLedger }) {
  const span = (days) => days?.length ? `${monthDay(days[0].date)}–${monthDay(days.at(-1).date)}` : "";
  const chart = (props) => ({ className: "analysis-chart", ...props });
  return <section id="analysis" className="analysis-records" aria-label="农情分析">
    <div className="section-head"><h2>农情分析</h2>
      <span>{agro?.dataThrough ? `农业气象日值截至 ${agro.dataThrough}` : ""}</span></div>
    <div className="analysis-grid">
      <AnalysisPanel title="近 24 小时气温与湿度" meta="斗门站整点实况" onClick={() => onOpen("weather")} source={observations}>
        <ObservationChart hours={observations?.history} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="未来 7 日气温与降水" meta="逐日预报" onClick={() => onOpen("forecast")} source={weather}>
        <DailyForecastChart daily={weather?.daily} /></AnalysisPanel>
      <AnalysisPanel title="近 24 小时风速与气压" meta="斗门站整点实况" onClick={() => onOpen("weather")} source={observations}>
        <WindPressureChart hours={observations?.history} /></AnalysisPanel>
      <AnalysisPanel title="土壤墒情剖面" meta={`${span(profile?.days)} · 表层 / 根区 / 深层体积含水量`} onClick={() => onOpen("soil")} source={profile}>
        <SoilProfileChart days={profile?.days} layers={profile?.layers} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="降雨与参考蒸散" meta={`${span(agro?.daily)} · 虚线为去年同期`} onClick={() => onOpen("agro")} source={agro}>
        <AgroChart daily={agro?.daily} lastYear={agro?.lastYearDaily} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="气温与太阳辐射" meta={`${span(agro?.daily)} · 农业气象日值`} onClick={() => onOpen("agro")} source={agro}>
        <ClimateChart daily={agro?.daily} /></AnalysisPanel>
      <AnalysisPanel title="月度气候统计" meta={`近 ${agro?.monthly?.length ?? 0} 个月 · 当月为进行中的统计`} onClick={() => onOpen("agro")} source={agro}>
        <MonthlyChart monthly={agro?.monthly} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="在田作物水分平衡" meta="近 10 日 · 降雨 / 有效降雨 / 需水量 / 灌溉参考" onClick={() => onOpen("agro")} source={agro}>
        <WaterBalanceChart balances={agro?.balances} /></AnalysisPanel>
      <AnalysisPanel title="卫星遥感表层墒情" meta={`${satelliteSoil?.points?.length ?? 0} 天 · 表层 1–5 cm`} onClick={() => onOpen("soil")} source={satelliteSoil}>
        <SoilChart series={satelliteSoil?.points} daily {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="卫星苗情植被指数" meta="只含云量低于 30% 的影像" onClick={() => onOpen("ndvi")} source={ndvi}>
        <NdviChart scenes={ndvi?.scenes} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="虫情灯诱计数" meta="近 30 日 · 柱为各虫种，折线为合计" onClick={() => onOpen("pest")} source={crops}>
        <PestChart series={crops?.lamp?.series} {...chart()} /></AnalysisPanel>
      <AnalysisPanel title="本月农事作业构成" meta={`${crops?.operations?.month ?? ""} · 按作业类型计次`} action="台账" onClick={onLedger} source={crops}>
        <OperationsChart byType={crops?.operations?.byType} /></AnalysisPanel>
    </div>
  </section>;
}

// 决策摘要短标签：今晨 07:00–08:00 / 25日 09:00–12:00。
const clockLabel = (iso, now = new Date()) => {
  const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: shanghai, day: "numeric" }).format(now));
  const stamp = Number(iso.slice(8, 10));
  return `${stamp === day ? "今" : `${stamp}日`} ${iso.slice(11, 16)}`;
};
// 「近 N 日」的真实区间：数据源有发布滞后，统计窗口按实际起止日期标注。
const monthDay = (date) => date?.slice(5).replace("-", "/") ?? "";
const spanLabel = (span) => span?.from ? `${monthDay(span.from)}–${monthDay(span.to)}` : "";

function AgroPanel({ agro, crops, onOpen, onCrops }) {
  useNow(60_000); // 时段过去之后，「喷药」一栏要跟着变
  const agroReady = hasData(agro);
  const spray = upcomingSpray(crops)[0];
  const pest = crops?.pests?.find(({ seasonal }) => seasonal);
  const pestShort = pest ? `${pest.pest.replace(/（.*$/, "").replace(/病$/, "")} 适宜度${pest.level ?? "—"}` : pendingText(crops, "病虫适宜度");
  const balance = agro?.waterBalance;
  const irrigate = balance != null && balance.irrigationRefMm > 0;
  const noBalance = agroReady ? "本月无灌溉参考作物" : pendingText(agro);
  return <section className="panel agro-panel">
    <PanelTitle title="农事与灌溉" action="详细" onClick={onOpen} />
    <div className="agro-core">
      <div className="agro-et0">
        <span>参考蒸散量</span>
        <CountNumber value={agro?.et0?.latest} digits={2} unit="mm/d" />
        <small>近 30 日均 {number(agro?.et0?.mean30, 2)} mm/d</small>
      </div>
      <div className="agro-balance">
        <div><span>近 10 日降雨{balance?.to && <em> 至 {monthDay(balance.to)}</em>}</span><strong>{number(balance?.precip, 1)} <small>mm</small></strong></div>
        <div><span>作物需水量</span><strong>{number(balance?.etc, 1)} <small>mm</small></strong>
          <small className="agro-crop">{balance ? `${balance.name} · ${balance.stage}` : noBalance}</small></div>
      </div>
    </div>
    <div className="risk-links agro-decision">
      <button type="button" className={`risk-chip ${hasData(crops) && !spray ? "risk-chip-high" : ""}`} onClick={onCrops}
        title={!hasData(crops) ? pendingText(crops) : spray ? `未来 48 小时内昼间适宜喷药的时段，最大风速 ${number(spray.windPeak, 1)} km/h`
          : "未来 48 小时昼间暂无适宜喷药的时段"}>
        <span>{!hasData(crops) ? pendingText(crops, "喷药时段")
          : `喷药${crops.status === "cached" ? "（上次预报）" : ""} ${spray ? `${clockLabel(spray.start)}–${spray.end.slice(11, 16)}` : "48 小时内暂无"}`}</span><CaretRight size={13} />
      </button>
      <button type="button" className={`risk-chip ${pest?.level === "高" ? "risk-chip-high" : ""}`} onClick={onCrops}
        title="病虫气象适宜度（温湿度阈值法模型）">
        <span>{pestShort}</span><CaretRight size={13} />
      </button>
    </div>
    <button type="button" className={`agro-advice ${irrigate ? "agro-advice-irrigate" : ""}`} onClick={onOpen} title="查看蒸散与灌溉决策详情">
      {!balance ? noBalance : irrigate ? `${balance.name}参考补水 ${number(balance.irrigationRefMm, 1)} mm`
        : "近 10 日降雨充足，暂不需要灌溉"}
    </button>
    <button type="button" className="primary-button" onClick={onCrops}>作物农事决策</button>
  </section>;
}

// 农情简报条目：滚动播报与简报弹层共用同一份内容；每条带跳转目标，播报条上点击直达。
// 一律写成「类别：一句话」的值班提示，不带口径说明和数据集名称——那些放在对应的详情里。
// view.type 为 production 表示滚动定位到主界面的生产档案区。
function briefingItems(alerts, agro, profile, crops) {
  const items = [];
  const official = alerts?.status === "current" ? alerts.alerts : [];
  for (const alert of official) {
    items.push({ key: `alert-${alert.id}`, pinned: true, view: { type: "alert", alert },
      text: `【${levels[alertTone(alert)] ?? "官方"}预警】${alert.title}${alert.area ? ` · ${alert.area}` : ""}` });
  }
  if (!official.length) {
    items.push({ key: "alert-none", view: { type: "risk" },
      text: alerts?.status === "current" ? "预警：当前无生效气象预警" : "预警：暂不可查询" });
  }
  const balance = agro?.waterBalance;
  if (balance) {
    items.push({ key: "irrigation", view: { type: "agro" }, text: balance.irrigationRefMm > 0
      ? `灌溉：${balance.name}近 10 日参考补水 ${number(balance.irrigationRefMm, 1)} mm（约 ${number(balance.irrigationRefM3PerMu, 1)} m³/亩）`
      : "灌溉：近 10 日降雨充足，暂不需要灌溉" });
  }
  const latest = profile?.days?.at(-1);
  if (latest && profile?.layers) {
    const grades = profile.layers.map(({ id }) => gradeOf(latest.grade[id])?.label ?? "—");
    const uniform = grades[0] !== "—" && grades.every((label) => label === grades[0]);
    items.push({ key: "soil", view: { type: "soil" }, text: `墒情：${monthDay(latest.date)} ${uniform
      ? `各层均${grades[0]}` : profile.layers.map(({ label }, index) => `${label} ${grades[index]}`).join("、")}` });
  }
  const sprayWindows = upcomingSpray(crops);
  const spray = sprayWindows[0];
  // 作物决策没取到时不播报喷药结论。
  if (hasData(crops)) {
    items.push({ key: "spray", view: { type: "crops" }, text: spray
      ? `喷药${crops.status === "cached" ? "（上次预报）" : ""}：最近适宜时段 ${clockLabel(spray.start)}–${spray.end.slice(11, 16)}`
      : "喷药：未来 48 小时昼间无适宜时段" });
  }
  const pestHot = crops?.pests?.find(({ seasonal, level }) => seasonal && level === "高");
  if (pestHot) items.push({ key: "pest", view: { type: "crops" }, text: `病虫：${pestHot.pest}气象适宜度高，${pestHot.action.split("；")[0]}` });
  if (crops?.lamp) {
    const top = crops.lamp.species[0];
    if (top) items.push({ key: "lamp", view: { type: "pest" },
      text: `虫情：${spanLabel(crops.lamp)} 灯诱 ${number(crops.lamp.total7)} 头，优势种 ${top.name}` });
  }
  // 例行巡田每天都在，只播报最近一次专项作业。
  const latestOp = (crops?.operations?.records ?? []).find(({ type }) => type !== "巡田") ?? crops?.operations?.latest;
  if (latestOp) {
    items.push({ key: "operation", view: { type: "production" },
      text: `农事：${monthDay(latestOp.date)} ${latestOp.type} · ${latestOp.crop}${latestOp.area ? ` ${latestOp.area} 亩` : ""}` });
  }
  for (const [index, risk] of (agro?.risks ?? []).slice(0, 2).entries()) {
    items.push({ key: `agro-risk-${index}`, view: { type: "agro" },
      text: `农气：${monthDay(risk.window)} ${risk.type} · ${risk.detail}` });
  }
  const term = solarTerm();
  items.push({ key: "term", view: { type: "report" }, text: `农时：${term.name} · ${term.advice}` });
  return items;
}

function Briefing({ items }) {
  return <ul className="briefing-list">{items.map(({ key, text }) => <li key={key}>{text}</li>)}</ul>;
}

// 底部滚动农情播报：常驻视口底部。生效中的官方预警固定在左侧、按级别着色，不参与滚动；
// 其余条目循环滚动，点击直达对应详情。空白处点击打开完整简报。
function Ticker({ items, onJump, onOpen }) {
  const pinned = items.filter(({ pinned }) => pinned);
  const rolling = items.filter(({ pinned }) => !pinned);
  const track = (hidden) => <span aria-hidden={hidden || undefined}>
    {rolling.map(({ key, text }, index) => <Fragment key={key}>
      {index > 0 && <i className="ticker-sep" />}
      <button type="button" className="ticker-item" tabIndex={hidden ? -1 : 0}
        onClick={(event) => { event.stopPropagation(); onJump(key); }}>{text}</button>
    </Fragment>)}
  </span>;
  return <footer className={`ticker-bar ${pinned.length ? "ticker-has-alert" : ""}`} aria-label="农情播报">
    <span className="ticker-label">农情播报</span>
    {pinned.length > 0 && <div className="ticker-alerts">{pinned.map(({ key, view }) => {
      const tone = alertTone(view.alert);
      return <button key={key} type="button" className={`ticker-alert level-${tone}`} onClick={() => onJump(key)}>
        <LevelBadge alert={view.alert} /><span>{view.alert.title}</span>
      </button>;
    })}</div>}
    <div className="ticker-viewport" title="点击空白处查看完整农情简报" onClick={onOpen}>
      <div className="ticker-track">{track(false)}{track(true)}</div>
    </div>
  </footer>;
}

function Details({ title, onClose, onBack, children, page, wide = false }) {
  const modal = useRef(null);
  const closeButton = useRef(null);
  const startedOutside = useRef(false);
  useLayoutEffect(() => {
    const element = modal.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => { closeButton.current.focus({ preventScroll: true }); }, [page]);
  return <dialog className={`detail${wide ? " detail-wide" : ""}${page === "report" ? " detail-report" : ""}`} ref={modal} aria-labelledby="detail-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onPointerDown={(event) => { startedOutside.current = event.target === modal.current; }}
    onClick={(event) => { if (startedOutside.current && event.target === modal.current) onClose(); }}>
    <header className="detail-header">
      {onBack && <button type="button" className="icon-button" aria-label="返回上一层" onClick={onBack}><ArrowLeft size={19} /></button>}
      <h2 id="detail-title">{title}</h2>
      {page === "report" && <button type="button" className="report-print" onClick={() => window.print()}><Printer size={18} /> 打印日报</button>}
      <button type="button" className="icon-button" aria-label="关闭详情" ref={closeButton} onClick={onClose} autoFocus><X size={21} /></button>
    </header>
    <div className="detail-content" key={page} tabIndex={0} aria-label="详情内容">{children}</div>
  </dialog>;
}

function Source({ label, href }) {
  return <a className="source-link" href={href} target="_blank" rel="noreferrer">{label} <ArrowSquareOut size={15} /></a>;
}

// 说明类字段（来源、口径、计算方法等）默认折叠进「数据说明」：正文只留读数要用到的事实，口径仍然查得到。
const NOTE_LABELS = new Set(["数据来源", "来源", "资料来源", "计算方法", "观测口径", "识别口径", "分级依据", "数据产品", "田间持水量",
  "作物系数", "有效降雨", "辐射数据", "观测窗口", "时序窗口", "对照样本", "输入数据", "参考坐标", "接口取数时间", "取数时间",
  "采用条件", "影像许可"]);

function Metadata({ rows }) {
  const list = (entries) => <dl className="metadata">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl>;
  const facts = rows.filter(([key]) => !NOTE_LABELS.has(key));
  const notes = rows.filter(([key]) => NOTE_LABELS.has(key));
  return <>
    {facts.length > 0 && list(facts)}
    {notes.length > 0 && <details className="source-details metadata-notes"><summary>数据说明与来源</summary>{list(notes)}</details>}
  </>;
}

function WeatherDetails({ weather, variant, risk, regional }) {
  const [dailyView, setDailyView] = useState(false);
  const current = weather?.current;
  const location = weather?.location;
  const hourly = weather?.hourly ?? [];
  const hourlyExt = (regional ?? weather)?.hourlyExt ?? [];
  const astro = (regional ?? weather)?.astro?.[0];
  const history = weather?.history ?? [];
  if (variant === "forecast") {
    const daily = weather?.daily ?? [];
    const temperatures = hourly.map(({ temp }) => temp).filter(Number.isFinite);
    const gusts = hourly.map(({ gust }) => gust).filter(Number.isFinite);
    const probabilities = hourly.map(({ probability }) => probability).filter(Number.isFinite);
    return <>
      <div className="forecast-toolbar">
        <div className="range-tabs" role="group" aria-label="预报时段">
          <button type="button" aria-pressed={!dailyView} onClick={() => setDailyView(false)}>未来 24 小时</button>
          <button type="button" aria-pressed={dailyView} onClick={() => setDailyView(true)}>未来 7 日</button>
        </div>
        <span className="muted">{weather?.fetchedAt ? `${formatTime(weather.fetchedAt)} 更新` : wave(weather)}{weather?.status === "cached" ? " · 最近预报" : ""}</span>
      </div>
      {dailyView ? <>
        <h3 className="detail-heading">逐日天气</h3>
        {daily.length ? <ReadingTable head={["日期", "天气", "气温 (°C)", "降水 (mm)", "最高降水概率 (%)", "最大阵风 (km/h)", "紫外线峰值", "参考蒸散 (mm)"]}
          rows={daily.map(({ date, code, minTemp, maxTemp, precipitation, probability, gust, uvMax, et0 }) => [
            date, weatherText(code), `${number(minTemp, 1)} / ${number(maxTemp, 1)}`, number(precipitation, 1), number(probability), number(gust, 1), number(uvMax, 1), number(et0, 2),
          ])} /> : <p className="detail-empty">暂无逐日预报。</p>}
        <p className="muted">气温为当日最低 / 最高值。</p>
      </> : <><div className="detail-metrics">
        <Metric label="累计雨量" value={risk.total} unit="mm" />
        <Metric label="最高降雨概率" value={probabilities.length ? Math.max(...probabilities) : null} unit="%" />
        <Metric label="最大阵风" value={gusts.length ? Math.max(...gusts) : null} unit="km/h" />
        <Metric label="气温范围"><strong>{temperatures.length ? `${Math.min(...temperatures)}–${Math.max(...temperatures)}` : "—"} <small>°C</small></strong></Metric>
        <Metric label="当前露点" value={current?.dewPoint} unit="°C" />
        <Metric label="体感温度" value={current?.apparent} unit="°C" />
        <Metric label="今日紫外线峰值" value={astro?.uvMax} />
        <Metric label="昼长 / 日照"><strong>{astro ? `${Math.floor(astro.daylightMinutes / 60)} 时 ${astro.daylightMinutes % 60} 分 / ${number(astro.sunshineHours, 1)} h` : "—"}</strong></Metric>
      </div>
      <ForecastChart hours={hourly} featured />
      <h3 className="detail-heading">逐小时预报</h3>
      {hourlyExt.length ? <ReadingTable head={["预报时刻", "气温 (°C)", "湿度 (%)", "风速 (km/h)", "雨量 (mm)", "降雨概率 (%)", "阵风 (km/h)"]}
        rows={hourlyExt.slice(0, 24).map(({ time, temp, humidity, wind, rain, probability, gust }) => [formatTime(time), number(temp, 1), number(humidity), number(wind, 1), number(rain, 1), number(probability), number(gust, 1)])} />
        : <p className="detail-empty">逐小时预报暂不可用。</p>}</>}
      <details className="source-details"><summary>预报时效与来源</summary><Metadata rows={[
        ["数据状态", wave(weather)], ["接口取数时间", formatTime(weather?.fetchedAt, "date")],
        ["参考坐标", location ? `${location.latitude}° N, ${location.longitude}° E` : "珠海市斗门区"],
        ["日出 / 日落（今日）", astro ? `${astro.sunrise} / ${astro.sunset}` : "—"],
        ["来源", <Source label={weather?.source?.name ?? "Open-Meteo"} href={weather?.source?.url ?? "https://open-meteo.com/en/docs"} />],
      ]} /></details>
    </>;
  }
  const regionalCurrent = regional?.current;
  return <>
    <div className="detail-metrics">
      <Metric label="气温" value={current?.temp} unit="°C" />
      <Metric label="相对湿度" value={current?.humidity} unit="%" />
      <Metric label="气压" value={current?.pressure} unit="hPa" />
      <Metric label="24 小时雨量" value={current?.rain} unit="mm" />
      <Metric label="露点（格点）" value={regionalCurrent?.dewPoint} unit="°C" />
      <Metric label="体感（格点）" value={regionalCurrent?.apparent} unit="°C" />
      <Metric label="今日紫外线峰值" value={astro?.uvMax} />
      <Metric label="日出 / 日落"><strong>{astro ? `${astro.sunrise} / ${astro.sunset}` : "—"}</strong></Metric>
    </div>
    <p>{formatTime(current?.time, "date")} · {current?.text ?? "斗门站"}{current?.windDirection ? ` · ${current.windDirection} ${current.windLevel ?? ""}` : ""}</p>
    <h3 className="detail-heading">过去 24 小时 · 斗门站整点实况</h3>
    {history.length ? <>
      <ObservationChart hours={history} />
      <p className="muted">{formatTime(history[0].time)} 至 {formatTime(history.at(-1).time)} · {history.length} 条记录{weather.historyStatus === "cached" ? " · 最近记录" : ""}</p>
      <ReadingTable head={["观测时刻", "气温 (°C)", "湿度 (%)", "风速 (m/s)", "风向 (°)", "小时雨量 (mm)", "气压 (hPa)"]}
        rows={history.slice().reverse().map(({ time, temp, humidity, wind, windDirection, rain, pressure }) => [formatTime(time), number(temp, 1), number(humidity), number(wind, 1), number(windDirection), number(rain, 1), number(pressure, 1)])} />
    </> : <p className="detail-empty">暂无斗门站整点记录。</p>}
    <details className="source-details"><summary>观测口径与来源</summary>
      <Metadata rows={[["24 小时累计雨量", "中国天气网实况字段，单位 mm"], ["逐时雨量", "截至该观测时刻的前 1 小时累计，单位 mm"],
        ["露点 / 体感 / 紫外线 / 日出日落", "Open-Meteo 斗门格点（22.21° N, 113.30° E）同时次参考值"],
        ["取数时间", formatTime(weather?.fetchedAt, "date")]]} />
      <Source label="中国天气网斗门站" href={stationUrl} />
      {weather?.historySource?.url && <Source label="中央气象台斗门站 · 59487" href={weather.historySource.url} />}
    </details>
  </>;
}

function SoilDetails({ profile, satellite, onReplay }) {
  const latest = profile?.days?.at(-1);
  const days = profile?.days ?? [];
  const [range, setRange] = useState(0);
  const sliced = range > 0 ? days.slice(-range) : days;
  return <>
    {profile && <>
      <div className="range-tabs" role="group" aria-label="剖面时序范围">
        {[15, 30, 60].filter((n) => n < days.length).map((n) => <button key={n} type="button"
          aria-pressed={range === n} onClick={() => setRange(n)}>近 {n} 天</button>)}
        <button type="button" aria-pressed={range === 0} onClick={() => setRange(0)}>全部 {days.length} 天</button>
      </div>
      <SoilProfileChart days={sliced} layers={profile.layers} featured />
      <details className="source-details"><summary>逐日体积含水量 · {sliced.length} 日</summary>
        <ReadingTable head={["日期", ...profile.layers.map(({ depth }) => `${depth} (%)`)]}
          rows={sliced.slice().reverse().map(({ date, moisture }) => [date, ...profile.layers.map(({ id }) => number(moisture[id], 1))])} />
      </details>
    </>}
    <div className="grade-scale grade-scale-detail" aria-label="GB/T 20481-2017 土壤相对湿度分级">
      {soilGradeScale.map(({ id, label, color, text, range }) => <span key={id} style={{ color: text }}><i style={{ background: color }} />{label} {range}</span>)}
    </div>
    {latest && <div className="layer-bars layer-bars-detail">
      {profile.layers.map(({ id, depth, label }) => <div key={id} className="layer-row"
        title={`体积含水量 ${number(latest.moisture[id], 1)}% · 相对湿度 ${number(latest.relative[id])}%`}>
        <span className="layer-name">{label}<small>{depth}</small></span>
        <span className="layer-track"><i style={{
          width: `${Math.min(100, (latest.relative[id] / 125) * 100)}%`,
          background: gradeOf(latest.grade[id])?.color,
        }} /></span>
        <strong className="layer-value">{number(latest.moisture[id], 1)}<small>%</small></strong>
        <GradeBadge grade={latest.grade[id]} />
      </div>)}
    </div>}
    {profile && <Metadata rows={[
      ["最新日值", `${latest.date}`],
      ["各层相对湿度", profile.layers.map(({ id, label }) => `${label} ${number(latest.relative[id])}%`).join(" · ")],
      ["数据状态", wave(profile)],
      ["时序窗口", `近 ${profile.window.days} 天`],
      ["数据产品", `${profile.source.name} · 0.1° 网格`],
      ["观测口径", "土壤体积含水量，逐时再分析按日平均"],
      ["田间持水量", `${profile.fieldCapacity.value.toFixed(2)} m³/m³ · ${profile.fieldCapacity.note}`],
      ["分级依据", `${profile.standard.name} · ${profile.fieldCapacity.formula}`],
      ["数据来源", <Source label={profile.source.name} href={profile.source.url} />],
    ]} />}
    <h3 className="detail-heading">卫星遥感表层墒情</h3>
    <SoilChart series={satellite?.points} featured daily />
    {satellite?.points?.length > 0 && <Metadata rows={[
      ["最新日值", `${satellite.points.at(-1).time.slice(0, 10)} · ${number(satellite.points.at(-1).moisture, 1)}%`],
      ["时序", `近 ${satellite.points.length} 天`],
      ["最近核对", checkedText(satellite)],
      ["数据产品", `${satellite.product} · ${satellite.resolution}`],
      ["观测口径", `${satellite.depth} · 体积含水量（%）`],
      ["数据来源", <Source label={satellite.source.name} href={satellite.source.url} />],
    ]} />}
    <h3 className="detail-heading">珠三角剖面实测参考</h3>
    <p>{soilReference.site} · {soilReference.dates} · 相对含水量</p>
    <Metadata rows={soilReference.layers.map(([depth, amount]) => [depth, `${amount}%`])} />
    <Source label="中山市农业农村局墒情记录" href={soilReference.url} />
    <button type="button" className="text-button detail-action" onClick={onReplay} title="意大利帕尔马番茄灌溉试验公开数据集，仅作方法参考">外部参考：番茄田灌溉与墒情实测曲线 <ArrowSquareOut size={15} /></button>
  </>;
}

function AgroDetails({ agro, weather, onReplay, onWater, onCrops }) {
  const balance = agro?.waterBalance;
  const balances = agro?.balances ?? [];
  const comparison = agro?.comparison;
  const deltaText = (pct, unit) => pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%${unit ?? ""}`;
  return <>
    <AgroChart daily={agro?.daily} lastYear={agro?.lastYearDaily} featured />
    <Metadata rows={[
      ["数据截至", agro?.dataThrough ?? "—"],
      ["最新参考蒸散", agro?.et0 ? `${number(agro.et0.latest, 2)} mm/d` : "—"],
      ["近 30 日均值", `${number(agro?.et0?.mean30, 2)} mm/d`],
      ["数据状态", wave(agro)],
      ["输入数据", <Source label={agro?.source?.name ?? "NASA POWER"} href={agro?.source?.url ?? "https://power.larc.nasa.gov/"} />],
      ["计算方法", agro?.method?.et0 ?? "FAO-56 Penman-Monteith"],
      ["作物系数", agro?.method?.kc ?? "FAO-56 表 12"],
      ["有效降雨", agro?.method?.effectiveRain ?? "降雨 × 0.8"],
      ["辐射数据", agro?.method?.radiation ?? "—"],
    ]} />
    {comparison && <h3 className="detail-heading">近 30 日同期对比</h3>}
    {comparison && <Metadata rows={[
      ["降雨量", `${number(comparison.precip, 1)} mm（去年 ${number(comparison.precipLastYear, 1)} mm · ${deltaText(comparison.precipDeltaPct)}）`],
      ["参考蒸散均值", `${number(comparison.et0Mean, 2)} mm/d（去年 ${number(comparison.et0MeanLastYear, 2)} mm/d · ${deltaText(comparison.et0DeltaPct)}）`],
      ["对比天数", `${comparison.from?.slice(5).replace("-", "/")}–${comparison.to?.slice(5).replace("-", "/")} · 共 ${comparison.pairs} 天`],
    ]} />}
    {agro?.monthly?.length ? <>
      <h3 className="detail-heading">月度气候统计（近 {agro.monthly.length} 个月）</h3>
      <MonthlyChart monthly={agro.monthly} />
      <p className="muted">当月为进行中的统计。</p>
    </> : null}
    <h3 className="detail-heading">在田作物水分平衡{balance?.from && `（近 ${balance.days} 日，${spanLabel(balance)}）`}</h3>
    {balances.length ? <ReadingTable head={["作物", "生育期", "作物系数", "降雨 (mm)", "有效降雨 (mm)", "需水量 (mm)", "灌溉参考 (mm)"]}
      rows={balances.map((item) => [
        item.name, item.stage, number(item.kc, 2), number(item.precip, 1), number(item.effectiveRain, 1), number(item.etc, 1),
        item.irrigable ? number(item.irrigationRefMm, 1) : "—",
      ])} /> : <p className="detail-empty">暂无可用的水分平衡数据。</p>}
    <p className="muted">灌溉参考按本月在田作物中需水最多的一茬计算{balance ? `，当前为${balance.name}（${balance.stage}）` : ""}。</p>
    <IrrigationPlanner agro={agro} weather={weather} />
    {agro?.risks?.length ? <>
      <h3 className="detail-heading">农气灾害事件（近 {agro.window.days} 日）</h3>
      <div className="agro-risk-list">{agro.risks.map((risk, index) => <div key={index} className="agro-risk-item">
        <strong>{risk.type} · {risk.level}</strong>
        <small>{risk.window}</small>
        <span>{risk.detail}</span>
        <small>{risk.standard}</small>
      </div>)}</div>
    </> : <p className="detail-empty">{agro?.risks ? `近 ${agro.window.days} 日无达到国标阈值的农气灾害事件。` : "暂无农气灾害事件记录。"}</p>}
    <div className="detail-links">
      <button type="button" className="text-button" onClick={onCrops}>作物农事决策 <CaretRight size={15} /></button>
      <button type="button" className="text-button" onClick={onWater}>区域水环境 <CaretRight size={15} /></button>
      <button type="button" className="text-button" onClick={onReplay} title="意大利帕尔马番茄灌溉试验公开数据集，仅作方法参考">外部参考：番茄田灌溉试验回放 <ArrowSquareOut size={15} /></button>
    </div>
    <details className="source-details"><summary>计算说明</summary>
      <p>{agro?.method?.irrigation}</p>
      <Source label="FAO-56 灌溉与排水论文（方法原文）" href="https://www.fao.org/4/x0490e/x0490e00.htm" />
    </details>
  </>;
}

// 作物农事决策详情：生育期农事、喷药作业窗口、病虫气象适宜度、冬种积温。
function CropsDetails({ crops, onLamp, onAgro }) {
  const { stages = [], pests = [], pestWindow, gdd, method } = crops ?? {};
  const sprayWindows = upcomingSpray(crops);
  const month = new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, month: "long" }).format(new Date());
  return <>
    <h3 className="detail-heading">当季作物与农事要点（{month}）</h3>
    {stages.length ? <ReadingTable head={["作物", "生育期", "作物系数", "农事要点"]}
      rows={stages.map(({ id, name, stage, kc, focus }) => [
        <strong key={id}>{name}</strong>, stage, kc == null ? "—" : number(kc, 2), focus,
      ])} />
      : <p className="detail-empty">作物决策数据获取中。</p>}
    <button type="button" className="inline-link" onClick={onAgro}>在田作物水分平衡 <CaretRight size={13} /></button>
    <h3 className="detail-heading">喷药作业窗口 · 未来 48 小时</h3>
    {sprayWindows.length ? <ReadingTable head={["时段", "时长", "气温范围", "最大风速 (km/h)"]}
      rows={sprayWindows.map(({ start, end, hours, tempRange, windPeak }) => [
        `${clockLabel(start)} – ${end.slice(11, 16)}`, `${hours} 小时`, tempRange, number(windPeak, 1),
      ])} />
      : <p className="detail-empty">未来 48 小时昼间无连续 2 小时以上的适宜时段，待风速回落、雨停后再安排。</p>}
    <h3 className="detail-heading">病虫气象适宜度</h3>
    <div className="agro-risk-list">{pests.map((pest) => <div key={pest.id} className="agro-risk-item">
      <strong>{pest.pest} · 适宜度{pest.level ?? "—"}{!pest.seasonal ? "（非敏感期）" : ""}</strong>
      <small>寄主：{pest.host}</small>
      <span>适宜条件：{pest.condition}</span>
      <span>近 7 日（{spanLabel(pestWindow)}）{pest.recentPct ?? "—"}% 日数适宜 · 未来 48 小时 {pest.forecastPct ?? "—"}% 时数适宜</span>
      <small>{pest.action}</small>
    </div>)}</div>
    {gdd && <>
      <h3 className="detail-heading">冬种蔬菜有效积温</h3>
      <Metadata rows={[
        ["累计有效积温", `${number(gdd.cumulative)} ℃·d（自 ${gdd.since} 起）`],
        ["累计天数", `${gdd.days} 天 · 日均 ${number(gdd.dailyMean, 1)} ℃·d`],
      ]} />
    </>}
    <div className="detail-links">
      <button type="button" className="text-button" onClick={onLamp}>虫情灯诱时序 <CaretRight size={15} /></button>
    </div>
    <details className="source-details"><summary>计算说明</summary>
      <p>{method?.calendar}</p>
      <p>{method?.spray}</p>
      <p>{method?.pest}</p>
      <p>{method?.gdd}</p>
      <Source label="Open-Meteo 逐时预报" href="https://open-meteo.com/en/docs" />
      <Source label="NASA POWER 农业气象日值" href="https://power.larc.nasa.gov/" />
    </details>
  </>;
}

const steps = [
  ["降雨前", "检查田内外排水沟和低洼地块出水口，准备排水设备；设施果蔬区检查棚膜、支架与固定件。"],
  ["风雨期间", "跟进对应镇街的气象预警。人员避开积水区、陡坡、沟渠及受损棚室。"],
  ["天气好转后", "确认现场安全后检查积水与田埂，根据受影响范围安排排涝，留存照片和处置时间。"],
];

function ActionSteps() {
  return <>
    <h3 className="detail-heading">处置建议</h3>
    <ol className="action-steps">{steps.map(([label, text]) => <li key={label}><strong>{label}</strong><p>{text}</p></li>)}</ol>
    <Source label="农业农村部 · 台风暴雨蔬菜管理指导" href={guidanceUrl} />
  </>;
}

function AlertDetail({ alert, archived = false }) {
  return <>
    <div className="detail-alert-heading"><LevelBadge alert={alert} /><strong>{alert.title}</strong></div>
    <Metadata rows={[
      ["发布机构", alert.issuer ?? "见预警原文"], ["影响范围", alert.area ?? "见预警原文"],
      ["发布时间", formatTime(alert.startsAt, "date")],
      ...(archived ? [["记录状态", "历史发布记录"]] : [["有效至", alert.endsAt ? formatTime(alert.endsAt, "date") : "以发布机构更新为准"]]),
    ]} />
    {alert.description && <p>{alert.description}</p>}
    {alert.instruction && <p>{alert.instruction}</p>}
    {alert.url && <Source label="官方预警原文" href={alert.url} />}
    <ActionSteps />
  </>;
}

function AlertArchive({ color, history, onAlert, onStorm }) {
  const [selected, setSelected] = useState(color ?? "all");
  const items = officialArchive.filter((alert) => selected === "all" || alert.color === selected);
  // 服务器自动记下的预警：来过又解除的也在里面，按等级筛选时一并筛。
  const recorded = (history?.alerts ?? []).filter((alert) => selected === "all" || alert.color === selected);
  return <>
    {recorded.length > 0 && <>
      <h3 className="detail-heading">近期预警记录</h3>
      <p className="muted">服务器每 5 分钟核对一次官方预警，生效过的自动记入，保留 90 天。</p>
      <div className="archive-list">{recorded.map((alert) => <div key={alert.id}>
        <AlertRow alert={alert} onClick={() => onAlert(alert, !alert.endsAt || Date.parse(alert.endsAt) <= Date.now())} />
        <p>{formatTime(alert.startsAt)}{alert.endsAt ? ` 至 ${formatTime(alert.endsAt)}` : ""}</p>
      </div>)}</div>
    </>}
    {recorded.length > 0 && <h3 className="detail-heading">典型预警档案</h3>}
    <p>珠海市及斗门区发布记录，按信号等级与影响区域查阅。</p>
    <div className="archive-filter" role="group" aria-label="按预警等级筛选">
      <button type="button" aria-pressed={selected === "all"} onClick={() => setSelected("all")}>全部</button>
      {["blue", "yellow", "orange", "red"].map((tone) => <button type="button" key={tone} aria-pressed={selected === tone}
        onClick={() => setSelected(tone)}>{levels[tone]}</button>)}
    </div>
    <div className="archive-list">{items.map((alert) => <div key={alert.id}>
      <AlertRow alert={alert} onClick={() => onAlert(alert, true)} />
      <p>{formatTime(alert.startsAt, "date")}</p>
    </div>)}</div>
    {!items.length && <p className="detail-empty">本档案暂无该等级记录。</p>}
    <button type="button" className="row-button archive-link" onClick={onStorm}><span>台风「桦加沙」农事处置案例</span><CaretRight size={16} /></button>
  </>;
}

// 以国标暴雨事件为锚，将官方预警档案、NASA POWER 日值与 ERA5 再分析在同一日期对齐。
function crossMatches(agro, archive) {
  const matches = [];
  for (const risk of agro?.risks ?? []) {
    if (risk.type !== "暴雨") continue;
    const alerts = archive.filter(({ startsAt }) => startsAt.slice(0, 10) === risk.window);
    if (alerts.length) matches.push({ risk, alerts });
  }
  return matches;
}

function CrossValidation({ agro, profile, onAlert }) {
  const matches = crossMatches(agro, officialArchive);
  if (!matches.length) return null;
  return <>
    <h3 className="detail-heading">历史强降雨过程</h3>
    {matches.map(({ risk, alerts }) => {
      const soilDay = profile?.days?.find(({ date }) => date >= risk.window);
      const surface = soilDay ? gradeOf(soilDay.grade.surface) : null;
      return <div className="cross-card" key={risk.window}>
        <div className="cross-date">{risk.window} · {risk.level}</div>
        {alerts.map((alert) => <button type="button" className="cross-row" key={alert.id} onClick={() => onAlert(alert, true)}>
          <LevelBadge alert={alert} />
          <span><strong>{alert.title}</strong> · {alert.area}</span>
          <small>{formatTime(alert.startsAt, "date")} 发布</small>
        </button>)}
        <div className="cross-row">
          <span className="level-badge level-other">气象日值</span>
          <span>日雨量 {risk.detail.replace("日雨量 ", "")}（{risk.standard}）</span>
        </div>
        {surface && <div className="cross-row">
          <span className="level-badge level-other">卫星再分析</span>
          <span>表层相对湿度 {number(soilDay.relative.surface)}% · {surface.label}</span>
        </div>}
      </div>;
    })}
  </>;
}

function RiskDetails({ risk, alerts, agro, profile, onAlert, onArchive, onRainfall }) {
  return <>
    <h3 className="detail-heading">生效预警</h3>
    <p>{alerts?.status !== "current" ? "气象预警暂不可查询，请以珠海市官方发布为准。" :
      alerts.alerts.length === 0 ? "珠海市及斗门区当前无生效气象预警。" : `珠海市及斗门区当前有 ${alerts.alerts.length} 条生效预警。`}</p>
    {alerts?.alerts?.map((alert) => <AlertRow alert={alert} key={alert.id} pulse onClick={() => onAlert(alert)} />)}
    {alerts?.fetchedAt && <p className="muted">更新于 {formatTime(alerts.fetchedAt)}</p>}
    {alerts?.source && <Source label={alerts.source.name} href={alerts.source.url} />}
    <Source label="珠海市官方预警公告" href={alertUrl} />
    <button type="button" className="row-button archive-link" onClick={() => onArchive("all")}><span>预警档案</span><CaretRight size={16} /></button>
    <h3 className="detail-heading">排水巡查依据</h3>
    <Metadata rows={[
      ["24 小时预报累计雨量", risk.total == null ? "预报样本不足" : `${number(risk.total, 1)} mm${risk.actionable ? "" : "（缓存快照）"}`],
      ["排水提示阈值", "累计雨量 ≥ 50 mm"],
      ["判断", risk.high ? "达到阈值，关注农田排水" : risk.actionable ? "未达到排水提示阈值" : "等待有效预报"],
    ]} />
    <ActionSteps />
    <button type="button" className="case-link" onClick={onRainfall}>
      <CloudRain size={21} /><span><strong>斗门镇特大暴雨 · {rainfallRecord.amount} mm</strong>
        <small>2026-05-20 · 24 小时实测记录</small></span><CaretRight size={16} />
    </button>
    <CrossValidation agro={agro} profile={profile} onAlert={onAlert} />
    <LedgerTable onAlert={onAlert} />
  </>;
}

function PestLampDetails({ crops }) {
  const lamp = crops?.lamp;
  const top = lamp?.species?.[0];
  return <>
    {lamp ? <>
      <div className="detail-metrics">
        <Metric label="近 7 日灯诱合计" value={lamp.total7} unit="头" />
        <Metric label="优势种">{top?.name} <small>{number(top?.last7)} 头</small></Metric>
        <Metric label="峰值夜">{lamp.peakNight?.date?.slice(5).replace("-", "/")} <small>{number(lamp.peakNight?.total)} 头</small></Metric>
        <Metric label="虫种识别率"><strong>{number(lamp.identifyRate, 1)} <small>%</small></strong></Metric>
      </div>
      <p className="muted">统计区间 {lamp.from} 至 {lamp.to}</p>
      <PestChart series={lamp.series} featured />
      <h3 className="detail-heading">种类构成</h3>
      <ReadingTable head={["虫种", "寄主", "近 7 日 (头)", "近 30 日 (头)", "周环比"]}
        rows={lamp.species.map(({ name, host, last7, last30, trend }) => [
          name, host, number(last7), number(last30), trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend}%`,
        ])} />
      <p className="muted">灯诱计数受夜间天气影响会有波动，防治安排应结合田间虫量调查。</p>
    </> : <p className="detail-empty">虫情灯诱时序获取中。</p>}
    <Metadata rows={[
      ["监测对象", "稻田、果园、菜地的主要害虫成虫"],
      ["数据来源", "测报灯夜间自动拍照计数，虫种由图像识别，存疑样本人工复核"],
    ]} />
  </>;
}

function StormDetails() {
  return <>
    <span className="subtle-tag">历史案例 · 2025 年 9 月</span>
    <p className="case-intro">2025 年 9 月，台风「桦加沙」外围风雨影响珠海。</p>
    <Metadata rows={[
      ["风险信号", "台风、大风与强降雨"],
      ["历史依据", "2025 年 9 月 23 日 14:21，中国天气网广东站发布台风动态和风雨预报"],
      ["优先巡查", "低洼果蔬地块、排水沟渠和棚架固定件"],
    ]} />
    <Source label="查看当时的气象发布" href={stormUrl} />
    <ActionSteps />
  </>;
}

function LiveCamera() {
  const video = useRef(null);
  const [state, setState] = useState("正在连接摄像头");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = video.current;
    let stopped = false;
    let player;
    const fail = () => { if (!stopped) setState("视频暂不可用"); };
    const ready = () => { if (!stopped) setState("直播"); };
    element.addEventListener("loadeddata", ready);
    element.addEventListener("error", fail);
    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = cameraUrl;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (stopped) return;
        if (!Hls.isSupported()) { fail(); return; }
        player = new Hls();
        player.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
        player.loadSource(cameraUrl);
        player.attachMedia(element);
      }).catch(fail);
    }
    return () => {
      stopped = true;
      player?.destroy();
      element.removeEventListener("error", fail);
      element.removeEventListener("loadeddata", ready);
      element.removeAttribute("src");
      element.load();
    };
  }, [attempt]);
  return <><video ref={video} controls muted playsInline aria-label="授权农场摄像头直播" />
    <p>{state} {state === "视频暂不可用" && <button type="button" className="text-button"
      onClick={() => { setState("正在连接摄像头"); setAttempt(attempt + 1); }}>重试</button>}</p></>;
}

function FieldDetails({ initial, onImage }) {
  const [selected, setSelected] = useState(fieldImages.find((image) => image.id === initial) ?? fieldImages[0]);
  return <>
    <figure className="detail-photo gallery-main"><img src={selected.file} alt={selected.alt} />
      <figcaption><strong>{selected.title}</strong><span>{selected.context}</span>
        <button type="button" className="text-button" onClick={() => onImage(selected)}>查看大图 <CaretRight size={14} /></button></figcaption></figure>
    <div className="gallery-grid" aria-label="影像列表">
      {fieldImages.map((image) => <button key={image.id} type="button" aria-pressed={image.id === selected.id} onClick={() => setSelected(image)}>
        <img src={image.file} alt="" loading="lazy" /><span>{image.title}</span>
      </button>)}
    </div>
    {cameraUrl ? <LiveCamera /> : <p className="empty-device"><VideoCamera size={20} /> 现场摄像头待接入</p>}
  </>;
}

function ImageDetails({ image }) {
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState(1.5);
  return <figure className="detail-photo full-image">
    <div className="photo-tools">
      <figcaption>{image.context}</figcaption>
      <div role="group" aria-label="照片缩放">
        <button type="button" className="icon-button" aria-label="缩小照片" disabled={scale <= 1} onClick={() => setScale(scale - .5)}><MagnifyingGlassMinus size={18} /></button>
        <button type="button" className="icon-button" aria-label="恢复照片原始视图" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</button>
        <button type="button" className="icon-button" aria-label="放大照片" disabled={scale >= 3} onClick={() => setScale(scale + .5)}><MagnifyingGlassPlus size={18} /></button>
      </div>
    </div>
    <div className="photo-viewport" tabIndex={0} aria-label="照片浏览区，可滚动查看放大区域">
      <img src={image.file} alt={image.alt} style={{ "--photo-scale": scale, "--photo-ratio": ratio }}
        onLoad={({ currentTarget }) => setRatio(currentTarget.naturalWidth / currentTarget.naturalHeight)} />
    </div>
  </figure>;
}

function ReplayDetails() {
  const [replay, setReplay] = useState(null);
  const [failed, setFailed] = useState(false);
  const [date, setDate] = useState("");
  const [line, setLine] = useState("1");
  useEffect(() => {
    const controller = new AbortController();
    getJson("/data/parma-replay.json", controller.signal)
      .then((data) => { setReplay(data); setDate(data.defaultDate); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  if (!replay) return <p className="detail-empty" role="status">{failed ? "暂时无法打开本地实测回放。" : "正在读取实测记录…"}</p>;
  const series = replay.days[date]?.[line];
  const dates = Object.keys(replay.days);
  const start = Date.parse(`${date}T00:00:00+02:00`);
  const end = start + 86_400_000;
  return <>
    <div className="replay-toolbar">
      <div><strong>{replay.location}</strong><small> · 历史实测 · 意大利当地时间</small></div>
      <label>日期 <select value={date} onChange={(event) => setDate(event.target.value)}>
        {dates.map((day) => <option key={day} value={day}>{day}</option>)}
      </select></label>
      <label>种植行 <select value={line} onChange={(event) => setLine(event.target.value)}>
        {[1, 2, 3].map((row) => <option key={row} value={row}>第 {row} 行</option>)}
      </select></label>
    </div>
    <div className="replay-data">
      <h3>20 cm 土壤湿度 <small>%RH</small></h3>
      <ReplayChart data={series?.soil} from={start} to={end} />
      <h3>水表原始读数 <small>原始列</small></h3>
      <ReplayChart data={series?.water} from={start} to={end} water />
    </div>
    <p className="muted">当天采样 · 墒情 {series?.soil?.length ?? 0} 条 · 水表 {series?.water?.length ?? 0} 条
      {series?.soil?.length ? ` · 首条墒情记录 ${replayTime(series.soil[0][0])}` : ""}</p>
    <details className="source-details"><summary>数据来源与水表口径</summary>
      <p>{replay.source.credit} · {replay.source.license}</p>
      <p>{replay.waterUnitNote ?? "保留数据集中水表的原始列值。"}</p>
      <Source label="原始数据集" href={replay.source.url} />
      {replay.waterUnitReference && <Source label="水表技术手册" href={replay.waterUnitReference} />}
    </details>
  </>;
}

// 四情监测状态条：墒情 / 苗情 / 虫情 / 灾情。
function FourQuads({ profile, ndvi, alerts, crops, onOpen }) {
  const latest = profile?.days?.at(-1);
  const scenes = ndvi?.scenes ?? [];
  const last = scenes.at(-1);
  const prev = scenes.at(-2);
  const trend = Number.isFinite(last?.ndvi?.overall) && Number.isFinite(prev?.ndvi?.overall)
    ? last.ndvi.overall - prev.ndvi.overall : null;
  const TrendIcon = trend == null ? null : trend >= 0 ? ChartLineUp : ChartLineDown;
  const official = alerts?.status === "current" ? alerts.alerts : null;
  const lampTop = crops?.lamp?.species?.[0];
  const density = lampTop ? (lampTop.last7 >= 350 ? "高" : lampTop.last7 >= 120 ? "中" : "低") : null;
  const disaster = !alerts ? { text: "查询中" }
    : official == null ? { text: "暂不可查" }
    : official.length ? { text: `${official.length} 条生效`, tone: "trend-down" }
      : { text: "无生效", tone: "trend-up" };
  return <div className="four-quads" aria-label="四情监测">
    <button type="button" onClick={() => onOpen("soil")} title="查看土壤墒情">
      <span>墒情</span>
      <small>{latest ? gradeOf(latest.grade.root)?.label ?? "—" : pendingText(profile)}</small>
    </button>
    <button type="button" onClick={() => onOpen("ndvi")} title="查看卫星苗情时序">
      <span>苗情</span>
      {last ? <small>{number(last.ndvi?.overall, 2)}{TrendIcon && <TrendIcon size={13} className={trend >= 0 ? "trend-up" : "trend-down"} />}</small>
        : <small>{ndvi?.status === "unavailable" ? "暂不可用" : "待更新"}</small>}
    </button>
    <button type="button" className={density === "高" ? "quad-alert" : ""} onClick={() => onOpen("pest")} title="查看虫情灯诱时序与防治窗口">
      <span>虫情</span>
      <small>{lampTop ? `${lampTop.name}·${density}` : crops?.status === "unavailable" ? "暂不可用" : crops ? "识别中" : "获取中"}</small>
    </button>
    <button type="button" onClick={() => onOpen("risk")} title="查看气象预警">
      <span>灾情</span>
      <small className={disaster.tone ?? ""}>{disaster.text}</small>
    </button>
  </div>;
}

// 影像编号末段是 Sentinel-2 的过境时刻（世界时），换算成北京时间显示。
function sensingTime(tile) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(tile ?? "");
  if (!match) return "—";
  const beijing = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) + 8 * 3600_000);
  return `${beijing.getUTCMonth() + 1}-${String(beijing.getUTCDate()).padStart(2, "0")} ${String(beijing.getUTCHours()).padStart(2, "0")}:${String(beijing.getUTCMinutes()).padStart(2, "0")}`;
}

function NdviDetails({ ndvi }) {
  const scenes = ndvi?.scenes ?? [];
  const last = scenes.at(-1);
  const skipped = (ndvi?.skipped ?? []).filter(({ date }) => !last || date > last.date);
  return <>
    <NdviChart scenes={scenes} featured />
    {last && <Metadata rows={[
      ["最新影像", `${last.date} · 云量 ${number(last.cloudCover)}% · 北京时间 ${sensingTime(last.tile)} 过境`],
      ["植被指数", `大濠冲 ${number(last.ndvi?.dahao, 3)} · 小濠冲 ${number(last.ndvi?.xiaohao, 3)} · 片区 ${number(last.ndvi?.overall, 3)}`],
      ["时序", `${scenes.length} 景（${scenes[0].date} 至 ${last.date}）`],
      ["此后未采用", skipped.length ? skipped.map(({ date, cloudCover }) => `${date.slice(5).replace("-", "/")} 云量 ${number(cloudCover)}%`).join(" · ") : "无"],
      ["最近核对", checkedText(ndvi)],
      ["采用条件", "只采用云量低于 30% 的影像，阴天多的时段不会有新影像"],
      ["观测窗口", "两村各 640 m × 640 m，片区 2.6 km × 2.6 km"],
      ["计算方法", ndvi.source.method],
      ["数据来源", <Source label={ndvi.source.name} href={ndvi.source.url} />],
    ]} />}
  </>;
}

function VillageDetails({ village, onField }) {
  return <>
    <h3 className="detail-heading">村情简介</h3>
    <p>{village.summary}</p>
    <ul className="village-points">
      {(villageHighlights[village.id] ?? []).map((point) => <li key={point}>{point}</li>)}
    </ul>
    <Metadata rows={[["调研内容", village.label], ["点位类别", "村级调研参考点"], ["资料来源", village.source], ["田间监测站", "列入基地部署计划"]]} />
    <button type="button" className="primary-button" onClick={() => onField(village.id === "dahao" ? "planning" : "tenure")}>
      {village.id === "dahao" ? "查看空间布局专题图" : "查看土名地界划分图"}
    </button>
    {village.id === "dahao" && <button type="button" className="text-button detail-action" onClick={() => onField("aerial")}>查看现场调研照 <CaretRight size={14} /></button>}
  </>;
}

function CropCalendar() {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: shanghai, month: "numeric" }).format(new Date()));
  const tone = (stage) => {
    for (const [key, color] of Object.entries(cropStageTones)) {
      if (stage.startsWith(key)) return color;
    }
    return "#7aa668";
  };
  const tint = (hex, alpha) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
  return <section className="panel crop-calendar-panel">
    <PanelTitle title="作物农事日历" />
    <div className="calendar-scroll" tabIndex={0} aria-label="作物农事日历，可横向滚动">
      <table className="calendar-table">
        <thead><tr><th scope="col" className="cal-crop">作物</th>
          {Array.from({ length: 12 }, (_, index) => <th scope="col" key={index} className={index + 1 === month ? "cal-now" : ""}>{index + 1}月</th>)}
        </tr></thead>
        <tbody>{cropCalendar.crops.map(({ name, months }) => <tr key={name}>
          <th scope="row" className="cal-crop">{name}</th>
          {months.map((stage, index) => <td key={index} className={index + 1 === month ? "cal-now" : ""}
            style={stage ? { background: tint(tone(stage), .19) } : undefined}>{stage ?? "—"}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="crop-note">{cropCalendar.note}。</p>
    <p className="crop-note">2026 年种粮扶持插秧期：早造 3 月 1 日至 4 月 20 日，晚造 7 月 10 日至 8 月 20 日。</p>
    <Source label="珠海市农业农村局 · 种粮扶持通知" href="https://www.zhuhai.gov.cn/zw/fggw/ztfl/nylysl/content/post_3857521.html" />
  </section>;
}

// 页面下方的「区域水环境」摘要：列出最新一期公开报告里各断面的水质，点「详情」看历次报告。
function WaterSummary({ onWater }) {
  const water = useReading("/api/water-quality", 1_800_000, "/data/water-quality-snapshot.json");
  const sections = new Map((water?.sections ?? []).map((section) => [section.id, section]));
  const report = water?.reports?.[0];
  const index = report?.kind === "index";
  return <section className="panel production-notes">
    <PanelTitle title="区域水环境" action="详情" onClick={onWater} />
    {!hasData(water) ? <p className="detail-empty">{pendingText(water, "水环境数据")}</p> : !report ? <p className="detail-empty">暂无公开报告</p> : <>
      <p className="panel-status">{report.month} · {report.publishedAt} 发布 · {report.measurements.length} 个断面</p>
      <ReadingTable head={index ? ["水体", "监测断面", "水质指数"] : ["水体", "监测断面", "类别", "目标", "达标情况"]}
        rows={report.measurements.map(({ sectionId, grade, target, compliant, index: value }) => {
          const section = sections.get(sectionId);
          return [section?.river ?? "—", section?.name ?? "—",
            ...(index ? [number(value, 4)] : [grade ?? "—", target ?? "—", compliant == null ? "—" : compliant ? "达标" : "未达标"])];
        })} />
    </>}
  </section>;
}

function ProductionRecords({ onField, onRisk, onWater, operations }) {
  // 例行巡田每天都有，只在统计里计数，不逐条列出。
  const patrols = operations?.byType?.巡田 ?? 0;
  const ops = (operations?.records ?? []).filter(({ type }) => type !== "巡田");
  const stats = operations?.byType ?? {};
  return <section id="production" className="production-records" aria-label="档案内容">
    <div className="record-head">
      <button type="button" className="text-button" onClick={onWater}>区域水环境 <CaretRight size={16} /></button>
      <button type="button" className="text-button" onClick={onRisk}>查看农事处置 <CaretRight size={16} /></button>
    </div>
    <CropCalendar />
    {operations && <section className="panel operations-panel">
      <PanelTitle title={`农事作业台账 · ${operations.month}`} />
      <div className="ops-summary">
        <span>本月专项作业 <strong>{operations.monthTotal - patrols}</strong> 次</span>
        <em>例行巡田 {patrols} 次</em>
        {Object.entries(stats).filter(([type]) => type !== "巡田").slice(0, 6).map(([type, count]) => <em key={type}>{type} {count}</em>)}
      </div>
      {ops.length ? <ReadingTable head={["日期", "时间", "作业类型", "作物 / 区域", "作业内容与面积"]}
        rows={ops.slice(0, 8).map(({ date, time, type, crop, scope, area, note }) => [
          date.slice(5).replace("-", "/"), time, type, `${crop} · ${scope}`, area ? `${note}（${area} 亩）` : note,
        ])} /> : <p className="detail-empty">本月暂无专项作业记录。</p>}
      {operations.asOf && <p className="crop-note">记录截至 {monthDay(operations.asOf)}</p>}
    </section>}
    <div className="production-grid">
      <section className="panel production-stats">
        <PanelTitle title="2026 年前三季度农业统计" />
        <OutputChart results={quarterlyAgriculture.results} />
        <Source label="斗门区统计局 · 2026-11-03" href={quarterlyAgriculture.url} />
        <hr className="detail-divider" />
        <PanelTitle title="2025 年斗门农业统计" />
        <div className="statistics">{doumenStatistics.results.map(({ label, value, unit, growth }) => <div key={label}>
          <span>{label}</span><strong>{value} <small>{unit}</small></strong>{growth && <small>同比 {growth}</small>}
        </div>)}</div>
        <YieldChart items={doumenStatistics.results.filter(({ label }) => label.includes("产量")).map(({ label, value }) => ({ label: label.replace("产量", ""), value: Number(value) }))} unit=" 万吨" />
        <Source label={doumenStatistics.source} href={doumenStatistics.url} />
      </section>
      <div className="production-stack">
        <section className="panel production-notes">
          <PanelTitle title="农业管护资料" />
          {localReferences.map(({ title, context, summary, source, url }) => <article key={title}>
            <div><h3>{title}</h3><small>{context}</small></div><p>{summary}</p><Source label={source} href={url} />
          </article>)}
        </section>
        <WaterSummary onWater={onWater} />
      </div>
      <section className="panel production-imagery">
        <PanelTitle title="重点影像" action="影像档案" onClick={() => onField("aerial")} />
        {fieldImages.filter(({ id }) => ["ground", "planning", "tenure", "xiaohao", "roads-aerial", "tower-pond"].includes(id)).map((image) => <button type="button" onClick={() => onField(image.id)} key={image.id}>
          <img src={image.file} alt="" loading="lazy" /><span><strong>{image.title}</strong><small>{image.context}</small></span><CaretRight size={16} />
        </button>)}
      </section>
    </div>
  </section>;
}

function WaterDetails() {
  const water = useReading("/api/water-quality", 1_800_000, "/data/water-quality-snapshot.json");
  const [kind, setKind] = useState("grade");
  const [month, setMonth] = useState("");
  const reports = water?.reports?.filter((report) => report.kind === kind) ?? [];
  const report = reports.find((entry) => entry.month === month) ?? reports[0];
  if (!water?.sections) return <p role="status">{water?.status === "unavailable" ? "区域水环境档案暂不可用。" : "正在读取区域水环境档案…"}</p>;
  const sections = new Map(water.sections.map((section) => [section.id, section]));
  const index = kind === "index";
  const rows = (report?.measurements ?? []).map(({ sectionId, grade, target, compliant, pollutants, index: value }) => {
    const section = sections.get(sectionId);
    return [section?.river ?? "—", section?.name ?? "—", ...(index ? [number(value, 4)] : [grade ?? "—", target ?? "—",
      compliant == null ? "—" : compliant ? "达标" : "未达标", pollutants ?? "—"])];
  });
  return <>
    <div className="forecast-toolbar">
      <div className="range-tabs" role="group" aria-label="水质指标">
        <button type="button" aria-pressed={!index} onClick={() => { setKind("grade"); setMonth(""); }}>水质类别</button>
        <button type="button" aria-pressed={index} onClick={() => { setKind("index"); setMonth(""); }}>断面水质指数</button>
      </div>
      {report && <label className="detail-select">报告月份 <select value={report.month} onChange={(event) => setMonth(event.target.value)}>
        {reports.map((entry) => <option key={entry.month} value={entry.month}>{entry.month}</option>)}
      </select></label>}
    </div>
    <p className="muted">{report ? `${report.month} · ${rows.length} 个公开断面 · ${report.publishedAt} 发布 · 最近核对 ${formatTime(water.checkedAt, "date")}` : "暂无该类报告"}</p>
    {rows.length > 0 && <ReadingTable head={index ? ["水体", "监测断面", "水质指数"] : ["水体", "监测断面", "类别", "目标", "达标情况", "主要污染指标"]} rows={rows} />}
    <p className="muted">公开记录按河道监测断面发布。灌溉取水水质以对应取水口检测为准。</p>
    {report && <details className="source-details"><summary>报告来源</summary><Source label={water.source.name} href={report.url} /></details>}
  </>;
}

function ReportTable({ head, rows }) {
  return <table className="report-table">
    <thead><tr>{head.map((cell, index) => <th scope="col" key={index}>{cell}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody>
  </table>;
}

function ReadingTable({ head, rows }) {
  return <div className="reading-table"><ReportTable head={head} rows={rows} /></div>;
}

function DailyReport({ observations, profile, agro, alerts, risk, crops, printing = false }) {
  const current = observations?.current;
  const latest = profile?.days?.at(-1);
  const balance = agro?.waterBalance;
  const balances = (agro?.balances ?? []).filter(({ irrigable }) => irrigable);
  const official = alerts?.alerts ?? [];
  const irrigate = balance != null && balance.irrigationRefMm > 0;
  const sprayWindows = upcomingSpray(crops);
  const spray = sprayWindows[0];
  const term = solarTerm();
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, dateStyle: "full" }).format(new Date());
  const layerRow = ({ id, depth, label }) => latest ? [
    `${label} ${depth}`,
    `${number(latest.moisture[id], 1)}%`,
    `${number(latest.relative[id])}%`,
    gradeOf(latest.grade[id])?.label ?? "—",
  ] : null;
  return <article className="report-sheet">
      <header className="report-head">
        {printing && <h2>斗门区农情日报</h2>}
        <p><strong>珠海市斗门区</strong> · {date} · {term.name}</p>
        {current?.time && <p>斗门站观测时间 {formatTime(current.time)}{observations.status === "cached" ? " · 最近记录" : ""}</p>}
        <p>数据截至：农业气象日值 {agro?.dataThrough ?? "—"} · 土壤墒情 {latest?.date ?? "—"}</p>
      </header>

      <div className="report-sections">
      <section className="report-section">
        <h3>一、气象实况与预报</h3>
        <ReportTable head={["项目", "数值", "项目", "数值"]} rows={[
          ["气温", `${number(current?.temp, 1)} °C`, "相对湿度", `${number(current?.humidity)} %`],
          ["风速", `${number(current?.wind, 1)} km/h`, "气压", `${number(current?.pressure)} hPa`],
          ["过去 24 小时雨量", `${number(current?.rain, 1)} mm`, "未来 24 小时累计雨量", risk.total == null ? "样本不足" : `${number(risk.total, 1)} mm`],
        ]} />
        <p className="report-note">实况来自中国天气网斗门站（101280702）；预报来自 Open-Meteo 斗门参考点（22.21° N, 113.30° E）。
          {!risk.actionable ? "当前无可用于触发排水提示的完整预报。" : risk.high ? "未来 24 小时累计雨量达到排水提示阈值，需关注农田排水。" : "未来 24 小时未达排水提示阈值（50 mm）。"}</p>
      </section>

      <section className="report-section">
        <h3>二、土壤墒情与分级</h3>
        {latest ? <ReportTable head={["土层", "体积含水量", "相对湿度", "等级"]} rows={profile.layers.map(layerRow)} />
          : <p>剖面数据暂不可用。</p>}
        <p className="report-note">ERA5-Land 再分析日值（{latest?.date ?? "—"}，约 5 天滞后）。分级依据 GB/T 20481-2017《气象干旱等级》：
          相对湿度 R = 体积含水量 ÷ 田间持水量 × 100%（田间持水量 0.30 m³/m³，FAO-56 表 19）。</p>
      </section>

      <section className="report-section">
        <h3>三、蒸散与灌溉决策</h3>
        <ReportTable head={["项目", "数值"]} rows={[
          [`参考蒸散量（截至 ${agro?.et0?.latestDate ?? "—"}）`, `${number(agro?.et0?.latest, 2)} mm/d`],
          ["近 30 日参考蒸散均值", `${number(agro?.et0?.mean30, 2)} mm/d`],
          [`近 10 日降雨 / 有效降雨（${spanLabel(balance)}）`, `${number(balance?.precip, 1)} mm / ${number(balance?.effectiveRain, 1)} mm`],
          [`近 10 日作物需水量（${balance?.name ?? "—"} · ${balance?.stage ?? ""}）`, `${number(balance?.etc, 1)} mm`],
          ["灌溉参考", !balance ? "本月无区域灌溉参考作物" : irrigate ? `建议灌溉 ${number(balance.irrigationRefMm, 1)} mm ≈ ${number(balance.irrigationRefM3PerMu, 1)} m³/亩` : "水分盈余，暂无需灌溉"],
        ]} />
        <p className="report-note">输入为 NASA POWER 农业气象日值（截至 {agro?.dataThrough ?? "—"}），参考蒸散量按 FAO-56 Penman-Monteith 计算，有效降雨按 0.8 计；作物系数按农事日历取当月在田作物。</p>
        {balances.length > 0 && <ReportTable head={["在田作物", "生育期", "近 10 日需水量 (mm)", "灌溉参考 (mm)"]}
          rows={balances.map((item) => [item.name, item.stage, number(item.etc, 1), item.irrigable ? number(item.irrigationRefMm, 1) : "不纳入"])} />}
      </section>

      {crops?.stages?.length > 0 && <section className="report-section">
        <h3>四、作物农事与病虫</h3>
        <ReportTable head={["作物", "生育期", "农事要点"]} rows={crops.stages.map(({ name, stage, focus }) => [name, stage, focus])} />
        {sprayWindows.length > 0 && <ReportTable head={["喷药作业窗口（未来 48 小时）", "时长", "最大风速 (km/h)"]}
          rows={sprayWindows.map(({ start, end, hours, windPeak }) => [`${clockLabel(start)} – ${end.slice(11, 16)}`, `${hours} 小时`, number(windPeak, 1)])} />}
        {crops.pests?.length > 0 && <ReportTable head={["病虫", "气象适宜度", `近 7 日适宜日数占比（${spanLabel(crops.pestWindow)}）`, "未来 48 小时适宜时数占比"]}
          rows={crops.pests.map((pest) => [pest.pest, `${pest.level ?? "—"}${pest.seasonal ? "" : "（非敏感期）"}`, `${pest.recentPct ?? "—"}%`, `${pest.forecastPct ?? "—"}%`])} />}
        {crops.lamp && <p>虫情灯诱：{spanLabel(crops.lamp)} 合计 {number(crops.lamp.total7)} 头，优势种 {crops.lamp.species[0]?.name}
          （近 7 日 {number(crops.lamp.species[0]?.last7)} 头，周环比 {crops.lamp.species[0]?.trend > 0 ? "+" : ""}{crops.lamp.species[0]?.trend ?? 0}%）。</p>}
        {crops.operations && <p>农事作业台账（{crops.operations.month}）：本月 {crops.operations.monthTotal} 次，
          {Object.entries(crops.operations.byType).map(([type, count]) => `${type} ${count} 次`).join("、")}；记录截至 {monthDay(crops.operations.asOf)}。</p>}
        <p className="report-note">喷药窗口与病虫气象适宜度由逐时预报和农业气象日值判定；{crops.method?.pest}</p>
      </section>}

      <section className="report-section">
        <h3>五、预警与农气事件</h3>
        {official.length ? <div className="report-alerts">{official.map((alert) => <p key={alert.id}>
          <LevelBadge alert={alert} /> {alert.title} · {alert.area ?? "见原文"} · {formatTime(alert.startsAt, "date")} 发布</p>)}</div>
          : <p>{alerts?.status === "current" ? `当前无生效气象预警（${formatTime(alerts.fetchedAt, "date")} 查询）` : "官方预警暂不可查询"}。</p>}
        {agro?.risks?.length ? <ReportTable head={["日期", "事件", "等级", "依据"]}
          rows={agro.risks.map((item) => [item.window, item.type, item.level, item.standard])} />
          : <p>{agro?.risks ? "近 90 日未触发国标农气事件阈值。" : "暂无可用的农气事件扫描记录。"}</p>}
        {crossMatches(agro, officialArchive).length ? <p className="report-note">多源印证：{crossMatches(agro, officialArchive)
          .map(({ risk: item, alerts: matched }) => `${item.window} ${matched[0].title}与卫星日雨量 ${item.detail.replace("日雨量 ", "")}互证`).join("；")}。</p> : null}
      </section>

      <section className="report-section">
        <h3>六、农事建议</h3>
        <ol className="report-advice">
          <li><strong>农时</strong>：{term.name} · {term.advice}（距{term.nextName} {term.daysToNext} 天）。</li>
          <li><strong>水分管理</strong>：{!balance ? "本月无区域灌溉参考作物，按田间巡查记录安排灌排。" : irrigate
            ? `${balance.name}（${balance.stage}）水分平衡给出 ${number(balance.irrigationRefMm, 1)} mm 补水参考量，结合田间含水情况安排。`
            : `有效降雨已覆盖${balance.name}（${balance.stage}）参考需水量，巡查排水和积水点。`}</li>
          {crops?.stages?.length > 0 && <li><strong>植保作业</strong>：{spray
            ? `未来 48 小时昼间最近适宜喷药时段为 ${clockLabel(spray.start)} – ${spray.end.slice(11, 16)}（最大风速 ${number(spray.windPeak, 1)} km/h），避开大风与降雨时段。`
            : "未来 48 小时昼间暂无连续 2 小时以上的适宜喷药窗口，待风速回落、降雨间歇后再安排。"}</li>}
          <li><strong>巡查重点</strong>：{risk.high ? "关注低洼地块积水与排水沟渠畅通。" : "常规巡查田埂、沟渠与设施固定件。"}</li>
        </ol>
      </section>
      </div>

      <footer className="report-foot">
        <p>数据来源：中国天气网 · Open-Meteo · ECMWF ERA5-Land · NASA POWER</p>
        <p>生成时间：{new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, dateStyle: "short", timeStyle: "medium", hourCycle: "h23" }).format(new Date())} · 斗门智慧农田监测平台</p>
      </footer>
  </article>;
}

// ============ 数据链路自检 ============
function useNow(stepMs = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return now;
}

function relTime(value, now) {
  const time = value != null ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
}

// 主界面数据状态条：各路数据最新到什么时间，用绝对时间表示；点击进入明细。
function DataLinksBar({ sources, onOpen }) {
  const tone = { current: "正常", cached: "沿用上次结果", unavailable: "暂不可用" };
  const pending = sources.filter(({ status }) => status === "cached").length;
  const down = sources.filter(({ status }) => status === "unavailable").length;
  const parts = [down && `${down} 项暂不可用`, pending && `${pending} 项未更新`].filter(Boolean);
  const summary = parts.length ? parts.join(" · ") : sources.every(({ status }) => status === "current") ? "全部正常" : "";
  return <footer className="datalinks-bar" aria-label="数据状态">
    <span className="datalinks-label">数据状态{summary ? ` · ${summary}` : ""}</span>
    <div className="datalinks-items">
      {sources.map(({ key, label, status, time }) => <button key={key} type="button" className="datalinks-item" onClick={onOpen}
        title={`${label} · ${tone[status] ?? "等待数据"}`}>
        <i className={`datalinks-dot ${status ?? "loading"}`} />
        <span>{label}</span>
        <small>{stamp(time)}</small>
      </button>)}
    </div>
    <button type="button" className="text-button" onClick={onOpen}>明细 <CaretRight size={13} /></button>
  </footer>;
}

function DataLinksDetails({ sources }) {
  return <>
    <Metadata rows={sources.map(({ label, role, time, fetchedAt, cycle, status, note }) => [
      label,
      <>{role}<br /><small className={status === "current" ? "link-live" : "link-stale"}>
        {wave(status && { status })} · 数据 {stamp(time) || "—"}{fetchedAt ? ` · 更新 ${stamp(fetchedAt)}` : ""}
        {cycle ? ` · 每 ${cycle}刷新` : ""}{note ? ` · ${note}` : ""}
      </small></>,
    ])} />
    <Source label="中国天气网 · 斗门站" href={stationUrl} />
    <Source label="Open-Meteo 预报接口" href="https://open-meteo.com/en/docs" />
    <Source label="NASA POWER 农业气象" href="https://power.larc.nasa.gov/" />
  </>;
}

// ============ 灌溉决策计算器 ============
// 输入全部来自平台数据：某作物近 10 日 FAO-56 水分平衡得出的灌溉参考量与日均需水；
// 参考作物可切换（当季在田作物 + 拟试点地块场景），面积与泵额定流量由用户按本地实际调整。
function IrrigationPlanner({ agro, weather }) {
  const options = (agro?.balances ?? []).filter(({ irrigable }) => irrigable);
  const [choice, setChoice] = useState("");
  const [area, setArea] = useState(50);
  const [flow, setFlow] = useState(20);
  const pumps = 2;
  const balance = options.find(({ id }) => id === (choice || agro?.waterBalance?.id)) ?? null;
  if (!balance) return null;
  const refMm = Math.max(0, balance.irrigationRefMm ?? 0);
  const etcDaily = balance.days > 0 ? (balance.etc ?? 0) / balance.days : 0;
  const totalM3 = refMm * area * 0.667;
  const hours = flow > 0 ? totalM3 / (flow * pumps) : NaN;
  const coverDays = etcDaily > 0 && refMm > 0 ? refMm / etcDaily : NaN;
  const rain24 = weather?.hourly?.reduce((sum, hour) => sum + (hour.rain ?? 0), 0) ?? null;
  const rainySoon = rain24 != null && rain24 >= 10;
  const slider = (label, value, min, max, step, unit, setValue, hint) => <div className="planner-slider">
    <span>{label}<strong>{value} <small>{unit}</small></strong></span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => setValue(Number(event.target.value))} aria-label={`${label}（${unit}）`} />
    <small>{hint}</small>
  </div>;
  return <>
    <h3 className="detail-heading">灌溉作业换算器</h3>
    <p className="muted">按所选作物近 {balance.days} 日水分平衡得出的灌溉参考量换算作业方案。1 mm ≈ 0.667 m³/亩。</p>
    <div className="planner">
      <label className="detail-select">参考作物
        <select value={balance.id} onChange={(event) => setChoice(event.target.value)}>
          {options.map(({ id, name, stage }) => <option key={id} value={id}>{name} · {stage}</option>)}
        </select>
      </label>
      <p className="planner-note">{balance.name}（{balance.stage}，Kc {number(balance.kc, 2)}）：灌溉参考量 {number(refMm, 1)} mm，日均需水 {number(etcDaily, 2)} mm/d。</p>
      {slider("地块面积", area, 5, 500, 5, "亩", setArea, "按实际种植范围调整")}
      {slider("单泵额定流量", flow, 5, 80, 5, "m³/h", setFlow, `${pumps} 泵并行 · 合计 ${flow * pumps} m³/h`)}
      <div className="planner-results">
        <div><span>本次灌溉总量</span><strong>{number(totalM3, 0)} <small>m³</small></strong></div>
        <div><span>{pumps} 泵并行需时</span><strong>{Number.isFinite(hours)
          ? <>{number(hours, 1)} <small>h</small>{hours >= 24 ? ` ≈ ${number(hours / 24, 1)} 天` : ""}</> : "—"}</strong></div>
        <div><span>该水量可覆盖</span><strong>{Number.isFinite(coverDays) ? number(coverDays, 1) : "—"} <small>天</small></strong></div>
      </div>
      <p className={`planner-note ${rainySoon ? "planner-note-rain" : ""}`}>
        {refMm <= 0
          ? <>近 10 日有效降雨已覆盖{balance.name}参考需水量，本次无灌溉作业；出现连续无雨日后重新换算。{rainySoon ? ` 未来 24 小时预报累计降雨 ${number(rain24, 1)} mm，继续做好排水。` : ""}</>
          : rainySoon
            ? <>未来 24 小时预报累计降雨 {number(rain24, 1)} mm，建议雨后复核墒情再执行，可折减本次灌水量。</>
            : <>未来 24 小时无有效降雨预报（累计 {number(rain24, 1)} mm），可按上表安排作业；灌溉后 24 小时复测墒情验证。</>}
      </p>
    </div>
  </>;
}

// ============ 预警值守台账 ============
const LEDGER_KEY = "doumen-alert-ledger";
function loadLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) ?? {}; } catch { return {}; }
}
function LedgerTable({ onAlert }) {
  const [ledger, setLedger] = useState(loadLedger);
  const [level, setLevel] = useState("all");
  const now = useNow();
  const toggle = (id) => {
    const next = { ...ledger, [id]: { done: !ledger[id]?.done, at: Date.now() } };
    if (!next[id].done) delete next[id];
    setLedger(next);
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(next)); } catch { /* 本地存储不可用 */ }
  };
  const rows = officialArchive.filter((alert) => level === "all" || alert.color === level);
  const doneCount = officialArchive.filter((alert) => ledger[alert.id]?.done).length;
  return <>
    <h3 className="detail-heading">值守台账 · 历史预警处置</h3>
    <p className="muted">逐条登记历史预警的处置状态；登记结果保存在本机浏览器。</p>
    <div className="ledger-summary">
      <span>档案 {officialArchive.length} 条</span>
      <strong>已处置 {doneCount} / {officialArchive.length}</strong>
      <em>{doneCount === officialArchive.length ? "全部处置完成" : `待处置 ${officialArchive.length - doneCount} 条`}</em>
    </div>
    <div className="archive-filter" role="group" aria-label="按等级筛选台账">
      <button type="button" aria-pressed={level === "all"} onClick={() => setLevel("all")}>全部</button>
      {["blue", "yellow", "orange", "red"].map((tone) => <button type="button" key={tone} aria-pressed={level === tone}
        onClick={() => setLevel(tone)}>{levels[tone]}</button>)}
    </div>
    <div className="ledger-list">
      {rows.map((alert) => {
        const done = ledger[alert.id]?.done;
        return <div className={`ledger-row ${done ? "ledger-done" : ""}`} key={alert.id}>
          <AlertRow alert={alert} onClick={() => onAlert(alert, true)} />
          <button type="button" className={`ledger-toggle ${done ? "done" : ""}`} onClick={() => toggle(alert.id)}
            title={done ? "点击改回待处置" : "登记为已处置"}>
            {done ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}
            <span>{done ? "已处置" : "标记处置"}</span>
            {done && ledger[alert.id]?.at && <small>{relTime(ledger[alert.id].at, now)}</small>}
          </button>
        </div>;
      })}
      {!rows.length && <p className="detail-empty">本档案暂无该等级记录。</p>}
    </div>
  </>;
}

// ============ 拟试点地块详情 ============
// 面积由图上勾绘边界的经纬多边形按等距投影换算（鞋带公式），为真实几何计算结果。
function polygonAreaMu(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const [lat1, lon1] = points[index];
    const [lat2, lon2] = points[(index + 1) % points.length];
    const x1 = lon1 * 111_320 * Math.cos((lat1 * Math.PI) / 180);
    const y1 = lat1 * 110_950;
    const x2 = lon2 * 111_320 * Math.cos((lat2 * Math.PI) / 180);
    const y2 = lat2 * 110_950;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2 / 666.67;
}

function PlotDetails({ profile, ndvi, onSoil, onField, onReplay }) {
  const latest = profile?.days?.at(-1);
  const scene = ndvi?.scenes?.at(-1);
  const mu = polygonAreaMu(PILOT_FIELD.bounds);
  const centerLat = PILOT_FIELD.bounds.reduce((sum, [lat]) => sum + lat, 0) / PILOT_FIELD.bounds.length;
  const centerLon = PILOT_FIELD.bounds.reduce((sum, [, lon]) => sum + lon, 0) / PILOT_FIELD.bounds.length;
  const rootGrade = latest ? gradeOf(latest.grade.root) : null;
  return <>
    <h3 className="detail-heading">拟试点地块 · 大濠冲村</h3>
    <p>{PILOT_FIELD.note}</p>
    <Metadata rows={[
      ["图上面积", `≈ ${number(mu, 1)} 亩（${number(mu * 666.67, 0)} m²）`],
      ["中心坐标", `${centerLat.toFixed(5)}° N, ${centerLon.toFixed(5)}° E`],
      ["根区墒情（7–28 cm）", latest ? `${number(latest.moisture.root, 1)}% · 相对湿度 ${number(latest.relative.root)}%` : "—"],
      ["墒情等级", rootGrade ? `${rootGrade.label} · ${latest.date}` : "—"],
      ["植被指数", scene?.ndvi?.overall != null ? `${scene.ndvi.overall.toFixed(2)} · ${scene.date}` : "—"],
      ["种植场景", "土壤栽培果蔬，以番茄为参考作物"],
    ]} />
    <div className="plot-links">
      <button type="button" className="risk-chip" onClick={onSoil}><span>墒情监测详情</span><CaretRight size={13} /></button>
      <button type="button" className="risk-chip" onClick={() => onField("planning")}><span>空间布局专题图</span><CaretRight size={13} /></button>
      <button type="button" className="risk-chip" onClick={onReplay} title="意大利帕尔马番茄灌溉试验公开数据集，与本地块规划场景作物一致"><span>番茄田试验回放</span><CaretRight size={13} /></button>
    </div>
    <p className="muted">面积按图上边界换算，实际以现场测量为准；墒情为斗门镇所在网格的参考值。</p>
  </>;
}

// ============ 键盘快捷键 ============
const SHORTCUTS = [
  ["1", "回到农情总览"], ["2", "预警值守"], ["3", "农事决策"], ["4", "定位生产档案"],
  ["R", "农情日报"], ["D", "数据状态"], ["F", "全屏 / 退出全屏"], ["?", "本帮助"], ["Esc", "关闭当前弹层"],
];
function ShortcutsHelp() {
  return <>
    <p className="muted">大屏支持键盘值守操作，投屏值班时可不依赖鼠标。</p>
    <div className="shortcut-grid" role="table" aria-label="键盘快捷键">
      {SHORTCUTS.map(([key, desc]) => <Fragment key={key}>
        <kbd>{key}</kbd><span>{desc}</span>
      </Fragment>)}
    </div>
    <p className="muted">按 Esc 关闭任意弹层；数字键切换主视图时不影响正在填写的表单。</p>
  </>;
}

// 首屏自适应：把「标题 + 指标条 + 三栏看板」整体放进页头以下、播报条以上的一屏内。
// 窗口模式只在缩放比不低于 0.8 时整体微缩（1920×1080、1600×900、1440×900），否则保留页面滚动
// （1366×768 约需 0.77）；全屏模式或地址带 ?fit=1（展厅、值班大屏直接打开）时始终完整显示。
const FIT_MIN_SCALE = 0.8;
const FIT_MIN_WIDTH = 1061;

function useScreenFit() {
  const frame = useRef(null);
  const screen = useRef(null);
  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = screen.current;
    if (!outer || !inner) return undefined;
    const forcedFit = new URLSearchParams(window.location.search).get("fit") === "1";
    const apply = (zoom, height) => {
      inner.style.zoom = String(zoom);
      inner.style.height = height == null ? "auto" : `${height}px`;
      outer.style.height = height == null ? "auto" : `${height * zoom}px`;
    };
    // 元素自身坐标系里的自然高度，不依赖浏览器如何报告 zoom 下的尺寸。
    const localHeight = (zoom) => {
      const rect = inner.getBoundingClientRect();
      const rectScaled = Math.abs(rect.width - inner.offsetWidth) > 1;
      return (rectScaled ? rect.height : rect.height * zoom) / zoom;
    };
    const fit = () => {
      if (window.innerWidth < FIT_MIN_WIDTH) { apply(1, null); return; }
      const header = document.querySelector(".app-header");
      const ticker = document.querySelector(".ticker-bar");
      const tickerSpace = ticker ? ticker.offsetHeight + (parseFloat(getComputedStyle(ticker).marginTop) || 0) : 0;
      const available = window.innerHeight - (header?.offsetHeight ?? 64) - tickerSpace - 12;
      if (available < 420) { apply(1, null); return; }
      // 缩放后版心变宽、折行变少，高度会随之变化，迭代两三轮即可收敛。
      let zoom = 1;
      for (let pass = 0; pass < 4; pass++) {
        apply(zoom, null);
        const target = Math.min(1, available / localHeight(zoom));
        if (Math.abs(target - zoom) < 0.004) break;
        zoom = target;
      }
      if (document.fullscreenElement || forcedFit || zoom >= FIT_MIN_SCALE) {
        apply(zoom, available / zoom);
        // 定稿后校验：迭代留有容差，内容若仍高出容器，就逐档再缩小，保证不压到播报条。
        for (let guard = 0; guard < 6 && inner.scrollHeight > inner.clientHeight + 1; guard++) {
          zoom = Number((zoom - 0.01).toFixed(4));
          apply(zoom, available / zoom);
        }
      } else apply(1, null);
    };
    // 调度不依赖 requestAnimationFrame 与 ResizeObserver：页面被遮挡或离屏渲染时这两者会被暂停，
    // 而展厅大屏、值守窗口恰恰常处于这种状态。合并同一刻的多次触发，并定时复核（数据到达后面板高度会变）。
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = 0; fit(); }, 60);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(inner);
    const ticker = document.querySelector(".ticker-bar");
    if (ticker) observer.observe(ticker);
    window.addEventListener("resize", schedule);
    document.addEventListener("fullscreenchange", schedule);
    const interval = window.setInterval(fit, 2000);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, []);
  return { frame, screen };
}

export function App() {
  const { frame: screenFrame, screen: screenContent } = useScreenFit();
  const weather = useReading("/api/weather", 900_000, "/data/weather-snapshot.json");
  const observations = useReading("/api/observations", 300_000, "/data/observations-snapshot.json");
  const profile = useReading("/api/soil-profile", 3_600_000, "/data/soil-profile-snapshot.json");
  const agro = useReading("/api/agro", 3_600_000, "/data/agro-snapshot.json");
  const satelliteSoil = useReading("/api/satellite-soil", 1_800_000, "/data/satellite-soil-snapshot.json");
  const ndvi = useReading("/api/ndvi", 1_800_000, "/data/ndvi-snapshot.json");
  const crops = useReading("/api/crops", 900_000, "/data/crops-snapshot.json");
  const alerts = useActiveAlerts(useReading("/api/alerts", 300_000));
  const alertHistory = useReading("/api/alert-history", 600_000, "/data/alert-history-snapshot.json");
  // 现场录像清单：由 scripts/prepare-monitor.mjs 从「现场监控」文件夹生成。
  const monitorClips = useReading("/media/monitor/clips.json", 3_600_000);
  const [views, setViews] = useState([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const view = views.at(-1);
  const risk = rainRisk(weather);
  const open = (type, options) => setViews((previous) => [...previous, { type, ...options }]);
  const close = () => setViews([]);
  // 生产档案内联在主界面下方，导航与快捷键直接滚动定位。
  const scrollToProduction = () => {
    close();
    document.getElementById("production")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // 农情简报：播报条与简报弹层共用同一份条目，点击直达对应详情。
  const briefing = briefingItems(alerts, agro, profile, crops);
  const jumpToBriefing = (key) => {
    const item = briefing.find((entry) => entry.key === key);
    if (!item) return;
    if (item.view.type === "production") scrollToProduction();
    else open(item.view.type, item.view);
  };
  const openAlert = (alert, archived = false) => open("alert", { alert, archived });
  const openArchive = (color) => open("archive", { color });
  const openField = (photoId) => open("field", { photoId });
  const openPhoto = (photoId) => {
    const image = fieldImages.find(({ id }) => id === photoId);
    if (image) open("image", { image });
  };
  const activePage = views[0]?.type;
  const riskPages = ["risk", "storm", "alert", "archive", "rainfall", "actions"];
  const titles = { weather: "斗门站实况", forecast: "斗门天气预报", soil: "土壤墒情",
    ndvi: "卫星苗情", agro: "蒸散与灌溉决策", risk: "气象预警", storm: "台风「桦加沙」", field: "斗门田间影像档案", replay: "番茄田灌溉试验回放（外部参考）",
    map: "卫星底图与调研点位", archive: "预警档案", alert: view?.archived ? "历史预警详情" : "生效预警详情",
    plot: PILOT_FIELD.name, links: "数据状态", help: "键盘快捷键", pest: "虫情测报灯", crops: "作物农事决策",
    report: "农情日报", briefing: "农情简报", rainfall: "斗门镇暴雨实测记录",
    actions: "农事处置", water: "斗门区域水环境", image: view?.image?.title, monitor: "现场监控" };
  const dataLinks = [
    { key: "obs", label: "站点实况", role: "中国天气网 · 斗门站 101280702", status: observations?.status, time: observations?.current?.time, fetchedAt: observations?.fetchedAt, cycle: "10 分钟" },
    { key: "obs-history", label: "整点实况", role: "中央气象台 · 斗门站 59487", status: observations?.historyStatus, time: observations?.history?.at(-1)?.time, cycle: "10 分钟" },
    { key: "wx", label: "天气预报", role: "Open-Meteo · 斗门参考点 22.21°N 113.30°E", status: weather?.status, time: weather?.fetchedAt, fetchedAt: weather?.fetchedAt, cycle: "15 分钟" },
    { key: "soil", label: "土壤墒情", role: "ECMWF ERA5-Land 再分析 · 0.1° 网格", status: profile?.status, time: profile?.days?.at(-1)?.date ? `${profile.days.at(-1).date}T00:00:00+08:00` : null, fetchedAt: profile?.fetchedAt, cycle: "6 小时", note: "来源滞后约 5 天" },
    { key: "agro", label: "农业气象", role: "NASA POWER 农业气象日值", status: agro?.status, time: agro?.et0?.latestDate ? `${agro.et0.latestDate}T00:00:00+08:00` : null, fetchedAt: agro?.fetchedAt, cycle: "6 小时", note: "来源滞后 3–4 天" },
    { key: "sat", label: "卫星墒情", role: "NOAA CPC SMOPS 卫星土壤湿度 · 表层 1–5 cm", status: satelliteSoil?.status, time: satelliteSoil?.points?.at(-1)?.time, fetchedAt: satelliteSoil?.checkedAt, cycle: "6 小时", note: "来源滞后约 3 天" },
    { key: "ndvi", label: "卫星苗情", role: "Sentinel-2 卫星遥感植被指数（NDVI）", status: ndvi?.status, time: ndvi?.scenes?.at(-1)?.date, fetchedAt: ndvi?.checkedAt, cycle: "6 小时", note: "只采用云量低于 30% 的影像" },
    { key: "crops", label: "作物决策", role: "平台模型 · 逐时预报 + 农业气象日值派生", status: crops?.stages?.length ? crops.status : crops?.status, time: crops?.fetchedAt, fetchedAt: crops?.fetchedAt, cycle: "15 分钟" },
    { key: "alerts", label: "气象预警", role: "中国天气网 · 珠海市 / 斗门区", status: alerts?.status, time: alerts?.fetchedAt, fetchedAt: alerts?.fetchedAt, cycle: "5 分钟" },
  ];

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  // 键盘值守：数字键切主视图，R/D/F 功能键，? 打开帮助。输入控件聚焦时不劫持。
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key === "?" ? "?" : event.key.toLowerCase();
      if (key === "1") { setViews([]); window.scrollTo({ top: 0 }); }
      else if (key === "2") setViews([{ type: "risk" }]);
      else if (key === "3") setViews([{ type: "crops" }]);
      else if (key === "4") scrollToProduction();
      else if (key === "r") setViews([{ type: "report" }]);
      else if (key === "d") setViews([{ type: "links" }]);
      else if (key === "f") toggleFullscreen();
      else if (key === "?") setViews([{ type: "help" }]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function toggleFullscreen() {
    setScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setScreenError("浏览器没有允许进入全屏，可按 F11 或用浏览器菜单里的全屏功能。"); }
  }

  return <>
    <header className="app-header">
      <div className="wordmark"><BrandMark /><strong>斗门智慧农田</strong></div>
      <nav className="top-nav" aria-label="大屏导航">
        <button type="button" className={!["crops", ...riskPages].includes(activePage) ? "active" : ""} onClick={() => {
          close();
          if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
          window.scrollTo({ top: 0 });
        }}>
          农情总览
        </button>
        <button type="button" className={riskPages.includes(activePage) ? "active" : ""} onClick={() => open("risk")}>预警值守</button>
        <button type="button" className={activePage === "crops" ? "active" : ""} onClick={() => open("crops")}>农事决策</button>
        <button type="button" onClick={scrollToProduction}>生产档案</button>
      </nav>
      <div className="header-tools"><ClockDisplay />
        <button type="button" className="fullscreen-button" onClick={toggleFullscreen}>{fullscreen ? "退出全屏" : "全屏"}</button></div>
    </header>

    <main className="dashboard">
      <div className="screen-frame" ref={screenFrame}>
        <div className="screen" ref={screenContent}>
          <div className="dashboard-head">
            <div><h1>农情监测</h1><p>斗门镇 · 大濠冲村 / 小濠冲村</p></div>
            <div className="head-side">
              <TermChip />
              <button type="button" className="report-button" onClick={() => open("report")} title="汇总当日农情，可打印">农情日报</button>
              <div className={`connection ${observations?.status ?? "loading"}`} role="status">
                <i /> <span>{observations?.status === "current" ? "数据更新" : wave(observations)}</span>
                {observations?.current?.time && <small>{stamp(observations.current.time)}</small>}
              </div>
            </div>
          </div>
          <KpiStrip observations={observations} profile={profile} agro={agro} alerts={alerts} onOpen={open} />
          {screenError && <p className="screen-error" role="status">{screenError}</p>}

          <div className="board-grid">
            <aside className="board-column readings" aria-label="天气和墒情">
              <WeatherPanel weather={observations} regional={weather} onOpen={() => open("weather")} />
              <SoilPanel profile={profile} onOpen={() => open("soil")} />
              <ForecastPanel weather={weather} risk={risk} onOpen={() => open("forecast")} />
            </aside>
            <section className="panel map-panel">
              <div className="map-panel-header">
                <PanelTitle title="农田地理态势" action="影像档案" onClick={() => openField("aerial")} />
              </div>
              <FieldMap onVillage={(village) => open("village", { village })} onMapInfo={() => open("map")} onPhoto={openPhoto} onPlot={() => open("plot")} />
              <FourQuads profile={profile} ndvi={ndvi} alerts={alerts} crops={crops} onOpen={open} />
              <div className="survey-list">
                {villages.map((village) => <button type="button" key={village.id}
                  className="village-card" onClick={() => open("village", { village })}>
                  <span className="village-card-icon"><MapPin size={20} weight="duotone" /></span>
                  <span><strong>{village.name}</strong><small>{village.label}</small></span><CaretRight size={17} />
                </button>)}
                <button type="button" className="village-card pilot-card" onClick={() => open("plot")} title="查看拟试点地块详情">
                  <span className="village-card-icon pilot-swatch" />
                  <span><strong>{PILOT_FIELD.name}</strong><small>西部沿海高速旁</small></span><CaretRight size={17} />
                </button>
              </div>
            </section>
            <aside className="board-column operations" aria-label="风险、现场和滴灌">
              <RiskPanel risk={risk} alerts={alerts} history={alertHistory} onRisk={() => open("risk")} onAction={() => open("actions")} onArchive={openArchive} onAlert={openAlert} />
              <AgroPanel agro={agro} crops={crops} onOpen={() => open("agro")} onCrops={() => open("crops")} />
              <MonitorPanel clips={monitorClips} onOpen={() => open("monitor")} onArchive={() => openField("overhead")} />
            </aside>
          </div>
        </div>
      </div>
      <DataLinksBar sources={dataLinks} onOpen={() => open("links")} />
      <Ticker items={briefing} onJump={jumpToBriefing} onOpen={() => open("briefing")} />
      <AnalysisSection observations={observations} weather={weather} profile={profile} agro={agro} crops={crops}
        ndvi={ndvi} satelliteSoil={satelliteSoil} onOpen={open} onLedger={scrollToProduction} />
      <ProductionRecords onField={openField} onRisk={() => open("actions")} onWater={() => open("water")} operations={crops?.operations} />
      <footer className="app-footer">
        <span className="footer-brand">珠海斗门智慧农田监测</span>
        <span className="footer-links">数据来源
          <a href={stationUrl} target="_blank" rel="noreferrer">中国天气网</a>
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
          <a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">NASA POWER</a>
        </span>
        <span className="footer-actions">
          <button type="button" className="text-button" onClick={() => open("water")}>区域水环境 <CaretRight size={13} /></button>
          <button type="button" className="text-button" onClick={() => open("briefing")}>农情简报 <CaretRight size={13} /></button>
          <button type="button" className="text-button" onClick={() => open("links")}>数据状态 <CaretRight size={13} /></button>
          <button type="button" className="text-button" onClick={() => open("help")}>快捷键 <CaretRight size={13} /></button>
        </span>
      </footer>
    </main>

    {view && <Details page={view.type} title={view.village?.name ?? titles[view.type]}
      wide={["field", "image", "replay", "report", "weather", "forecast", "monitor"].includes(view.type)} onClose={close}
      onBack={views.length > 1 ? () => setViews((previous) => previous.slice(0, -1)) : undefined}>
      {["weather", "forecast"].includes(view.type) && <WeatherDetails weather={view.type === "weather" ? observations : weather} variant={view.type} risk={risk} regional={weather} />}
      {view.type === "soil" && <SoilDetails profile={profile} satellite={satelliteSoil} onReplay={() => open("replay")} />}
      {view.type === "ndvi" && <NdviDetails ndvi={ndvi} />}
      {view.type === "agro" && <AgroDetails agro={agro} weather={weather} onReplay={() => open("replay")} onWater={() => open("water")} onCrops={() => open("crops")} />}
      {view.type === "risk" && <RiskDetails risk={risk} alerts={alerts} agro={agro} profile={profile} onAlert={openAlert} onArchive={openArchive}
        onRainfall={() => open("rainfall")} />}
      {view.type === "actions" && <>
        <Metadata rows={[["当前重点", risk.high ? "清沟排涝与设施检查" : "巡查田埂、沟渠与设施"],
          ["未来 24 小时累计雨量", risk.actionable ? `${number(risk.total, 1)} mm` : "暂无有效预报"]]} />
        <ActionSteps />
        <button type="button" className="text-button" onClick={() => open("risk")}>查看预警及判断依据 <CaretRight size={15} /></button>
      </>}
      {view.type === "rainfall" && <>
        <Metadata rows={[["地点", "珠海市斗门区斗门镇"], ["实测时段（北京时间）", rainfallRecord.window],
          ["24 小时累计雨量", `${rainfallRecord.amount} mm`]]} />
        <ActionSteps />
        <details className="source-details"><summary>观测出处</summary><Source label="应急管理部门 · 广东极端强降雨记录" href={rainfallRecord.url} /></details>
      </>}
      {view.type === "archive" && <AlertArchive color={view.color} history={alertHistory} onAlert={openAlert} onStorm={() => open("storm")} />}
      {view.type === "alert" && <AlertDetail alert={view.alert} archived={view.archived} />}
      {view.type === "storm" && <StormDetails />}
      {view.type === "field" && <FieldDetails initial={view.photoId} onImage={(image) => setViews((previous) => [
        ...previous.slice(0, -1), { ...previous.at(-1), photoId: image.id }, { type: "image", image },
      ])} />}
      {view.type === "image" && <ImageDetails image={view.image} />}
      {view.type === "replay" && <ReplayDetails />}
      {view.type === "village" && <VillageDetails village={view.village} onField={openField} />}
      {view.type === "plot" && <PlotDetails profile={profile} ndvi={ndvi} onSoil={() => open("soil")} onField={openField} onReplay={() => open("replay")} />}
      {view.type === "links" && <DataLinksDetails sources={dataLinks} />}
      {view.type === "water" && <WaterDetails />}
      {view.type === "crops" && <CropsDetails crops={crops} onLamp={() => open("pest")} onAgro={() => open("agro")} />}
      {view.type === "briefing" && <Briefing items={briefing} />}
      {view.type === "report" && <DailyReport observations={observations} profile={profile} agro={agro} alerts={alerts} risk={risk} crops={crops} />}
      {view.type === "monitor" && <MonitorDetails clips={monitorClips} />}
      {view.type === "help" && <ShortcutsHelp />}
      {view.type === "pest" && <PestLampDetails crops={crops} />}
      {view.type === "map" && <>
        <Metadata rows={[
          ["卫星底图", "Sentinel-2 · 2025 年自然色合成 · EOxCloudless · 约 20 米一像素"],
          ["高清实拍影像", `放大到约 13.5 级后，在同一位置叠入 ${DETAIL_IMAGERY.name} 的真实影像，可继续放大到 16 级细看田块、道路与村舍（更近只会拉伸像素）。需联网；取不到时保持卫星底图`],
          ["航拍近景", "大濠冲村 2026-07-13 无人机航拍。放大到约 15 级、画面中心在大濠冲村点 700 米以内时自动推进（滚轮、「＋」、双指都一样），也可点「农田近景」进入"],
          ["影像许可", <Source label="CC BY-NC-SA 4.0" href="https://cloudless.eox.at/license-non-commercial" />],
          ["调研底图", "2018 年斗门区地图局部 · 粤S（2018）022号 · 广东省国土资源厅监制"],
          ["图上点位", "大濠冲村、小濠冲村调研位置"],
        ]} />
        <Source label={`${DETAIL_IMAGERY.name} · 公共影像服务`} href={DETAIL_IMAGERY.url} />
        <button type="button" className="text-button" onClick={() => open("image", { image: {
          file: asset("/media/doumen-survey-map.jpg"), title: "斗门区调研底图", alt: "斗门区纸质地图调研区域局部", context: "2018 年斗门区地图 · 粤S（2018）022号",
        } })}>查看调研底图原图 <CaretRight size={14} /></button>
        <p className="muted">村级参考点来自 OpenStreetMap。</p>
        <Source label="大濠冲村 POI" href="https://www.openstreetmap.org/node/2065808394" />
        <Source label="小濠冲村 POI" href="https://www.openstreetmap.org/node/2065814027" />
      </>}
    </Details>}
    {view?.type === "report" && <div className="print-report">
      <DailyReport observations={observations} profile={profile} agro={agro} alerts={alerts} risk={risk} crops={crops} printing />
    </div>}
  </>;
}
