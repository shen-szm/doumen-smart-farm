import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut, ArrowUpRight, Broadcast, Bug, Camera, CaretRight, CheckCircle, Circle, Clock, Calculator,
  Cloud, CloudFog, CloudRain, CloudSun, Database, Drop, Gauge, Keyboard, Leaf, MapPin, MapTrifold, Monitor, PlayCircle, Sun, Thermometer,
  ChartBar, ChartLineDown, ChartLineUp, FileText, Images, Plant, Scan, ShieldCheck, ShieldWarning, VideoCamera, WarningCircle, Wind, X,
} from "@phosphor-icons/react";
import { FieldMap, villages, PILOT_FIELD } from "./FieldMap.jsx";
import { AgroChart, ForecastChart, MonthlyChart, NdviChart, ReplayChart, RootZoneChart, SoilChart, SoilProfileChart, YieldChart } from "./charts.jsx";
import {
  alertUrl, asset, formatTime, getJson, guidanceUrl, number, rainRisk, replayTime,
  shanghai, stationUrl, stormUrl, useActiveAlerts, useReading, weatherText,
} from "./data.js";
import { alertTone, cropCalendar, cropStageTones, doumenStatistics, fieldImages, levels, localReferences, officialArchive, soilReference, villageHighlights } from "./records.js";
import { gradeOf, soilGradeScale } from "./grades.js";
import { solarTerm } from "./solar.js";

const overhead = asset("/media/dahaoyong-overhead.webp");
const aerial = asset("/media/dahaoyong-aerial.webp");
const cameraUrl = import.meta.env.VITE_CAMERA_HLS_URL;
const wave = (source) => source?.status === "current" ? "自动更新" : source?.status === "cached" ? "缓存快照"
  : source ? "暂不可用" : "正在获取";

function useCountUp(target, duration = 1100) {
  const [value, setValue] = useState(NaN);
  const current = useRef(NaN);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const from = Number.isFinite(current.current) ? current.current : 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (target - from) * eased;
      current.current = next;
      setValue(next);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function CountNumber({ value, digits = 0, unit }) {
  const display = useCountUp(value);
  const shown = Number.isFinite(value) ? (Number.isFinite(display) ? display : value) : NaN;
  return <strong>{Number.isFinite(shown) ? shown.toFixed(digits) : "—"}{unit && <small> {unit}</small>}</strong>;
}

function Sparkline({ values = [], color = "#7ad3d0", width = 92, height = 24 }) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 4) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => Number.isFinite(value)
    ? `${(index * stepX).toFixed(1)},${(height - 3 - ((value - min) / span) * (height - 6)).toFixed(1)}`
    : null);
  const segments = [];
  let current = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length > 1) { segments.push(current); current = []; }
    else current = [];
  }
  if (current.length > 1) segments.push(current);
  if (!segments.length) return null;
  return <svg className="kpi-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
    {segments.map((segment, index) => <polyline key={index} points={segment.join(" ")}
      fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />)}
  </svg>;
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

function PanelTitle({ icon: Icon, title, action, onClick }) {
  return <div className="panel-title">
    <h2><Icon size={20} />{title}</h2>
    {onClick && <button className="text-button" type="button" onClick={onClick}>
      {action} <CaretRight size={13} />
    </button>}
  </div>;
}

function Metric({ icon: Icon, label, value, unit }) {
  return <div className="metric"><span><Icon size={16} />{label}</span><strong>{number(value, unit === "mm" ? 1 : 0)} <small>{unit}</small></strong></div>;
}

function GradeBadge({ grade, title }) {
  const meta = gradeOf(grade);
  if (!meta) return <span className="grade-badge grade-unknown">—</span>;
  return <span className="grade-badge" title={title}
    style={{ color: meta.text, borderColor: meta.border, background: meta.bg }}>{meta.label}</span>;
}

function TermChip() {
  const term = useMemo(() => solarTerm(), []);
  return <div className="term-chip" title={`${term.advice}（距${term.nextName} ${term.daysToNext} 天）`}>
    <Sun size={15} weight="duotone" />
    <strong>{term.name}</strong>
    <span>第 {term.daysIn} 天</span>
    <small>距{term.nextName} {term.daysToNext} 天</small>
  </div>;
}

function KpiStrip({ observations, profile, agro, alerts, onOpen }) {
  const current = observations?.current;
  const latest = profile?.days?.at(-1);
  const active = alerts?.status === "current" ? alerts.alerts : null;
  const recent = (key, source, count) => (source ?? []).slice(-count).map((day) => day[key]);
  const cards = [
    { icon: Thermometer, label: "斗门站气温", value: current?.temp, digits: 1, unit: "°C", note: current?.time ? formatTime(current.time) : wave(observations), spark: recent("t2m", agro?.daily, 30), sparkColor: "#e8c95c", view: "weather" },
    { icon: Drop, label: "相对湿度", value: current?.humidity, unit: "%", note: "NASA POWER 日值近 30 日", spark: recent("rh", agro?.daily, 30), sparkColor: "#85abc7", view: "weather" },
    { icon: CloudRain, label: "过去 24 小时雨量", value: current?.rain, digits: 1, unit: "mm", note: "斗门站 101280702", spark: recent("precip", agro?.daily, 30), sparkColor: "#6fb7e8", view: "weather" },
    { icon: Plant, label: "根区墒情 7–28 cm", value: latest?.relative?.root, unit: "%", grade: latest?.grade?.root, note: latest ? `${latest.date} · ERA5-Land` : wave(profile), spark: (profile?.days ?? []).slice(-60).map(({ moisture }) => moisture?.root), sparkColor: "#58c98a", view: "soil" },
    { icon: Sun, label: "参考蒸散 ET0", value: agro?.et0?.latest, digits: 2, unit: "mm/d", note: agro?.et0?.latestDate ? `${agro.et0.latestDate} · FAO-56` : wave(agro), spark: recent("et0", agro?.daily, 30), sparkColor: "#e2b369", view: "agro" },
    { icon: ShieldWarning, label: "生效预警", value: active ? active.length : NaN, unit: "条",
      tone: active?.length ? "hot" : "calm", note: active ? (active.length ? "珠海市 / 斗门区" : "当前无生效预警") : wave(alerts), view: "risk" },
  ];
  return <div className="kpi-strip" aria-label="农情关键指标">
    {cards.map(({ icon: Icon, label, value, digits = 0, unit, note, grade, tone, view, spark, sparkColor }) => (
      <button key={label} type="button" className={`kpi-card ${tone ?? ""}`} onClick={() => onOpen(view)} title="查看详情">
        <span className="kpi-label"><Icon size={16} />{label}</span>
        <span className="kpi-value"><CountNumber value={value} digits={digits} unit={unit} />
          {grade && <GradeBadge grade={grade} title="GB/T 20481-2017 分级" />}</span>
        <span className="kpi-foot">
          <Sparkline values={spark ?? []} color={sparkColor} />
          {note && <small>{note}</small>}
        </span>
      </button>))}
  </div>;
}

