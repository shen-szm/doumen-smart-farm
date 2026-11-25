import { useEffect, useRef } from "react";
import { init, use } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatTime, replayTime } from "./data.js";

use([BarChart, LineChart, PieChart, AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const mint = "#7ad3d0";
const blue = "#85abc7";
const gold = "#e2b369";
const label = "#a7bdcc";
const gridLine = "#304657";
const layerColors = { surface: "#7ad3d0", root: "#58c98a", deep: "#85abc7" };
const tooltip = {
  trigger: "axis", confine: true, appendToBody: false, backgroundColor: "#172d3b",
  borderColor: "#436779", textStyle: { color: "#f2f8fa" },
};
const axisText = { color: label, fontSize: 12, hideOverlap: true };
const base = {
  animation: true,
  animationDuration: 900,
  animationEasing: "cubicOut",
  aria: { enabled: true },
  textStyle: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif' },
  tooltip,
};
const axis = {
  axisLabel: axisText, axisLine: { lineStyle: { color: gridLine } }, axisTick: { show: false },
};
const yAxis = { ...axis, splitLine: { lineStyle: { color: gridLine, type: "dashed" } } };
// featured 大图的时间缩放：底部滑杆 + 图内滚轮/框选，用于细看任意时段。
// 配套把 grid.bottom 加高约 24px 给滑杆留位（各图表显式声明）。
const zoom = (featured) => featured ? {
  dataZoom: [
    { type: "inside", start: 0, end: 100, zoomOnMouseWheel: true },
    {
      type: "slider", height: 15, bottom: 4, start: 0, end: 100,
      borderColor: gridLine, backgroundColor: "#12222e",
      fillerColor: "rgba(122,211,208,.14)",
      handleStyle: { color: "#2c4a5e", borderColor: mint },
      moveHandleStyle: { color: "#2c4a5e" },
      dataBackground: { lineStyle: { color: "#3f6b85" }, areaStyle: { color: "rgba(63,107,133,.14)" } },
      selectedDataBackground: { lineStyle: { color: mint }, areaStyle: { color: "rgba(122,211,208,.18)" } },
      textStyle: { color: label, fontSize: 10 },
    },
  ],
} : {};

function Chart({ option, label, className = "" }) {
  const element = useRef(null);
  const chart = useRef(null);
  const latestOption = useRef(option);
  useEffect(() => {
    const target = element.current;
    const fit = () => {
      if (!target.clientWidth || !target.clientHeight) return;
      if (chart.current) {
        chart.current.resize();
      } else {
        chart.current = init(target, null, { renderer: "canvas" });
        chart.current.setOption(latestOption.current, { notMerge: true });
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => { observer.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    if (latestOption.current === option) return;
    latestOption.current = option;
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  return <div className={`chart ${className}`} ref={element} role="img" aria-label={label} />;
}

const timeNames = (points) => points.map(({ time }) => formatTime(time, "hour"));
const dayNames = (days) => days.map(({ date }) => date.slice(5, 10).replace("-", "/"));
const line = (name, data, color, other) => ({
  name, type: "line", data, showSymbol: false, connectNulls: false,
  lineStyle: { color, width: 2 }, itemStyle: { color }, ...other,
});

export function ObservationChart({ hours = [], className }) {
  if (!hours.length) return <p className="chart-empty">暂无斗门站整点记录</p>;
  return <Chart className={className ?? "detail-chart"} label="斗门站逐小时气温与相对湿度" option={{
    ...base,
    grid: { left: 44, right: 45, top: 40, bottom: 28 },
    legend: { data: ["气温", "相对湿度"], textStyle: { color: label } },
    xAxis: { ...axis, type: "time", axisLabel: { ...axisText, formatter: (value) => formatTime(value, "hour") } },
    yAxis: [
      { ...yAxis, type: "value", scale: true, axisLabel: { ...axisText, formatter: "{value}°" } },
      { ...axis, type: "value", min: 0, max: 100, splitNumber: 4, axisLabel: { ...axisText, formatter: "{value}%" } },
    ],
    series: [
      line("气温", hours.map(({ time, temp }) => [time, temp]), gold,
        { tooltip: { valueFormatter: (value) => value == null ? "缺测" : `${value} °C` } }),
      line("相对湿度", hours.map(({ time, humidity }) => [time, humidity]), mint,
        { yAxisIndex: 1, tooltip: { valueFormatter: (value) => value == null ? "缺测" : `${value}%` } }),
    ],
  }} />;
}

export function ForecastChart({ hours = [], featured = false, empty = "暂无逐小时降雨数据" }) {
  if (!hours.some((point) => point.rain != null || point.probability != null)) {
    return <p className="chart-empty">{empty}</p>;
  }
  return <Chart className={featured ? "detail-chart" : "forecast-chart"} label="未来24小时降雨量和降雨概率" option={{
    ...base,
    grid: { left: 30, right: 37, top: 14, bottom: 24 },
    xAxis: { ...axis, type: "category", data: timeNames(hours), axisLabel: { ...axisText, interval: 5 } },
    yAxis: [
      { ...yAxis, type: "value", min: 0, minInterval: 1, splitNumber: 3 },
      { ...axis, position: "right", type: "value", min: 0, max: 100, splitNumber: 2,
        splitLine: { show: false }, axisLabel: { ...axisText, formatter: "{value}%" } },
    ],
    series: [
      { name: "雨量", type: "bar", data: hours.map((hour) => hour.rain), barMaxWidth: 15,
        itemStyle: { color: mint, borderRadius: [2, 2, 0, 0] },
        animationDelay: (index) => index * 40,
        tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v} mm` } },
      line("降雨概率", hours.map((hour) => hour.probability), blue, {
        yAxisIndex: 1, animationDuration: 1400, animationEasing: "quadraticOut",
        tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v}%` },
      }),
    ],
  }} />;
}

export function SoilChart({ series = [], featured = false, daily = false, className }) {
  if (!series.some((point) => point.moisture != null)) return <p className="chart-empty">暂无区域墒情时序</p>;
  return <Chart className={className ?? (featured ? "detail-chart" : "soil-chart")} label="土壤体积含水量趋势" option={{
    ...base,
    grid: { left: 36, right: 9, top: 8, bottom: 23 },
    xAxis: { ...axis, type: "category", boundaryGap: false, data: daily ? series.map(({ time }) => time.slice(5, 10).replace("-", "/")) : timeNames(series),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(series.length / 4) - 1) } },
    yAxis: { ...yAxis, type: "value", scale: true, splitNumber: 3, axisLabel: { ...axisText, formatter: "{value}%" } },
    series: [line("体积含水量", series.map((point) => point.moisture), mint, {
      areaStyle: { color: "rgba(131,216,182,.10)" },
      animationDuration: 1600, animationEasing: "quadraticOut",
      tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v}%` },
    })],
  }} />;
}

// ERA5-Land 根区（7–28 cm）60 天时序，按 GB/T 20481-2017 相对湿度等级分段着色。
export function RootZoneChart({ days = [], fieldCapacity = 0.30, featured = false }) {
  const series = days.filter(({ moisture }) => Number.isFinite(moisture?.root));
  if (!series.length) return <p className="chart-empty">暂无根区墒情时序</p>;
  const fc = fieldCapacity * 100;
  const pieces = [
    { lte: fc * 0.3, color: "#c04a78" },
    { gt: fc * 0.3, lte: fc * 0.4, color: "#ef6a5a" },
    { gt: fc * 0.4, lte: fc * 0.5, color: "#f0954a" },
    { gt: fc * 0.5, lte: fc * 0.6, color: "#e8c95c" },
    { gt: fc * 0.6, lte: fc * 0.9, color: "#58c98a" },
    { gt: fc * 0.9, color: "#4da3ff" },
  ];
  return <Chart className={featured ? "detail-chart" : "soil-chart"} label="根区 7–28 cm 土壤体积含水量，按干旱等级着色" option={{
    ...base,
    animationDuration: 1600,
    animationEasing: "quadraticOut",
    ...zoom(featured),
    visualMap: { show: false, type: "piecewise", dimension: 1, pieces, seriesIndex: 0 },
    grid: { left: 36, right: 10, top: 8, bottom: featured ? 47 : 23 },
    xAxis: { ...axis, type: "category", boundaryGap: false, data: dayNames(series),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(series.length / 4) - 1) } },
    yAxis: { ...yAxis, type: "value", scale: true, splitNumber: 3, axisLabel: { ...axisText, formatter: "{value}%" } },
    series: [{
      name: "根区含水量", type: "line", data: series.map(({ moisture }) => moisture.root),
      showSymbol: false, lineStyle: { width: 2.4 },
      tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v}%` },
      markLine: {
        silent: true, symbol: "none",
        lineStyle: { color: "#6d8ba0", type: "dashed", width: 1 },
        label: { formatter: "田间持水量", color: label, fontSize: 10, position: "insideEndTop" },
        data: [{ yAxis: Number(fc.toFixed(1)) }],
      },
    }],
  }} />;
}

// ERA5-Land 三层土壤剖面时序（表层 / 根区 / 深层）。
export function SoilProfileChart({ days = [], layers = [], featured = false, className }) {
  const usable = days.filter(({ moisture }) => layers.some(({ id }) => Number.isFinite(moisture?.[id])));
  if (!usable.length) return <p className="chart-empty">暂无土壤剖面时序</p>;
  return <Chart className={className ?? (featured ? "detail-chart" : "soil-chart")} label="土壤剖面三层体积含水量时序" option={{
    ...base,
    animationDuration: 1500,
    animationEasing: "quadraticOut",
    ...zoom(featured),
    legend: {
      top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect",
      textStyle: { color: label, fontSize: 11 },
      data: layers.map(({ label }) => label),
    },
    grid: { left: 36, right: 10, top: 26, bottom: featured ? 50 : 23 },
    xAxis: { ...axis, type: "category", boundaryGap: false, data: dayNames(usable),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(usable.length / 5) - 1) } },
    yAxis: { ...yAxis, type: "value", scale: true, splitNumber: 3, axisLabel: { ...axisText, formatter: "{value}%" } },
    series: layers.map(({ id, label }) => ({
      name: label, type: "line", data: usable.map(({ moisture }) => moisture[id]),
      showSymbol: false, lineStyle: { width: 2, color: layerColors[id] }, itemStyle: { color: layerColors[id] },
      animationDelay: (index) => index * 12,
      tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v}%` },
    })),
  }} />;
}

// NASA POWER 日值：降雨柱 + FAO-56 参考蒸散 ET0 曲线（可选叠加去年同期虚线）。
export function AgroChart({ daily = [], lastYear = [], featured = false, className }) {
  const usable = daily.filter(({ precip, et0 }) => precip != null || et0 != null);
  if (!usable.length) return <p className="chart-empty">暂无农业气象时序</p>;
  // 去年同期按「月-日」对齐到今年的横轴，去年缺测的日期留空。
  const lastByDate = new Map(lastYear.map(({ date, et0 }) => [date.slice(5), et0]));
  const lastSeries = usable.map(({ date }) => lastByDate.get(date.slice(5)) ?? null);
  const hasLastYear = lastSeries.some((et0) => et0 != null);
  return <Chart className={className ?? (featured ? "detail-chart" : "agro-chart")} label="日降雨量与参考蒸散量对比" option={{
    ...base,
    ...zoom(featured),
    legend: {
      top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect",
      textStyle: { color: label, fontSize: 11 },
      data: ["日降雨量", "参考蒸散量", ...(hasLastYear ? ["去年同期"] : [])],
    },
    grid: { left: 38, right: 36, top: 26, bottom: featured ? 48 : 24 },
    xAxis: { ...axis, type: "category", data: usable.map(({ date }) => date.slice(5, 10).replace("-", "/")),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(usable.length / 8) - 1) } },
    yAxis: [
      { ...yAxis, type: "value", min: 0, splitNumber: 3 },
      { ...axis, position: "right", type: "value", min: 0, splitNumber: 3, splitLine: { show: false } },
    ],
    series: [
      { name: "日降雨量", type: "bar", data: usable.map(({ precip }) => precip), barMaxWidth: 12,
        itemStyle: { color: mint, borderRadius: [2, 2, 0, 0] }, animationDelay: (index) => index * 18,
        tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v} mm` } },
      { name: "参考蒸散量", type: "line", yAxisIndex: 1, data: usable.map(({ et0 }) => et0),
        showSymbol: false, lineStyle: { color: gold, width: 2 }, itemStyle: { color: gold },
        connectNulls: true, animationDuration: 1600, animationEasing: "quadraticOut",
        tooltip: { valueFormatter: (v) => v == null ? "缺测" : `${v} mm/d` } },
      ...(hasLastYear ? [{
        name: "去年同期", type: "line", yAxisIndex: 1, data: lastSeries,
        showSymbol: false, lineStyle: { color: "#b59ad433", width: 1.6, type: "dashed" },
        itemStyle: { color: "#b59ad4" }, connectNulls: true, silent: true,
      }] : []),
    ],
  }} />;
}

