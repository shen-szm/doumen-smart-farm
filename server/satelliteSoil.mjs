// NOAA CPC SMOPS 多卫星日合成土壤湿度（表层 1–5 cm，0.25° 网格）：取斗门所在网格的逐日值。
// 源文件是 NetCDF-4（HDF5），用 h5wasm 解析；这个库只在取数时加载，不进网页包。
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DIRECTORY = 'https://ftp.cpc.ncep.noaa.gov/precip/PORT/SEMDP/SOIL-MOISTURE/SMOPS/DATA';
const FILE_NAME = /SEMDP_SM_SMOPS_0\.25deg-DLY_(\d{8})\.nc/g;
// 保留最近 14 个有数据的日值。
export const SATELLITE_SOIL_WINDOW_DAYS = 14;
const POINT = Object.freeze({ latitude: 22.125, longitude: 113.125 });

const DESCRIPTION = Object.freeze({
  location: { name: '斗门镇及周边', latitude: POINT.latitude, longitude: POINT.longitude, bounds: [[22, 113], [22.25, 113.25]] },
  product: 'SMOPS 多卫星日合成',
  depth: '表层 1–5 cm',
  unit: '%',
  resolution: '0.25° × 0.25°',
  timeZone: 'UTC',
  coverageNote: '提取同时覆盖大濠冲村和小濠冲村的区域网格。日值单位为体积含水量，源数据变量 sm 按比例因子 0.0001 换算，缺测值 −9999 和超出有效范围的数值留空。CPC 文件提供缺测掩码，未单独发布逐格质量标志。',
});
const METHOD_URL = 'https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC00994';

// 这个源在国内访问偏慢：每个请求限时 90 秒，失败自动重试两次。
async function requestBytes(fetcher, url, asText = false) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
      return asText ? response.text() : new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

const monthDirectory = (day) => `${DIRECTORY}/${day.slice(0, 4)}/${day.slice(0, 6)}/`;

// 目录里现有哪些天的文件（当月不够一个窗口时连上一个月一起列），按日期升序。
export async function listAvailableDays(fetcher, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  const months = [today.slice(0, 6)];
  const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 15)).toISOString().slice(0, 7).replace('-', '');
  if (Number(today.slice(6)) < SATELLITE_SOIL_WINDOW_DAYS + 4) months.unshift(previous);
  const days = new Set();
  for (const month of months) {
    const html = await requestBytes(fetcher, `${DIRECTORY}/${month.slice(0, 4)}/${month}/`, true);
    for (const match of html.matchAll(FILE_NAME)) days.add(match[1]);
    if ([...days].filter((day) => day.startsWith(month)).length >= SATELLITE_SOIL_WINDOW_DAYS) break;
  }
  return [...days].sort().map((day) => ({ day, url: `${monthDirectory(day)}SEMDP_SM_SMOPS_0.25deg-DLY_${day}.nc` }));
}

// 从一个日值文件里取目标网格中心的值（体积含水量，%）。缺测返回 null。
export async function readSmopsPoint(bytes, { dir } = {}) {
  const { default: h5wasm } = await import('h5wasm/node');
  await h5wasm.ready;
  // Node 版的库只认磁盘路径：先写到临时文件，读完即删。
  const folder = path.join(dir ?? os.tmpdir(), 'doumen-smops');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${process.pid}-${Date.now()}.nc`);
  await writeFile(file, bytes);
  let handle;
  try {
    handle = new h5wasm.File(file, 'r');
    const lat = handle.get('lat')?.value;
    const lon = handle.get('lon')?.value;
    const sm = handle.get('sm');
    if (!lat?.length || !lon?.length || !sm) throw new Error('SMOPS file is missing lat / lon / sm');
    const nearest = (axis, target) => axis.reduce((best, value, index) => Math.abs(value - target) < Math.abs(axis[best] - target) ? index : best, 0);
    const ilat = nearest(lat, POINT.latitude);
    const ilon = nearest(lon, POINT.longitude);
    if (Math.abs(lat[ilat] - POINT.latitude) > 0.01 || Math.abs(lon[ilon] - POINT.longitude) > 0.01) {
      throw new Error('SMOPS grid does not contain the target cell');
    }
    const attribute = (name) => sm.attrs?.[name]?.value?.[0];
    const raw = sm.value[ilat * lon.length + ilon];
    const missing = attribute('missing_value');
    const minimum = attribute('valid_min');
    const maximum = attribute('valid_max');
    const valid = raw !== missing && (minimum == null || raw >= minimum) && (maximum == null || raw <= maximum);
    const seconds = handle.get('time')?.value?.[0];
    return {
      time: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null,
      moisture: valid ? Number((raw * (attribute('scale_factor') ?? 0.0001) * 100).toFixed(2)) : null,
    };
  } finally {
    handle?.close?.();
    await rm(file, { force: true });
  }
}

// 增量刷新：窗口里缺哪几天就下载哪几天，其余沿用上一次的结果。
export async function refreshSatelliteSoil({ previous = null, fetcher = fetch, now = Date.now(), dir, log = () => {} }) {
  const available = await listAvailableDays(fetcher, now);
  if (!available.length) throw new Error('SMOPS directory has no daily files');
  const wanted = available.slice(-SATELLITE_SOIL_WINDOW_DAYS);
  const known = new Map((previous?.points ?? []).map((point) => [point.time.slice(0, 10), point]));
  const points = [];
  let failed = 0;
  for (const { day, url } of wanted) {
    const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
    let point = known.get(date);
    if (!point) {
      try {
        point = await readSmopsPoint(await requestBytes(fetcher, url), { dir });
        if (!point.time) throw new Error('no valid time');
        log(`卫星表层墒情新增 ${point.time.slice(0, 10)}`);
      } catch (error) {
        failed += 1;
        log(`卫星表层墒情 ${date}取数失败：${error.message}`);
        continue;
      }
    }
    points.push(point);
  }
  // 多数日子都取不到才算失败（保留上一次的结果，等下一轮重试）；个别日子缺测下一轮会自动补。
  if (points.length < SATELLITE_SOIL_WINDOW_DAYS / 2) throw new Error(`SMOPS only ${points.length} of ${wanted.length} days`);
  points.sort((a, b) => a.time.localeCompare(b.time));
  return {
    status: 'current',
    checkedAt: new Date(now).toISOString(),
    generatedAt: new Date().toISOString(),
    source: { name: 'NOAA CPC · SMOPS', url: monthDirectory(points.at(-1).time.slice(0, 10).replace(/-/g, '')), methodUrl: METHOD_URL },
    ...DESCRIPTION,
    points,
    ...(failed ? { missingDays: failed } : {}),
  };
}