function WeatherPanel({ weather, onOpen }) {
  const current = weather?.current;
  const condition = current?.text ?? weatherText(current?.code);
  const Icon = condition === "晴" ? Sun : condition === "阴" ? Cloud : condition.includes("雨") ? CloudRain : condition.includes("雾") ? CloudFog : CloudSun;
  return <section className="panel weather-panel">
    <PanelTitle icon={CloudSun} title="斗门天气实况" action="来源" onClick={onOpen} />
    <div className="weather-core" onClick={onOpen} title="查看实况与来源" role="button" tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <Icon className="weather-icon" size={50} weight="duotone" />
      <div><strong>{number(current?.temp, 1)}<small>°C</small></strong>
        <p>{condition} {current?.windDirection && <span>· {current.windDirection}{current.windLevel ? ` ${current.windLevel}` : ""}</span>}</p></div>
    </div>
    <div className="weather-grid">
      <Metric icon={Drop} label="相对湿度" value={current?.humidity} unit="%" />
      <Metric icon={Wind} label="风速" value={current?.wind} unit="km/h" />
      <Metric icon={Gauge} label="气压" value={current?.pressure} unit="hPa" />
      <Metric icon={CloudRain} label="过去 24 小时雨量" value={current?.rain} unit="mm" />
    </div>
    <div className="panel-footer">
      <span>{current?.time ? `${formatTime(current.time)}${weather.status === "cached" ? " · 最近记录" : ""}` : wave(weather)}</span>
      <a href={stationUrl} target="_blank" rel="noreferrer">斗门站实况 <ArrowSquareOut size={14} /></a>
    </div>
  </section>;
}

function ForecastPanel({ weather, risk, onOpen }) {
  return <section className="panel forecast-panel">
    <PanelTitle icon={CloudRain} title="未来 24 小时预报" action="详细" onClick={onOpen} />
    <div className="forecast-summary">
      <div><span>{weather?.status === "cached" ? "上次预报 · 累计降雨" : "累计降雨"}</span><strong>{number(risk.total, 1)} <small>mm</small></strong></div>
      <div className="chart-legend">
        <span><i className="legend-rain" />雨量</span>
        <span><i className="legend-probability" />降雨概率</span>
      </div>
    </div>
    <ForecastChart hours={weather?.hourly} />
  </section>;
}

function SoilPanel({ profile, onOpen }) {
  const latest = profile?.days?.at(-1);
  const layers = profile?.layers ?? [];
  return <section className="panel soil-panel">
    <PanelTitle icon={Plant} title="土壤墒情剖面" action="详细" onClick={onOpen} />
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
    </div> : <p className="chart-empty">剖面数据获取中</p>}
    <RootZoneChart days={profile?.days} fieldCapacity={profile?.fieldCapacity?.value} />
    <div className="grade-scale" aria-label="GB/T 20481-2017 土壤相对湿度分级">
      {soilGradeScale.map(({ id, label, color, text }) => <span key={id} style={{ color: text }}><i style={{ background: color }} />{label}</span>)}
      <em>ERA5-Land · {latest ? latest.date : "—"} · 约 5 天滞后</em>
    </div>
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

function RiskPanel({ risk, alerts, onRisk, onArchive, onAlert }) {
  const official = alerts?.alerts ?? [];
  const subtitle = !alerts ? "查询中" : alerts.status !== "current" ? "暂不可查询"
    : official.length ? `${official.length} 条生效` : "当前无生效预警";
  return <section className="panel risk-panel">
    <PanelTitle icon={ShieldWarning} title="官方气象预警" action="全部" onClick={onRisk} />
    {official.length ? <div className="active-alerts">{official.slice(0, 2).map((alert) => <AlertRow key={alert.id} alert={alert} pulse onClick={() => onAlert(alert)} />)}</div>
      : <button type="button" className="official-status" onClick={onRisk}>
        <ShieldCheck size={25} />
        <span><strong>{subtitle}</strong><small>珠海市 / 斗门区{alerts?.fetchedAt ? ` · ${formatTime(alerts.fetchedAt, "hour")} 查询` : ""}</small></span>
      </button>}
    <div className="level-legend" aria-label="预警等级">
      {["blue", "yellow", "orange", "red"].map((color) => <button key={color} type="button" className={`level-badge level-${color}`} onClick={() => onArchive(color)}>{levels[color]}</button>)}
    </div>
    {official.length === 0 && <div className="latest-archive">
      <small>最近归档 · {formatTime(officialArchive[0].startsAt)}</small>
      <AlertRow alert={officialArchive[0]} onClick={() => onAlert(officialArchive[0], true)} />
    </div>}
    <div className="risk-links">
      <button type="button" className={`risk-chip ${risk.high ? "risk-chip-high" : ""}`} onClick={onRisk}
        title={risk.high ? "累计雨量已达排水提示阈值" : "查看农事处置建议"}>
        <span>{risk.high ? "排水提示" : "处置建议"}</span><CaretRight size={13} />
      </button>
      <button type="button" className="risk-chip" onClick={() => onArchive("all")}>
        <span>预警档案</span><span>{officialArchive.length} 条</span>
      </button>
    </div>
  </section>;
}

function FieldPanel({ onOpen }) {
  return <section className="panel field-panel">
    <PanelTitle icon={VideoCamera} title="田间影像" action="档案" onClick={onOpen} />
    <button type="button" className="field-thumbnail" onClick={onOpen} aria-label="查看大濠冲村现场调研照片">
      <img src={overhead} alt="无人机俯拍的大濠冲村农田、沟渠与田间道路" />
      <span className="photo-caption"><Camera size={15} /> 现场调研 · 航拍</span>
    </button>
    <div className="panel-footer"><span>大濠冲村 · 2026-07-13</span><span>{fieldImages.length} 份影像</span></div>
  </section>;
}

function AgroPanel({ agro, onOpen, onReplay }) {
  const balance = agro?.waterBalance;
  const irrigate = balance != null && balance.irrigationRefMm > 0;
  const latestRisk = agro?.risks?.[0];
  return <section className="panel agro-panel">
    <PanelTitle icon={Drop} title="蒸散与灌溉决策" action="详细" onClick={onOpen} />
    <div className="agro-core">
      <div className="agro-et0">
        <span>参考蒸散 ET0</span>
        <CountNumber value={agro?.et0?.latest} digits={2} unit="mm/d" />
        <small>近 30 日均 {number(agro?.et0?.mean30, 2)} mm/d</small>
      </div>
      <div className="agro-balance">
        <div><span>近 10 日降雨</span><strong>{number(balance?.precip, 1)} <small>mm</small></strong></div>
        <div><span>需水 ETc（番茄中期）</span><strong>{number(balance?.etcMid, 1)} <small>mm</small></strong></div>
      </div>
    </div>
    <button type="button" className={`agro-advice ${irrigate ? "agro-advice-irrigate" : ""}`} onClick={onOpen} title="查看蒸散与灌溉决策详情">
      {irrigate ? <><Drop size={17} /> 建议灌溉 {number(balance.irrigationRefMm, 1)} mm ≈ {number(balance.irrigationRefM3PerMu, 1)} m³/亩</>
        : <><ShieldCheck size={17} /> 水分盈余 {number(balance?.surplus, 1)} mm · 暂无需灌溉</>}
    </button>
    <button type="button" className="agro-risk-line" onClick={onOpen} title="查看国标农气事件">
      <WarningCircle size={15} />
      <span>近 90 日国标农气事件 {agro?.risks?.length ?? "—"} 起{latestRisk ? ` · ${latestRisk.type}（${latestRisk.level}）${latestRisk.window}` : " · 无记录"}</span>
    </button>
    <button type="button" className="primary-button" onClick={onReplay}><PlayCircle size={20} /> 番茄田实测回放 <ArrowUpRight size={16} /></button>
  </section>;
}