// Sentinel-2 NDVI 时序：两个村与调研片区。
export function NdviChart({ scenes = [], featured = false, className }) {
  if (!scenes.length) return <p className="chart-empty">暂无 NDVI 时序</p>;
  const series = [
    { id: "dahao", name: "大濠冲村", color: "#7ad3d0" },
    { id: "xiaohao", name: "小濠冲村", color: "#58c98a" },
    { id: "overall", name: "调研片区", color: "#85abc7" },
  ];
  return <Chart className={className ?? (featured ? "detail-chart" : "ndvi-chart")} label="两个村与片区的 NDVI 植被指数时序" option={{
    ...base,
    animationDuration: 1500,
    animationEasing: "quadraticOut",
    ...zoom(featured),
    legend: {
      top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect",
      textStyle: { color: label, fontSize: 11 }, data: series.map(({ name }) => name),
    },
    grid: { left: 40, right: 14, top: 26, bottom: featured ? 48 : 24 },
    xAxis: { ...axis, type: "category", boundaryGap: false, data: scenes.map(({ date }) => date.slice(5, 10).replace("-", "/")),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(scenes.length / 5) - 1) } },
    yAxis: { ...yAxis, type: "value", min: 0, max: 0.7, splitNumber: 3 },
    series: series.map(({ id, name, color }) => ({
      name, type: "line", data: scenes.map(({ ndvi }) => ndvi[id]),
      showSymbol: true, symbolSize: 4, lineStyle: { width: 2, color }, itemStyle: { color },
      animationDelay: (index) => index * 40,
      tooltip: { valueFormatter: (v) => v == null ? "缺测" : v.toFixed(3) },
    })),
  }} />;
}

