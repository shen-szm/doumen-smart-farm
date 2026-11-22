import { useEffect, useState } from "react";

export const stationUrl = "https://www.weather.com.cn/weathern/101280702.shtml";
export const alertUrl = "https://www.zhuhai.gov.cn/zw/yjgl/yjgg/";
export const stormUrl = "https://gd.weather.com.cn/syxw/09/4342248.shtml";
export const guidanceUrl = "https://zzys.moa.gov.cn/gdxw/202107/t20210729_6373097.htm";
export const shanghai = "Asia/Shanghai";
const parma = "Europe/Rome";

// 子路径部署（如 GitHub Pages）下，把站内绝对路径补上 Vite base 前缀。
const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
export const asset = (path) => (typeof path === "string" && path.startsWith("/") ? `${BASE}${path}` : path);

export function formatTime(value, kind = "full", timeZone = shanghai) {
  if (value == null || !Number.isFinite(new Date(value).getTime())) return "—";
  const date = new Date(value);
  const options = kind === "hour" ? { hour: "2-digit", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      ...(kind === "date" ? { year: "numeric" } : {}) };
  return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone, hourCycle: "h23" }).format(date);
}

export const replayTime = (value) => formatTime(value, "hour", parma);
export const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "—";

export async function getJson(url, signal) {
  const res = await fetch(asset(url), { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useReading(url, refreshMs, fallback) {
  const [reading, setReading] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function update() {
      if (busy) return;
      busy = true;
      try {
        const next = await getJson(url, controller.signal);
        if (!controller.signal.aborted) setReading(next);
      } catch {
        if (controller.signal.aborted) return;
        let snapshot;
        if (fallback) {
          try { snapshot = await getJson(fallback, controller.signal); } catch { /* no snapshot */ }
        }
        if (!controller.signal.aborted) {
          setReading((previous) => {
            const cached = previous && previous.status !== "unavailable" ? previous : snapshot;
            return cached ? { ...cached, status: "cached", ...(cached.history?.length && { historyStatus: "cached" }) }
              : { status: "unavailable" };
          });
        }
      } finally {
        busy = false;
      }
    }
    update();
    const timer = window.setInterval(update, refreshMs);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [url, refreshMs, fallback]);
  return reading;
}

export function rainRisk(reading) {
  const hours = reading?.hourly ?? [];
  const complete = hours.length === 24 && hours.every(({ time, rain }, index) =>
    Date.parse(time) > Date.parse(reading.current?.time) && Number.isFinite(rain) && rain >= 0 &&
    (index === 0 || Date.parse(time) - Date.parse(hours[index - 1].time) === 3_600_000));
  const total = complete ? hours.reduce((sum, hour) => sum + hour.rain, 0) : null;
  const actionable = reading?.status === "current" && complete;
  return { total, high: actionable && total >= 50 - 1e-9, actionable };
}

export function useActiveAlerts(alerts) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const next = Math.min(...(alerts?.alerts ?? []).map(({ endsAt }) => Date.parse(endsAt))
      .filter((end) => end > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(next - Date.now(), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [alerts, now]);
  return alerts ? { ...alerts, alerts: alerts.alerts?.filter(({ endsAt }) => !endsAt || Date.parse(endsAt) > Math.max(now, Date.now())) ?? [] } : null;
}

export function weatherText(code) {
  if (code == null) return "天气待更新";
  if (code === 0) return "晴";
  if (code === 1) return "少云";
  if (code === 2) return "多云";
  if (code === 3) return "阴";
  if (code < 50) return "有雾";
  if (code < 60) return "毛毛雨";
  if (code < 70) return "有雨";
  if (code < 80) return "有雪";
  if (code < 90) return "阵雨";
  return "雷阵雨";
}