function Ticker({ alerts, agro, profile }) {
  const items = [];
  const official = alerts?.status === "current" ? alerts.alerts : [];
  if (official.length) {
    for (const alert of official) items.push(`【${levels[alertTone(alert)] ?? "官方"}预警】${alert.title}${alert.area ? ` · ${alert.area}` : ""}`);
  } else if (alerts) {
    items.push("预警值守：珠海市 / 斗门区当前无生效气象预警");
  }
  const balance = agro?.waterBalance;
  if (balance) {
    items.push(balance.irrigationRefMm > 0
      ? `灌溉决策：近 10 日建议灌溉 ${number(balance.irrigationRefMm, 1)} mm（约 ${number(balance.irrigationRefM3PerMu, 1)} m³/亩）`
      : `灌溉决策：近 10 日水分盈余 ${number(balance.surplus, 1)} mm，暂无需灌溉`);
  }
  const latest = profile?.days?.at(-1);
  if (latest && profile?.layers) {
    items.push(`墒情速报：${profile.layers.map(({ id, label }) => `${label} ${gradeOf(latest.grade[id])?.label ?? "—"}`).join("、")}（${latest.date} ERA5-Land）`);
  }
  for (const risk of agro?.risks?.slice(0, 2) ?? []) {
    items.push(`农气记录：${risk.type} ${risk.level} · ${risk.detail}（${risk.standard}）`);
  }
  for (const { risk, alerts: matched } of crossMatches(agro, officialArchive)) {
    items.push(`多源印证：${risk.window.slice(5).replace("-", "/")} ${matched[0].title} ↔ 卫星日雨量 ${risk.detail.replace("日雨量 ", "")}`);
  }
  const term = solarTerm();
  items.push(`农时：${term.name} · ${term.advice}`);
  if (!items.length) items.push("农情监测平台运行中");
  const text = items.join("　　◆　　");
  return <footer className="ticker-bar" aria-label="农情播报">
    <span className="ticker-label"><Broadcast size={15} /> 农情播报</span>
    <div className="ticker-viewport">
      <div className="ticker-track"><span>{text}</span><span aria-hidden="true">{text}</span></div>
    </div>
  </footer>;
}

function Details({ title, onClose, children, wide = false }) {
  const modal = useRef(null);
  useEffect(() => {
    const element = modal.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  return <dialog className={`detail ${wide ? "detail-wide" : ""}`} ref={modal} aria-labelledby="detail-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === modal.current) onClose(); }}>
    <div className="detail-content">
      <header><h2 id="detail-title">{title}</h2><button type="button" className="icon-button" aria-label="关闭详情" onClick={onClose} autoFocus><X size={22} /></button></header>
      {children}
    </div>
  </dialog>;
}

function Source({ label, href }) {
  return <a className="source-link" href={href} target="_blank" rel="noreferrer">{label} <ArrowSquareOut size={15} /></a>;
}

function Metadata({ rows }) {
  return <dl className="metadata">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl>;
}

function WeatherDetails({ weather, variant }) {
  const current = weather?.current;
  const location = weather?.location;
  const hourly = weather?.hourly ?? [];
  const temperatures = hourly.map(({ temp }) => temp).filter(Number.isFinite);
  const gusts = hourly.map(({ gust }) => gust).filter(Number.isFinite);
  const probabilities = hourly.map(({ probability }) => probability).filter(Number.isFinite);
  return <>
    {variant === "forecast" && <ForecastChart hours={weather?.hourly} featured />}
    <Metadata rows={[
      ["数据状态", wave(weather)],
      ["数据来源", <Source label={weather?.source?.name ?? "Open-Meteo"} href={weather?.source?.url ?? "https://open-meteo.com/en/docs"} />],
      ["地区", location?.latitude != null ? `斗门区 · ${location.latitude}° N, ${location.longitude}° E` : "珠海市斗门区"],
      ["天气时刻（北京时间）", formatTime(current?.time, "date")],
      ["接口取数时间", formatTime(weather?.fetchedAt, "date")],
      ...(variant === "forecast" ? [
        ["预报时段", hourly.length ? `${formatTime(hourly[0].time)} 至 ${formatTime(hourly.at(-1).time)}` : "暂无"],
        ["气温范围", temperatures.length ? `${number(Math.min(...temperatures), 1)} 至 ${number(Math.max(...temperatures), 1)} °C` : "—"],
        ["最高降雨概率", probabilities.length ? `${Math.max(...probabilities)}%` : "—"],
        ["最大阵风", gusts.length ? `${number(Math.max(...gusts), 1)} km/h` : "—"],
      ] : []),
    ]} />
    <Source label="查看中国天气网斗门站实况" href={stationUrl} />
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
      <p className="muted">底部滑杆与图内滚轮可放大任意时段；点击图例可显示/隐藏对应土层。</p>
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
      ["数据产品", `${profile.source.name} · 0.1° 网格`],
      ["观测口径", "土壤体积含水量（m³/m³），逐时再分析按日平均"],
      ["时序窗口", `近 ${profile.window.days} 天 · 最新 ${latest.date}（${profile.window.timeZone}）`],
      ["田间持水量", `${profile.fieldCapacity.value.toFixed(2)} m³/m³ · ${profile.fieldCapacity.note}`],
      ["分级依据", `${profile.standard.name} · ${profile.fieldCapacity.formula}`],
      ["数据来源", <Source label={profile.source.name} href={profile.source.url} />],
    ]} />}
    <h3 className="detail-heading">卫星表层对照 · NOAA SMOPS</h3>
    <SoilChart series={satellite?.points} featured daily />
    {satellite && <Metadata rows={[
      ["数据产品", `${satellite.product} · ${satellite.resolution}`],
      ["观测口径", `${satellite.depth} · 体积含水量（%）`],
      ["最新日值", `${satellite.points.at(-1).time.slice(0, 10)}（${satellite.timeZone}）`],
      ["数据来源", <Source label={satellite.source.name} href={satellite.source.url} />],
    ]} />}
    <h3 className="detail-heading">珠三角剖面实测参考</h3>
    <p>{soilReference.site} · {soilReference.dates} · 相对含水量</p>
    <Metadata rows={soilReference.layers.map(([depth, amount]) => [depth, `${amount}%`])} />
    <Source label="中山市农业农村局墒情记录" href={soilReference.url} />
    <button type="button" className="primary-button detail-action" onClick={onReplay}><PlayCircle size={20} /> 查看灌溉与墒情实测曲线 <ArrowUpRight size={16} /></button>
  </>;
}