// 虫情测报灯逐日灯诱计数：三种冬季优势种堆叠柱 + 合计折线。
export function PestChart({ series = [], featured = false, className }) {
  if (!series.length) return <p className="chart-empty">暂无灯诱时序</p>;
  const species = [
    { id: "dbm", name: "小菜蛾", color: gold },
    { id: "flea", name: "黄曲条跳甲", color: mint },
    { id: "aphid", name: "蚜虫", color: blue },
  ];
  return <Chart className={className ?? (featured ? "detail-chart" : "pest-chart")} label="虫情测报灯逐日灯诱计数时序" option={{
    ...base,
    animationDuration: 1100,
    animationDelay: (index) => index * 6,
    ...zoom(featured),
    legend: {
      top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect",
      textStyle: { color: label, fontSize: 11 }, data: [...species.map(({ name }) => name), "合计"],
    },
    grid: { left: 44, right: 14, top: 26, bottom: featured ? 46 : 24 },
    xAxis: { ...axis, type: "category", data: series.map(({ date }) => date.slice(5).replace("-", "/")),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(series.length / 7) - 1) } },
    yAxis: { ...yAxis, type: "value", name: "头 / 夜", splitNumber: 3 },
    series: [
      ...species.map(({ id, name, color }) => ({
        name, type: "bar", stack: "lamp", data: series.map((row) => row[id]),
        barMaxWidth: 12, itemStyle: { color },
        tooltip: { valueFormatter: (v) => `${v} 头` },
      })),
      {
        name: "合计", type: "line", data: series.map(({ total }) => total), showSymbol: false,
        lineStyle: { width: 2, color: "#f4dfb4" }, itemStyle: { color: "#f4dfb4" }, smooth: true,
        tooltip: { valueFormatter: (v) => `${v} 头` },
      },
    ],
  }} />;
}

// 月度气候统计：降雨柱 + ET0 合计线 + 气温均值线（近 14 个月）。
export function MonthlyChart({ monthly = [], className }) {
  const usable = monthly.filter(({ precip, et0 }) => precip != null || et0 != null);
  if (usable.length < 3) return <p className="chart-empty">暂无月度统计</p>;
  return <Chart className={className ?? "detail-chart monthly-chart"} label="近 14 个月降雨量、蒸散量与气温均值" option={{
    ...base,
    legend: {
      top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect",
      textStyle: { color: label, fontSize: 11 }, data: ["月降雨量", "参考蒸散合计", "气温均值"],
    },
    grid: { left: 38, right: 42, top: 26, bottom: 24 },
    xAxis: { ...axis, type: "category", data: usable.map(({ month }) => month.slice(2).replace("-", "/")),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(usable.length / 7) - 1) } },
    yAxis: [
      { ...yAxis, type: "value", min: 0, splitNumber: 3 },
      { ...axis, position: "right", type: "value", scale: true, splitNumber: 3, splitLine: { show: false },
        axisLabel: { ...axisText, formatter: "{value}°C" } },
    ],
    series: [
      { name: "月降雨量", type: "bar", data: usable.map(({ precip }) => precip), barMaxWidth: 16,
        itemStyle: { color: mint, borderRadius: [2, 2, 0, 0] }, animationDelay: (index) => index * 45,
        tooltip: { valueFormatter: (v) => `${v} mm` } },
      { name: "参考蒸散合计", type: "line", data: usable.map(({ et0 }) => et0),
        showSymbol: false, lineStyle: { color: gold, width: 2 }, itemStyle: { color: gold },
        animationDuration: 1500, animationEasing: "quadraticOut",
        tooltip: { valueFormatter: (v) => `${v} mm` } },
      { name: "气温均值", type: "line", yAxisIndex: 1, data: usable.map(({ t2mMean }) => t2mMean),
        showSymbol: false, lineStyle: { color: blue, width: 1.6, type: "dashed" }, itemStyle: { color: blue },
        connectNulls: true, silent: true,
        tooltip: { valueFormatter: (v) => (v == null ? "—" : `${v} °C`) } },
    ],
  }} />;
}