function AgroDetails({ agro, weather, onReplay }) {
  const balance = agro?.waterBalance;
  const comparison = agro?.comparison;
  const irrigate = balance != null && balance.irrigationRefMm > 0;
  const deltaText = (pct, unit) => pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%${unit ?? ""}`;
  return <>
    <AgroChart daily={agro?.daily} lastYear={agro?.lastYearDaily} featured />
    <p className="muted">拖动底部滑杆或图内滚轮缩放时序；点击图例切换降雨 / ET0 / 去年同期的显示。</p>
    <Metadata rows={[
      ["数据状态", wave(agro)],
      ["输入数据", <Source label={agro?.source?.name ?? "NASA POWER"} href={agro?.source?.url ?? "https://power.larc.nasa.gov/"} />],
      ["计算方法", agro?.method?.et0 ?? "FAO-56 Penman-Monteith"],
      ["作物系数", agro?.method?.kc ?? "FAO-56 表 12"],
      ["最新 ET0", agro?.et0 ? `${number(agro.et0.latest, 2)} mm/d（${agro.et0.latestDate}）` : "—"],
      ["近 30 日均值", `${number(agro?.et0?.mean30, 2)} mm/d`],
      ["有效降雨", agro?.method?.effectiveRain ?? "降雨 × 0.8"],
    ]} />
    {comparison && <h3 className="detail-heading">近 30 日同期同比（vs 去年）</h3>}
    {comparison && <Metadata rows={[
      ["降雨量", `${number(comparison.precip, 1)} mm（去年 ${number(comparison.precipLastYear, 1)} mm · ${deltaText(comparison.precipDeltaPct)}）`],
      ["ET0 均值", `${number(comparison.et0Mean, 2)} mm/d（去年 ${number(comparison.et0MeanLastYear, 2)} mm/d · ${deltaText(comparison.et0DeltaPct)}）`],
      ["对照样本", `${comparison.pairs} 天（NASA POWER 1981 年起存档）`],
    ]} />}
    {agro?.monthly?.length ? <>
      <h3 className="detail-heading">月度气候统计（近 {agro.monthly.length} 个月）</h3>
      <MonthlyChart monthly={agro.monthly} />
      <p className="muted">当月为进行中的统计（天数不齐），NASA POWER LST 日值汇总。</p>
    </> : null}
    <h3 className="detail-heading">近 {balance?.days ?? 10} 日水分平衡</h3>
    <Metadata rows={[
      ["降雨量", `${number(balance?.precip, 1)} mm`],
      ["有效降雨", `${number(balance?.effectiveRain, 1)} mm`],
      ["作物需水 ETc（番茄中期 Kc 1.15）", `${number(balance?.etcMid, 1)} mm`],
      ["水分盈亏（降雨 − ET0）", `${number(balance?.surplus, 1)} mm`],
      ["灌溉参考量", irrigate ? `${number(balance.irrigationRefMm, 1)} mm ≈ ${number(balance.irrigationRefM3PerMu, 1)} m³/亩` : "0（水分盈余，无需灌溉）"],
    ]} />
    <p className="muted">{agro?.method?.irrigation}</p>
    <IrrigationPlanner agro={agro} weather={weather} />
    {agro?.risks?.length ? <>
      <h3 className="detail-heading">国标农气事件扫描（近 {agro.window.days} 日）</h3>
      <div className="agro-risk-list">{agro.risks.map((risk, index) => <div key={index} className="agro-risk-item">
        <strong>{risk.type} · {risk.level}</strong>
        <small>{risk.window}</small>
        <span>{risk.detail}</span>
        <small>{risk.standard}</small>
      </div>)}</div>
    </> : <p className="detail-empty">近 {agro?.window?.days ?? 90} 日未触发国标农气事件阈值。</p>}
    <Source label="FAO-56 灌溉与排水论文（方法原文）" href="https://www.fao.org/4/x0490e/x0490e00.htm" />
    <button type="button" className="primary-button detail-action" onClick={onReplay}><PlayCircle size={20} /> 番茄田灌溉实测回放 <ArrowUpRight size={16} /></button>
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

function AlertArchive({ color, onAlert, onStorm }) {
  const [selected, setSelected] = useState(color ?? "all");
  const items = officialArchive.filter((alert) => selected === "all" || alert.color === selected);
  return <>
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
    <h3 className="detail-heading">多源交叉印证</h3>
    <p>官方预警、农业气象日值与卫星再分析为三个独立来源，以下为同一次降雨过程的对齐记录。</p>
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
          <span>表层相对湿度 {number(soilDay.relative.surface)}% · {surface.label}（ERA5-Land）</span>
        </div>}
      </div>;
    })}
  </>;
}

function RiskDetails({ risk, alerts, agro, profile, onAlert, onArchive }) {
  return <>
    <h3 className="detail-heading">在效预警</h3>
    <p>{alerts?.status !== "current" ? "官方预警暂不可查询，请查阅珠海市官方预警公告。" :
      alerts.alerts.length === 0 ? "本轮查询珠海市及斗门区无生效天气预警。" : `查询到 ${alerts.alerts.length} 条生效预警。`}</p>
    {alerts?.alerts?.map((alert) => <AlertRow alert={alert} key={alert.id} pulse onClick={() => onAlert(alert)} />)}
    {alerts?.fetchedAt && <p className="muted">查询时间 · {formatTime(alerts.fetchedAt, "date")}</p>}
    {alerts?.source && <Source label={alerts.source.name} href={alerts.source.url} />}
    <Source label="珠海市官方预警公告" href={alertUrl} />
    <button type="button" className="row-button archive-link" onClick={() => onArchive("all")}><span>斗门预警档案</span><CaretRight size={16} /></button>
    <h3 className="detail-heading">排水巡查依据</h3>
    <Metadata rows={[
      ["监测范围", "斗门区区域天气参考点"],
      ["判断依据", risk.total == null ? "24 小时预报样本不足" : `24 小时预报累计雨量 ${number(risk.total, 1)} mm${risk.actionable ? "" : "（缓存快照）"}`],
      ["触发条件", "累计雨量 ≥ 50 mm，提示关注农田排水"],
      ["平台判断", risk.high ? "关注农田排水" : risk.actionable ? "未达排水提示阈值" : "等待有效预报"],
    ]} />
    <ActionSteps />
    <CrossValidation agro={agro} profile={profile} onAlert={onAlert} />
    <LedgerTable onAlert={onAlert} />
  </>;
}

function LampDetails() {
  return <>
    <span className="subtle-tag">田间监测站 · 组成部分</span>
    <p className="case-intro">光诱式虫情测报灯：灯诱成虫、端侧拍照计数，经 AI 虫种识别后连同环境数据回传平台，与墒情、气象、预警同屏联动。</p>
    <Metadata rows={[
      ["监测对象", "稻田 / 果园主要害虫成虫（光诱范围依灯位）"],
      ["数据链路", "端侧拍照 → AI 虫种识别 → 平台时序库"],
      ["平台联动", "与墒情分级、气象实况、预警值守同屏，支持防治窗口研判"],
      ["部署安排", "列入基地部署计划，随田间监测站统一实施"],
    ]} />
    <p className="muted">测报灯启用后，虫情密度曲线将与本平台墒情时序同轴展示，支撑“虫情 + 墒情 + 气象”联合研判。</p>
  </>;
}

function StormDetails() {
  return <>
    <span className="subtle-tag">历史案例 · 2025 年 9 月</span>
    <p className="case-intro">台风「桦加沙」外围风雨影响珠海。以土壤栽培果蔬为场景，演示预警后的排水巡查与设施检查。</p>
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

function FieldDetails({ initial }) {
  const [selected, setSelected] = useState(fieldImages.find((image) => image.id === initial) ?? fieldImages[0]);
  return <>
    <figure className="detail-photo gallery-main"><img src={selected.file} alt={selected.alt} />
      <figcaption><strong>{selected.title}</strong><span>{selected.context}</span>
        <Source label="查看大图" href={selected.file} /></figcaption></figure>
    <div className="gallery-grid" aria-label="影像列表">
      {fieldImages.map((image) => <button key={image.id} type="button" aria-pressed={image.id === selected.id} onClick={() => setSelected(image)}>
        <img src={image.file} alt="" loading="lazy" /><span>{image.title}</span>
      </button>)}
    </div>
    {cameraUrl ? <LiveCamera /> : <p className="empty-device"><VideoCamera size={20} /> 现场视频监控</p>}
  </>;
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
function FourQuads({ profile, ndvi, alerts, onOpen }) {
  const latest = profile?.days?.at(-1);
  const scenes = ndvi?.scenes ?? [];
  const last = scenes.at(-1);
  const prev = scenes.at(-2);
  const trend = last && prev && Number.isFinite(last.ndvi.overall) && Number.isFinite(prev.ndvi.overall)
    ? last.ndvi.overall - prev.ndvi.overall : null;
  const TrendIcon = trend == null ? null : trend >= 0 ? ChartLineUp : ChartLineDown;
  const official = alerts?.status === "current" ? alerts.alerts : null;
  const disaster = !alerts ? { text: "查询中" }
    : official == null ? { text: "暂不可查" }
    : official.length ? { text: `${official.length} 条生效`, tone: "trend-down" }
      : { text: "无生效", tone: "trend-up" };
  return <div className="four-quads" aria-label="四情监测">
    <button type="button" onClick={() => onOpen("soil")} title="查看土壤墒情剖面">
      <Drop size={16} /><span>墒情</span>
      {latest ? <GradeBadge grade={latest.grade.root} /> : <small>获取中</small>}
    </button>
    <button type="button" onClick={() => onOpen("ndvi")} title="查看 NDVI 长势时序">
      <Leaf size={16} /><span>苗情</span>
      {last ? <small>NDVI {last.ndvi.overall.toFixed(2)}{TrendIcon && <TrendIcon size={13} className={trend >= 0 ? "trend-up" : "trend-down"} />}</small>
        : <small>待更新</small>}
    </button>
    <button type="button" className="quad-pending" onClick={() => onOpen("lamp")} title="查看虫情测报灯部署方案">
      <Bug size={16} /><span>虫情</span><small>测报灯</small>
    </button>
    <button type="button" onClick={() => onOpen("risk")} title="查看预警值守">
      <ShieldWarning size={16} /><span>灾情</span>
      <small className={disaster.tone ?? ""}>{disaster.text}</small>
    </button>
  </div>;
}

function NdviDetails({ ndvi }) {
  const scenes = ndvi?.scenes ?? [];
  const last = scenes.at(-1);
  return <>
    <NdviChart scenes={scenes} featured />
    {last && <Metadata rows={[
      ["最新一期", `${last.date} · 云量 ${last.cloudCover.toFixed(0)}% · ${last.tile}`],
      ["最新 NDVI", `大濠冲 ${last.ndvi.dahao.toFixed(3)} · 小濠冲 ${last.ndvi.xiaohao.toFixed(3)} · 片区 ${last.ndvi.overall.toFixed(3)}`],
      ["时序长度", `${scenes.length} 景（${scenes[0].date} 至 ${last.date}，云量 < 30%）`],
      ["观测窗口", "两村各 640 m × 640 m，片区 2.6 km × 2.6 km"],
      ["计算方法", ndvi.source.method],
      ["数据来源", <Source label={ndvi.source.name} href={ndvi.source.url} />],
      ["快照生成", formatTime(ndvi.generatedAt, "date")],
    ]} />}
    <p className="muted">NDVI 反映植被绿度与长势：稻田在分蘖–灌浆期升高、收获前后回落。更新可执行 node scripts/refresh-ndvi.mjs 重新拉取。</p>
  </>;
}

function VillageDetails({ village, onField }) {
  return <>
    <span className="subtle-tag">珠海市 · 斗门区 · 斗门镇</span>
    <p className="case-intro">{village.summary}</p>
    <ul className="village-points">
      {(villageHighlights[village.id] ?? []).map((point) => <li key={point}>{point}</li>)}
    </ul>
    <Metadata rows={[["调研内容", village.label], ["点位类别", "村级调研参考点"], ["资料来源", village.source], ["田间监测站", "列入基地部署计划"]]} />
    <button type="button" className="primary-button" onClick={() => onField(village.id === "dahao" ? "planning" : "tenure")}>
      <Camera size={20} />{village.id === "dahao" ? "查看空间布局专题图" : "查看土名地界划分图"}<ArrowUpRight size={17} />
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
    <PanelTitle icon={Plant} title="作物农事日历" />
    <div className="calendar-grid" role="table" aria-label="作物 × 月份农事矩阵">
      <span className="cal-head" />
      {Array.from({ length: 12 }, (_, index) => <span key={index} className={`cal-head ${index + 1 === month ? "cal-now" : ""}`}>{index + 1}月</span>)}
      {cropCalendar.crops.map(({ name, months }) => <Fragment key={name}>
        <span className="cal-crop">{name}</span>
        {months.map((stage, index) => <span key={index} title={`${name} · ${index + 1}月${stage ? ` · ${stage}` : " · 休闲"}`}
          className={`cal-cell ${index + 1 === month ? "cal-now" : ""} ${stage ? "" : "cal-idle"}`}
          style={stage ? { background: tint(tone(stage), 0.26), borderColor: tone(stage), color: tone(stage) } : undefined}>
          {stage ?? "—"}
        </span>)}
      </Fragment>)}
    </div>
    <p className="crop-note">{cropCalendar.note}；当前月份列已高亮，悬停查看各月农事。</p>
  </section>;
}

function ProductionRecords({ onField, onRisk }) {
  return <section className="production-records" id="production-records" aria-label="斗门生产档案">
    <div className="record-head"><div><h2>斗门生产档案</h2><p>农事日历、农业统计、现场巡查与技术依据</p></div>
      <button type="button" className="text-button" onClick={onRisk}>查看农事处置 <CaretRight size={16} /></button></div>
    <CropCalendar />
    <div className="production-grid">
      <section className="panel production-stats">
        <PanelTitle icon={ChartBar} title="2025 年斗门农业统计" />
        <div className="statistics">{doumenStatistics.results.map(({ label, value, unit, growth }) => <div key={label}>
          <span>{label}</span><strong>{value} <small>{unit}</small></strong>{growth && <small>同比 {growth}</small>}
        </div>)}</div>
        <YieldChart items={doumenStatistics.results.filter(({ label }) => label.includes("产量")).map(({ label, value }) => ({ label: label.replace("产量", ""), value: Number(value) }))} unit=" 万吨" />
        <Source label={doumenStatistics.source} href={doumenStatistics.url} />
      </section>
      <section className="panel production-notes">
        <PanelTitle icon={FileText} title="农业管护资料" />
        {localReferences.map(({ title, context, summary, source, url }) => <article key={title}>
          <div><h3>{title}</h3><small>{context}</small></div><p>{summary}</p><Source label={source} href={url} />
        </article>)}
      </section>
      <section className="panel production-imagery">
        <PanelTitle icon={Images} title="重点影像" action="影像档案" onClick={() => onField("aerial")} />
        {fieldImages.filter(({ id }) => ["ground", "planning", "tenure", "xiaohao", "roads-aerial", "tower-pond"].includes(id)).map((image) => <button type="button" onClick={() => onField(image.id)} key={image.id}>
          <img src={image.file} alt="" loading="lazy" /><span><strong>{image.title}</strong><small>{image.context}</small></span><CaretRight size={16} />
        </button>)}
      </section>
    </div>
  </section>;
}

function ReportTable({ head, rows }) {
  return <table className="report-table">
    <thead><tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody>
  </table>;
}

function DailyReport({ observations, weather, profile, agro, alerts, risk, onClose }) {
  const current = observations?.current;
  const latest = profile?.days?.at(-1);
  const balance = agro?.waterBalance;
  const official = alerts?.alerts ?? [];
  const irrigate = balance != null && balance.irrigationRefMm > 0;
  const term = solarTerm();
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, dateStyle: "full" }).format(new Date());
  const layerRow = ({ id, depth, label }) => latest ? [
    `${label} ${depth}`,
    `${number(latest.moisture[id], 1)}%`,
    `${number(latest.relative[id])}%`,
    <GradeBadge grade={latest.grade[id]} key={id} />,
  ] : null;
  return <div className="report-overlay" role="dialog" aria-modal="true" aria-label="农情日报">
    <div className="report-sheet">
      <header className="report-head">
        <div>
          <h2>斗门智慧农田 · 农情日报</h2>
          <p>{date} · {term.name}第 {term.daysIn} 天 · 数据自动汇总</p>
        </div>
        <div className="report-actions">
          <button type="button" onClick={() => window.print()}>打印 / 导出 PDF</button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </header>

      <section className="report-section">
        <h3>一、气象实况与预报</h3>
        <ReportTable head={["项目", "数值", "项目", "数值"]} rows={[
          ["气温", `${number(current?.temp, 1)} °C`, "相对湿度", `${number(current?.humidity)} %`],
          ["风速", `${number(current?.wind, 1)} km/h`, "气压", `${number(current?.pressure)} hPa`],
          ["过去 24 小时雨量", `${number(current?.rain, 1)} mm`, "未来 24 小时累计雨量", risk.total == null ? "样本不足" : `${number(risk.total, 1)} mm`],
        ]} />
        <p className="report-note">实况来自中国天气网斗门站（101280702）；预报来自 Open-Meteo 斗门参考点（22.21° N, 113.30° E）。
          {risk.high ? "未来 24 小时累计雨量达到排水提示阈值，需关注农田排水。" : "未来 24 小时未达排水提示阈值（50 mm）。"}</p>
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
          ["参考蒸散 ET0（最新）", `${number(agro?.et0?.latest, 2)} mm/d（${agro?.et0?.latestDate ?? "—"}）`],
          ["近 30 日 ET0 均值", `${number(agro?.et0?.mean30, 2)} mm/d`],
          ["近 10 日降雨 / 有效降雨", `${number(balance?.precip, 1)} mm / ${number(balance?.effectiveRain, 1)} mm`],
          ["近 10 日作物需水 ETc（番茄中期）", `${number(balance?.etcMid, 1)} mm`],
          ["灌溉参考", irrigate ? `建议灌溉 ${number(balance.irrigationRefMm, 1)} mm ≈ ${number(balance.irrigationRefM3PerMu, 1)} m³/亩` : "水分盈余，暂无需灌溉"],
        ]} />
        <p className="report-note">输入为 NASA POWER 农业气象日值，ET0 按 FAO-56 Penman-Monteith 计算，有效降雨按 0.8 计。</p>
      </section>

      <section className="report-section">
        <h3>四、预警与农气事件</h3>
        {official.length ? <div className="report-alerts">{official.map((alert) => <p key={alert.id}>
          <LevelBadge alert={alert} /> {alert.title} · {alert.area ?? "见原文"} · {formatTime(alert.startsAt, "date")} 发布</p>)}</div>
          : <p>当前无生效气象预警（{alerts ? `${formatTime(alerts.fetchedAt, "date")} 查询` : "查询中"}）。</p>}
        {agro?.risks?.length ? <ReportTable head={["日期", "事件", "等级", "依据"]}
          rows={agro.risks.map((item) => [item.window, item.type, item.level, item.standard])} /> : <p>近 90 日未触发国标农气事件阈值。</p>}
        {crossMatches(agro, officialArchive).length ? <p className="report-note">多源印证：{crossMatches(agro, officialArchive)
          .map(({ risk: item, alerts: matched }) => `${item.window} ${matched[0].title}与卫星日雨量 ${item.detail.replace("日雨量 ", "")}互证`).join("；")}。</p> : null}
      </section>

      <section className="report-section">
        <h3>五、农事建议</h3>
        <ol className="report-advice">
          <li><strong>农时</strong>：{term.name} · {term.advice}（距{term.nextName} {term.daysToNext} 天）。</li>
          <li><strong>水分管理</strong>：{irrigate
            ? `近 10 日水分亏缺，建议按 ${number(balance.irrigationRefMm, 1)} mm 安排灌溉。`
            : `近 10 日水分盈余 ${number(balance?.surplus, 1)} mm，以清沟排水、防止渍害为主。`}</li>
          <li><strong>巡查重点</strong>：{risk.high ? "关注低洼地块积水与排水沟渠畅通。" : "常规巡查田埂、沟渠与设施固定件。"}</li>
        </ol>
      </section>

      <footer className="report-foot">
        <p>数据来源：中国天气网 · Open-Meteo（ERA5-Land / ECMWF）· NOAA CPC SMOPS · NASA POWER · FAO-56 · GB/T 20481-2017</p>
        <p>生成时间：{new Intl.DateTimeFormat("zh-CN", { timeZone: shanghai, dateStyle: "short", timeStyle: "medium", hourCycle: "h23" }).format(new Date())} · 斗门智慧农田监测平台</p>
      </footer>
    </div>
  </div>;
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

function DataLinksBar({ sources, onOpen }) {
  const now = useNow();
  return <footer className="datalinks-bar" aria-label="数据链路自检">
    <span className="datalinks-label"><Database size={14} /> 数据链路</span>
    <div className="datalinks-items">
      {sources.map(({ key, label, status, time }) => <button key={key} type="button" className="datalinks-item" onClick={onOpen}
        title={`${label} · ${status === "current" ? "实时" : status === "cached" ? "缓存快照" : "等待数据"}`}>
        <i className={`datalinks-dot ${status ?? "loading"}`} />
        <span>{label}</span>
        <small>{relTime(time, now)}</small>
      </button>)}
    </div>
    <button type="button" className="text-button" onClick={onOpen}>链路详情 <CaretRight size={13} /></button>
  </footer>;
}

function DataLinksDetails({ sources }) {
  const now = useNow();
  return <>
    <p>平台七条数据链路相互独立，任一链路异常时自动降级为缓存快照并在条上标注，取数口径互为印证。</p>
    <Metadata rows={sources.map(({ label, role, time, fetchedAt, cycle, status }) => [
      label,
      <>{role}<br /><small className={status === "current" ? "link-live" : "link-stale"}>
        最新数据 {relTime(time, now)}{fetchedAt ? ` · 取数 ${formatTime(fetchedAt, "hour")}` : ""} · 自动刷新 {cycle}
      </small></>,
    ])} />
    <p className="muted">「实时」= 本轮取数成功；「缓存快照」= 接口暂不可达，展示最近一次成功快照；点值延迟由上游发布节奏决定（ERA5-Land 约 5 天，NDVI 随卫星过境 5–10 天）。</p>
    <Source label="中国天气网 · 斗门站" href={stationUrl} />
    <Source label="Open-Meteo 预报接口" href="https://open-meteo.com/en/docs" />
    <Source label="NASA POWER 农业气象" href="https://power.larc.nasa.gov/" />
  </>;
}

// ============ 灌溉决策计算器 ============
// 输入全部来自平台真实数据：灌溉参考量（近 10 日 FAO-56 水分平衡）、日均作物需水 ETc；
// 面积与泵额定流量由用户按本地实际调整，输出为工程换算结果。
function IrrigationPlanner({ agro, weather }) {
  const balance = agro?.waterBalance;
  const [area, setArea] = useState(50);
  const [flow, setFlow] = useState(20);
  const pumps = 2;
  if (!balance) return null;
  const refMm = Math.max(0, balance.irrigationRefMm ?? 0);
  const etcDaily = balance.days > 0 ? (balance.etcMid ?? 0) / balance.days : 0;
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
    <p className="muted">按当前水分平衡得出的灌溉参考量 {number(refMm, 1)} mm（日均作物需水 {number(etcDaily, 2)} mm/d），
      结合本地地块面积与水泵额定流量换算作业方案。1 mm ≈ 0.667 m³/亩。</p>
    <div className="planner">
      {slider("地块面积", area, 5, 500, 5, "亩", setArea, "按实际种植范围调整")}
      {slider("单泵额定流量", flow, 5, 80, 5, "m³/h", setFlow, `${pumps} 泵并行 · 合计 ${flow * pumps} m³/h`)}
      <div className="planner-results">
        <div><span>本次灌溉总量</span><strong>{number(totalM3, 0)} <small>m³</small></strong></div>
        <div><span>{pumps} 泵并行需时</span><strong>{Number.isFinite(hours)
          ? <>{number(hours, 1)} <small>h</small>{hours >= 24 ? ` ≈ ${number(hours / 24, 1)} 天` : ""}</> : "—"}</strong></div>
        <div><span>该水量可覆盖</span><strong>{Number.isFinite(coverDays) ? number(coverDays, 1) : "—"} <small>天</small></strong></div>
      </div>
      <p className={`planner-note ${rainySoon ? "planner-note-rain" : ""}`}>
        {rainySoon
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
    <p className="muted">逐条登记历史预警的处置状态，登记结果保存在本机值班浏览器中，交接时可直接展示处置进度。</p>
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
    <span className="subtle-tag">大濠冲村 · 西部沿海高速旁</span>
    <p className="case-intro">{PILOT_FIELD.note}。地块几何信息按图上边界实时换算，墒情与植被指数引用平台监测结论。</p>
    <Metadata rows={[
      ["图上面积", `≈ ${number(mu, 1)} 亩（${number(mu * 666.67, 0)} m²）· 依勾绘边界`],
      ["中心坐标", `${centerLat.toFixed(5)}° N, ${centerLon.toFixed(5)}° E`],
      ["根区墒情（7–28 cm）", latest ? `${number(latest.moisture.root, 1)}% · 相对湿度 ${number(latest.relative.root)}%` : "—"],
      ["墒情等级", rootGrade ? `${rootGrade.label}（GB/T 20481-2017 · ${latest.date} ERA5-Land）` : "—"],
      ["植被指数", scene?.ndvi?.overall != null ? `NDVI ${scene.ndvi.overall.toFixed(2)}（${scene.date} Sentinel-2）` : "—"],
      ["种植场景", "土壤栽培果蔬 · 参考作物番茄（FAO-56 表 12，中期 Kc 1.15）"],
    ]} />
    <div className="plot-links">
      <button type="button" className="risk-chip" onClick={onSoil}><span>墒情监测详情</span><CaretRight size={13} /></button>
      <button type="button" className="risk-chip" onClick={() => onField("planning")}><span>空间布局专题图</span><CaretRight size={13} /></button>
      <button type="button" className="risk-chip" onClick={onReplay}><span>灌溉实测回放</span><CaretRight size={13} /></button>
    </div>
    <p className="muted">面积按勾绘边界换算，实际施工边界以现场测量为准；监测值为 ERA5-Land 0.1° 网格在斗门镇的参考结论。</p>
  </>;
}

// ============ 键盘快捷键 ============
const SHORTCUTS = [
  ["1", "回到农情总览"], ["2", "预警值守"], ["3", "灌溉回放"], ["4", "跳到生产档案"],
  ["R", "生成农情日报"], ["D", "数据链路自检"], ["F", "全屏 / 退出全屏"], ["?", "本帮助"], ["Esc", "关闭当前弹层"],
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

export function App() {
  const weather = useReading("/api/weather", 900_000, "/data/weather-snapshot.json");
  const observations = useReading("/api/observations", 300_000, "/data/observations-snapshot.json");
  const profile = useReading("/api/soil-profile", 3_600_000, "/data/soil-profile-snapshot.json");
  const agro = useReading("/api/agro", 3_600_000, "/data/agro-snapshot.json");
  const satelliteSoil = useReading("/data/doumen-satellite-soil.json", 3_600_000);
  const ndvi = useReading("/data/ndvi-history.json", 3_600_000);
  const alerts = useActiveAlerts(useReading("/api/alerts", 300_000));
  const [view, setView] = useState(null);
  const [mapView, setMapView] = useState("map");
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [report, setReport] = useState(false);
  const risk = rainRisk(weather);
  const open = (type, options) => setView({ type, ...options });
  const openAlert = (alert, archived = false) => open("alert", { alert, archived });
  const openArchive = (color) => open("archive", { color });
  const openField = (photoId) => open("field", { photoId });
  const riskPages = ["risk", "storm", "alert", "archive"];
  const titles = { weather: "斗门天气实况", forecast: "未来 24 小时预报", soil: "土壤墒情监测",
    ndvi: "苗情长势（NDVI）", agro: "蒸散与灌溉决策", risk: "预警值守与农事处置", storm: "台风「桦加沙」", field: "斗门田间影像档案", replay: "番茄田实测回放",
    map: "卫星底图与调研点位", archive: "斗门官方预警档案", alert: view?.archived ? "历史预警详情" : "在效预警详情",
    plot: PILOT_FIELD.name, links: "数据链路自检", help: "键盘快捷键", lamp: "虫情测报灯 · 部署方案" };
  const dataLinks = [
    { key: "obs", label: "斗门站实况", role: "中国天气网 · 站点 101280702", status: observations?.status, time: observations?.current?.time ?? observations?.fetchedAt, fetchedAt: observations?.fetchedAt, cycle: "5 分钟" },
    { key: "wx", label: "逐时预报", role: "Open-Meteo · 斗门参考点 22.21°N 113.30°E", status: weather?.status, time: weather?.fetchedAt, fetchedAt: weather?.fetchedAt, cycle: "15 分钟" },
    { key: "soil", label: "土壤剖面", role: "ECMWF ERA5-Land · 0.1° 网格", status: profile?.status, time: profile?.days?.at(-1)?.date ? `${profile.days.at(-1).date}T00:00:00+08:00` : null, fetchedAt: profile?.fetchedAt, cycle: "1 小时", note: "日值约 5 天滞后" },
    { key: "agro", label: "农业气象", role: "NASA POWER · FAO-56 Penman-Monteith", status: agro?.status, time: agro?.et0?.latestDate ? `${agro.et0.latestDate}T00:00:00+08:00` : null, fetchedAt: agro?.fetchedAt, cycle: "1 小时" },
    { key: "sat", label: "卫星表层", role: "NOAA CPC SMOPS · 9–27 cm", status: satelliteSoil?.points?.length ? "current" : null, time: satelliteSoil?.points?.at(-1)?.time, cycle: "1 小时" },
    { key: "ndvi", label: "植被指数", role: "Sentinel-2 · Microsoft Planetary Computer", status: ndvi?.scenes?.length ? "current" : null, time: ndvi?.generatedAt, cycle: "1 小时", note: "随卫星过境 5–10 天" },
    { key: "alerts", label: "官方预警", role: "珠海市 / 斗门区 · 多渠道聚合", status: alerts?.status, time: alerts?.fetchedAt, fetchedAt: alerts?.fetchedAt, cycle: "5 分钟" },
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
      if (key === "1") { setView(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else if (key === "2") setView({ type: "risk" });
      else if (key === "3") setView({ type: "replay" });
      else if (key === "4") document.getElementById("production-records")?.scrollIntoView({ behavior: "smooth" });
      else if (key === "r") setReport(true);
      else if (key === "d") setView({ type: "links" });
      else if (key === "f") toggleFullscreen();
      else if (key === "?") setView({ type: "help" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 农情日报：Esc 关闭。
  useEffect(() => {
    if (!report) return undefined;
    const closeByKey = (event) => { if (event.key === "Escape") setReport(false); };
    document.addEventListener("keydown", closeByKey);
    return () => document.removeEventListener("keydown", closeByKey);
  }, [report]);
  async function toggleFullscreen() {
    setScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setScreenError("当前预览无法开启全屏，请使用浏览器的全屏功能。"); }
  }

  return <>
    {report && <DailyReport observations={observations} weather={weather} profile={profile} agro={agro}
      alerts={alerts} risk={risk} onClose={() => setReport(false)} />}
    <header className="app-header">
      <div className="wordmark"><span className="brand-mark"><Plant size={25} weight="bold" /></span>
        <div><strong>斗门智慧农田</strong><small>珠海 · 斗门区</small></div>
      </div>
      <nav className="top-nav" aria-label="大屏导航">
        <button type="button" className={!["replay", "field", ...riskPages].includes(view?.type) ? "active" : ""} onClick={() => {
          setView(null);
          if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
          window.scrollTo({ top: 0 });
        }}>
          <MapTrifold size={18} /> 农情总览
        </button>
        <button type="button" className={riskPages.includes(view?.type) ? "active" : ""} onClick={() => open("risk")}><ShieldWarning size={18} /> 预警值守</button>
        <button type="button" className={view?.type === "replay" ? "active" : ""} onClick={() => open("replay")}><Drop size={18} /> 灌溉回放</button>
        <a href="#production-records"><FileText size={18} /> 生产档案</a>
      </nav>
      <div className="header-tools"><ClockDisplay />
        <button type="button" className="fullscreen-button shortcuts-button" onClick={() => open("help")}
          title="键盘快捷键（按 ? 查看全部）">
          <Keyboard size={16} />
        </button>
        <button type="button" className="fullscreen-button" onClick={toggleFullscreen}>
          <Scan size={18} /> <span>{fullscreen ? "退出全屏" : "全屏"}</span>
        </button></div>
    </header>

    <main className="dashboard">
      <div className="dashboard-head">
        <div><h1>斗门区农情监测中心</h1><p>斗门镇 · 大濠冲村 / 小濠冲村 · 卫星、再分析与官方预警多源联测</p></div>
        <div className="head-side">
          <TermChip />
          <button type="button" className="report-button" onClick={() => setReport(true)} title="自动汇总当日农情，支持打印导出">
            <FileText size={16} /> 农情日报
          </button>
          <div className={`connection ${observations?.status ?? "loading"}`} role="status">
            <i /> <span>{observations?.status === "current" ? "斗门气象实况" : wave(observations)}</span>
            {observations?.current?.time && <small>{formatTime(observations.current.time)} 发布</small>}
          </div>
        </div>
      </div>
      <KpiStrip observations={observations} profile={profile} agro={agro} alerts={alerts} onOpen={open} />
      {screenError && <p className="screen-error" role="status">{screenError}</p>}

      <div className="board-grid">
        <aside className="board-column readings" aria-label="天气和墒情">
          <WeatherPanel weather={observations} onOpen={() => open("weather")} />
          <SoilPanel profile={profile} onOpen={() => open("soil")} />
          <ForecastPanel weather={weather} risk={risk} onOpen={() => open("forecast")} />
        </aside>
        <section className="panel map-panel">
          <div className="map-panel-header">
            <PanelTitle icon={mapView === "map" ? MapTrifold : Camera} title={mapView === "map" ? "农田地理态势" : "大濠冲村农田航拍"} />
            <div className="map-switch" role="group" aria-label="地图与航拍">
              <button type="button" aria-pressed={mapView === "map"} onClick={() => setMapView("map")}>卫星底图</button>
              <button type="button" aria-pressed={mapView === "aerial"} onClick={() => setMapView("aerial")}>农田航拍</button>
            </div>
          </div>
          {mapView === "map" ? <FieldMap onVillage={(village) => open("village", { village })} onMapInfo={() => open("map")} onPlot={() => open("plot")} />
            : <figure className="map-stage aerial-stage">
              <img src={aerial} alt="2026 年 7 月 13 日无人机拍摄的真实大濠冲村农田与沟渠" />
              <figcaption className="map-key"><Camera size={15} /> 大濠冲村 · 2026-07-13</figcaption>
            </figure>}
          <FourQuads profile={profile} ndvi={ndvi} alerts={alerts} onOpen={open} />
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
          <RiskPanel risk={risk} alerts={alerts} onRisk={() => open("risk")} onArchive={openArchive} onAlert={openAlert} />
          <AgroPanel agro={agro} onOpen={() => open("agro")} onReplay={() => open("replay")} />
          <FieldPanel onOpen={() => openField("overhead")} />
        </aside>
      </div>
      <DataLinksBar sources={dataLinks} onOpen={() => open("links")} />
      <Ticker alerts={alerts} agro={agro} profile={profile} />
      <footer className="app-footer">
        <span><Monitor size={15} /> 珠海斗门智慧农田监测</span>
        <span><Clock size={15} /> 北京时间 <span className="footer-divider">/</span> <a href={stationUrl} target="_blank" rel="noreferrer">中国天气网</a> <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> <a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">NASA POWER</a></span>
      </footer>
      <ProductionRecords onField={openField} onRisk={() => open("risk")} />
    </main>

    {view && <Details key={view.type} title={view.village?.name ?? titles[view.type]} wide={["field", "replay"].includes(view.type)} onClose={() => setView(null)}>
      {["weather", "forecast"].includes(view.type) && <WeatherDetails weather={view.type === "weather" ? observations : weather} variant={view.type} />}
      {view.type === "soil" && <SoilDetails profile={profile} satellite={satelliteSoil} onReplay={() => open("replay")} />}
      {view.type === "ndvi" && <NdviDetails ndvi={ndvi} />}
      {view.type === "agro" && <AgroDetails agro={agro} weather={weather} onReplay={() => open("replay")} />}
      {view.type === "risk" && <RiskDetails risk={risk} alerts={alerts} agro={agro} profile={profile} onAlert={openAlert} onArchive={openArchive} />}
      {view.type === "archive" && <AlertArchive color={view.color} onAlert={openAlert} onStorm={() => open("storm")} />}
      {view.type === "alert" && <AlertDetail alert={view.alert} archived={view.archived} />}
      {view.type === "storm" && <StormDetails />}
      {view.type === "field" && <FieldDetails initial={view.photoId} />}
      {view.type === "replay" && <ReplayDetails />}
      {view.type === "village" && <VillageDetails village={view.village} onField={openField} />}
      {view.type === "plot" && <PlotDetails profile={profile} ndvi={ndvi} onSoil={() => open("soil")} onField={openField} onReplay={() => open("replay")} />}
      {view.type === "links" && <DataLinksDetails sources={dataLinks} />}
      {view.type === "help" && <ShortcutsHelp />}
      {view.type === "lamp" && <LampDetails />}
      {view.type === "map" && <>
        <Metadata rows={[
          ["卫星影像", "Sentinel-2 · 2025 年自然色合成 · EOxCloudless"],
          ["影像许可", <Source label="CC BY-NC-SA 4.0" href="https://cloudless.eox.at/license-non-commercial" />],
          ["调研底图", "2018 年斗门区地图局部 · 粤S（2018）022号 · 广东省国土资源厅监制"],
          ["图上点位", "大濠冲村、小濠冲村调研位置"],
        ]} />
        <Source label="查看调研底图原图" href={asset("/media/doumen-survey-map.jpg")} />
        <p className="muted">村级参考点来自 OpenStreetMap。</p>
        <Source label="大濠冲村 POI" href="https://www.openstreetmap.org/node/2065808394" />
        <Source label="小濠冲村 POI" href="https://www.openstreetmap.org/node/2065814027" />
      </>}
    </Details>}
  </>;
}