// 农业产量结构玫瑰图。
export function YieldChart({ items = [], unit = "" }) {
  const usable = items.filter(({ value }) => Number.isFinite(value));
  if (usable.length < 3) return null;
  return <Chart className="yield-chart" label="农业产量结构占比" option={{
    ...base,
    animationDuration: 1200,
    animationEasing: "quadraticOut",
    series: [{
      type: "pie", roseType: "area", radius: ["14%", "76%"], center: ["50%", "52%"],
      itemStyle: { borderColor: "#111f2b", borderWidth: 2, borderRadius: 3 },
      label: { color: label, fontSize: 11, formatter: ({ name, value }) => `${name} ${value}${unit}` },
      labelLine: { lineStyle: { color: gridLine } },
      data: usable.map(({ label: name, value }, index) => ({
        name, value,
        itemStyle: { color: [mint, "#58c98a", gold, blue][index % 4] },
      })),
      animationDelay: (index) => index * 160,
    }],
  }} />;
}

// ---------- 以下六张图用于页面下方的「农情分析」区 ----------
const legendFor = (data) => ({
  top: 0, left: 32, itemWidth: 14, itemHeight: 8, icon: "roundRect", textStyle: { color: label, fontSize: 11 }, data,
});
const valueText = (unit) => ({ valueFormatter: (value) => value == null ? "缺测" : `${value}${unit}` });
const axisName = (name) => ({ name, nameTextStyle: { color: label, fontSize: 10 }, nameGap: 8 });
const rightTemperature = {
  ...axis, position: "right", type: "value", scale: true, splitNumber: 3, splitLine: { show: false },
  axisLabel: { ...axisText, formatter: "{value}°" },
};

// 未来 7 日：最高 / 最低气温与降水。
export function DailyForecastChart({ daily = [] }) {
  const usable = daily.filter(({ minTemp, maxTemp, precipitation }) => minTemp != null || maxTemp != null || precipitation != null);
  if (!usable.length) return <p className="chart-empty">暂无逐日预报</p>;
  const temperature = (name, key, color) => ({
    name, type: "line", yAxisIndex: 1, data: usable.map((day) => day[key]), symbolSize: 5,
    lineStyle: { color, width: 2 }, itemStyle: { color }, tooltip: valueText(" °C"),
  });
  return <Chart className="analysis-chart" label="未来 7 日最高气温、最低气温与降水" option={{
    ...base,
    legend: legendFor(["降水", "最高气温", "最低气温"]),
    grid: { left: 44, right: 40, top: 46, bottom: 24 },
    xAxis: { ...axis, type: "category", data: usable.map(({ date }) => date.slice(5).replace("-", "/")) },
    yAxis: [
      { ...yAxis, ...axisName("mm"), type: "value", min: 0, splitNumber: 3 },
      rightTemperature,
    ],
    series: [
      { name: "降水", type: "bar", data: usable.map(({ precipitation }) => precipitation), barMaxWidth: 18,
        itemStyle: { color: blue, borderRadius: [2, 2, 0, 0] }, tooltip: valueText(" mm") },
      temperature("最高气温", "maxTemp", gold),
      temperature("最低气温", "minTemp", mint),
    ],
  }} />;
}

// 近 90 日：最高 / 最低气温与太阳辐射（蒸散和光合的驱动项）。
export function ClimateChart({ daily = [] }) {
  const usable = daily.filter(({ tmax, tmin, srad }) => tmax != null || tmin != null || srad != null);
  if (!usable.length) return <p className="chart-empty">暂无气温与辐射日值</p>;
  return <Chart className="analysis-chart" label="近 90 日最高气温、最低气温与太阳辐射" option={{
    ...base,
    legend: legendFor(["太阳辐射", "最高气温", "最低气温"]),
    grid: { left: 46, right: 40, top: 46, bottom: 24 },
    xAxis: { ...axis, type: "category", data: dayNames(usable),
      axisLabel: { ...axisText, interval: Math.max(0, Math.floor(usable.length / 7) - 1) } },
    yAxis: [
      { ...yAxis, ...axisName("MJ/m²"), type: "value", min: 0, splitNumber: 3 },
      rightTemperature,
    ],
    series: [
      { name: "太阳辐射", type: "bar", data: usable.map(({ srad }) => srad), barMaxWidth: 10,
        itemStyle: { color: blue, opacity: 0.55 }, tooltip: valueText(" MJ/m²") },
      line("最高气温", usable.map(({ tmax }) => tmax), gold, { yAxisIndex: 1, connectNulls: true, tooltip: valueText(" °C") }),
      line("最低气温", usable.map(({ tmin }) => tmin), mint, { yAxisIndex: 1, connectNulls: true, tooltip: valueText(" °C") }),
    ],
  }} />;
}

// 斗门站近 24 小时风速与气压。
export function WindPressureChart({ hours = [] }) {
  const usable = hours.filter(({ wind, pressure }) => wind != null || pressure != null);
  if (!usable.length) return <p className="chart-empty">暂无风速与气压记录</p>;
  return <Chart className="analysis-chart" label="斗门站近 24 小时风速与气压" option={{
    ...base,
    legend: legendFor(["风速", "气压"]),
    grid: { left: 44, right: 46, top: 46, bottom: 26 },
    xAxis: { ...axis, type: "time", axisLabel: { ...axisText, formatter: (value) => formatTime(value, "hour") } },
    yAxis: [
      { ...yAxis, ...axisName("m/s"), type: "value", min: 0, splitNumber: 3 },
      { ...axis, ...axisName("hPa"), position: "right", type: "value", scale: true, splitNumber: 3, splitLine: { show: false } },
    ],
    series: [
      { name: "风速", type: "bar", data: usable.map(({ time, wind }) => [time, wind]), barMaxWidth: 10,
        itemStyle: { color: mint, borderRadius: [2, 2, 0, 0] }, tooltip: valueText(" m/s") },
      line("气压", usable.map(({ time, pressure }) => [time, pressure]), gold, { yAxisIndex: 1, tooltip: valueText(" hPa") }),
    ],
  }} />;
}

// 在田作物近 10 日水分平衡：降雨、有效降雨、需水量与灌溉参考。
export function WaterBalanceChart({ balances = [] }) {
  const usable = balances.filter(({ precip, etc }) => precip != null || etc != null);
  if (!usable.length) return <p className="chart-empty">暂无水分平衡数据</p>;
  const bars = (name, key, color) => ({
    name, type: "bar", data: usable.map((item) => item[key]), barMaxWidth: 16, barGap: "20%",
    itemStyle: { color, borderRadius: [2, 2, 0, 0] }, tooltip: valueText(" mm"),
  });
  return <Chart className="analysis-chart" label="在田作物近 10 日降雨、有效降雨、需水量与灌溉参考" option={{
    ...base,
    legend: legendFor(["降雨", "有效降雨", "需水量", "灌溉参考"]),
    grid: { left: 44, right: 12, top: 46, bottom: 36 },
    xAxis: { ...axis, type: "category", data: usable.map(({ name }) => name.replace(/（.*$/, "")),
      axisLabel: { ...axisText, interval: 0, width: 64, overflow: "break" } },
    yAxis: { ...yAxis, ...axisName("mm"), type: "value", min: 0, splitNumber: 3 },
    series: [
      bars("降雨", "precip", blue),
      bars("有效降雨", "effectiveRain", mint),
      bars("需水量", "etc", gold),
      bars("灌溉参考", "irrigationRefMm", "#58c98a"),
    ],
  }} />;
}

// 本月农事作业构成（按作业类型计数）。
export function OperationsChart({ byType = {} }) {
  const rows = Object.entries(byType).filter(([, count]) => Number.isFinite(count) && count > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <p className="chart-empty">本月暂无作业记录</p>;
  return <Chart className="analysis-chart" label="本月农事作业次数，按作业类型" option={{
    ...base,
    grid: { left: 8, right: 46, top: 12, bottom: 24 },
    xAxis: { ...yAxis, type: "value", minInterval: 1, splitNumber: 3 },
    yAxis: { ...axis, type: "category", inverse: true, data: rows.map(([name]) => name), axisLabel: { ...axisText, fontSize: 12 } },
    series: [{
      name: "次数", type: "bar", data: rows.map(([, count]) => count), barMaxWidth: 16,
      itemStyle: { color: mint, borderRadius: [0, 2, 2, 0] },
      label: { show: true, position: "right", color: label, fontSize: 11, formatter: ({ value }) => `${value} 次` },
      tooltip: valueText(" 次"),
    }],
  }} />;
}

// 农业产值与同比。
export function OutputChart({ results = [] }) {
  const rows = results.map(([name, value, growth]) => ({ name, value: Number(value), growth })).filter(({ value }) => Number.isFinite(value));
  if (!rows.length) return null;
  return <Chart className="output-chart" label="农业产值与同比" option={{
    ...base,
    grid: { left: 8, right: 86, top: 10, bottom: 22 },
    xAxis: { ...yAxis, type: "value", min: 0, splitNumber: 3 },
    yAxis: { ...axis, type: "category", inverse: true, data: rows.map(({ name }) => name),
      axisLabel: { ...axisText, fontSize: 12, width: 132, overflow: "break" } },
    series: [{
      name: "产值", type: "bar", data: rows.map(({ value }) => value), barMaxWidth: 18,
      itemStyle: { color: blue, borderRadius: [0, 2, 2, 0] },
      label: { show: true, position: "right", color: "#dfeaf2", fontSize: 11,
        formatter: ({ dataIndex }) => `${rows[dataIndex].value} 亿元 · 同比 ${rows[dataIndex].growth}` },
      tooltip: { valueFormatter: (value) => `${value} 亿元` },
    }],
  }} />;
}

export function ReplayChart({ data, from, to, water = false }) {
  if (!data?.some(([, value]) => value != null)) return <p className="chart-empty replay-empty">当天没有这组采样记录</p>;
  const name = water ? "水表读数" : "土壤湿度";
  const unit = water ? "" : "%RH";
  return <Chart className="replay-chart" label={unit ? `${name}，单位 ${unit}` : "水表原始读数"} option={{
    ...base,
    tooltip: { ...tooltip, valueFormatter: (val) => val == null ? "缺测" : `${val} ${unit}` },
    grid: { left: 58, right: 20, top: 10, bottom: 27 },
    xAxis: { ...axis, type: "time", min: from, max: to, splitNumber: 6,
      axisLabel: { ...axisText, formatter: replayTime },
      axisPointer: { label: { formatter: ({ value }) => replayTime(value) } } },
    yAxis: { ...yAxis, type: "value", scale: true, splitNumber: 4 },
    series: [line(name, data, water ? gold : mint, { step: water ? "end" : false })],
  }} />;
}
