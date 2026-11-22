// 从 Microsoft Planetary Computer（免注册）拉取 Sentinel-2 L2A，计算两个调研村及周边的 NDVI 时序。
// 用法：node scripts/refresh-ndvi.mjs            （默认检索当年 5 月 1 日至今）
//       node scripts/refresh-ndvi.mjs 2026-03-01 （自定义起始日期；结果与既有文件按日期合并）
import { readFile, writeFile } from 'node:fs/promises';
import { fromUrl as tiffFromUrl } from 'geotiff';

const OUT = new URL('../public/data/ndvi-history.json', import.meta.url);
const START = process.argv[2] ?? `${new Date().getFullYear()}-05-01`;
const END = new Date().toISOString().slice(0, 10);
const REGIONS = [
  { id: 'dahao', name: '大濠冲村', center: [113.15785, 22.22410], half: 320 },
  { id: 'xiaohao', name: '小濠冲村', center: [113.16875, 22.22667], half: 320 },
  { id: 'overall', name: '调研片区', center: [113.16330, 22.22539], half: 1300 },
];
const STAC_SEARCH = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const SAS_TOKEN = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a';

// WGS84 → UTM 49N（Snyder 公式），Sentinel-2 49QGE 瓦片使用 EPSG:32649。
function toUtm49N(lonDeg, latDeg) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const rad = Math.PI / 180;
  const lon = lonDeg * rad, lat = latDeg * rad, lon0 = 111 * rad;
  const sin = Math.sin(lat), cos = Math.cos(lat), tan = Math.tan(lat);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan, C = ep2 * cos * cos, A = (lon - lon0) * cos;
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * lat
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * lat)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * lat));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const y = k0 * (M + N * tan * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}

async function requireJson(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), ...options });
  if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  return response.json();
}

// COG 仅主图层带仿射标签：金字塔层级的原点/分辨率由主图层按宽度比例换算。
function gridOf(tiff) {
  return tiff.grid ??= (async () => {
    const base = await tiff.getImage(0);
    const origin = base.getOrigin();
    const resolution = base.getResolution();
    const width = base.getWidth();
    return { origin, resolution, width };
  })();
}

async function pickOverview(tiff, boxWidthMeters) {
  const grid = await gridOf(tiff);
  const count = await tiff.getImageCount();
  for (let index = 0; index < count; index += 1) {
    const image = await tiff.getImage(index);
    const scale = grid.width / image.getWidth();
    const resY = Math.abs(grid.resolution[1]) * scale;
    const boxPixels = boxWidthMeters / resY;
    if (index === count - 1 || boxPixels <= 90) return { image, scale };
  }
}

function windowFor(grid, image, scale, [lon0, lat0], [lon1, lat1]) {
  const [x0, y1] = toUtm49N(lon0, lat0);
  const [x1, y0] = toUtm49N(lon1, lat1);
  const [originX, originY] = grid.origin;
  const [resX, resY] = grid.resolution;
  const colStart = Math.max(0, Math.floor(((x0 - originX) / resX) / scale));
  const colEnd = Math.min(image.getWidth() - 1, Math.ceil(((x1 - originX) / resX) / scale));
  const rowStart = Math.max(0, Math.floor(((y0 - originY) / resY) / scale));
  const rowEnd = Math.min(image.getHeight() - 1, Math.ceil(((y1 - originY) / resY) / scale));
  return [colStart, rowStart, Math.max(colStart + 1, colEnd), Math.max(rowStart + 1, rowEnd)];
}

async function regionNdvi(bandTiffs, region) {
  const [lonC, latC] = region.center;
  const half = region.half;
  const lonHalf = half / (111_320 * Math.cos((latC * Math.PI) / 180));
  const latHalf = half / 110_574;
  const box = [[lonC - lonHalf, latC - latHalf], [lonC + lonHalf, latC + latHalf]];
  const values = { red: [], nir: [] };
  for (const band of ['red', 'nir']) {
    const tiff = bandTiffs[band];
    const grid = await gridOf(tiff);
    const { image, scale } = await pickOverview(tiff, half * 2);
    const rasters = await image.readRasters({ window: windowFor(grid, image, scale, box[0], box[1]) });
    values[band] = rasters[0];
  }
  if (values.red.length !== values.nir.length) throw new Error('Band window mismatch');
  let sum = 0, count = 0;
  for (let i = 0; i < values.red.length; i += 1) {
    const red = values.red[i], nir = values.nir[i];
    if (!red || !nir) continue; // 0 为哨兵 NoData
    const denominator = nir + red;
    if (!denominator) continue;
    const ndvi = (nir - red) / denominator;
    if (Number.isFinite(ndvi) && ndvi > -1 && ndvi < 1) { sum += ndvi; count += 1; }
  }
  if (count < 8) throw new Error(`Only ${count} valid pixels for ${region.id}`);
  return Number((sum / count).toFixed(3));
}

const search = await requireJson(STAC_SEARCH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    collections: ['sentinel-2-l2a'],
    bbox: [113.148, 22.214, 113.180, 22.236],
    datetime: `${START}/${END}`,
    query: { 'eo:cloud_cover': { lt: 30 } },
    limit: 40,
    sortby: [{ field: 'properties.datetime', direction: 'ascending' }],
  }),
});
const items = search.features ?? [];
if (!items.length) throw new Error('No Sentinel-2 scenes matched');

const { token } = await requireJson(SAS_TOKEN);
console.log(`STAC 检索到 ${items.length} 景（云量<30），SAS 令牌已获取`);

const scenes = [];
for (const item of items) {
  const date = item.properties.datetime.slice(0, 10);
  const cloud = item.properties['eo:cloud_cover'];
  try {
    const bandTiffs = {};
    for (const band of ['B04', 'B08']) {
      const asset = item.assets[band];
      if (!asset?.href) throw new Error(`missing asset ${band}`);
      // SAS 令牌本身即完整查询串，直接拼接。
      bandTiffs[band === 'B04' ? 'red' : 'nir'] = await tiffFromUrl(`${asset.href}?${token}`, { blockSize: 256 });
    }
    const ndvi = {};
    for (const region of REGIONS) ndvi[region.id] = await regionNdvi({ red: bandTiffs.red, nir: bandTiffs.nir }, region);
    scenes.push({ date, cloudCover: cloud, tile: item.id.split('_').at(-1), ndvi });
    console.log(`${date} 云量 ${cloud.toFixed(0)}% · NDVI 大濠冲 ${ndvi.dahao} 小濠冲 ${ndvi.xiaohao} 片区 ${ndvi.overall}`);
  } catch (error) {
    console.warn(`${date} 跳过：${error.message}`);
  }
}

if (!scenes.length) throw new Error('No usable scenes in the requested window');
// 与既有文件按日期合并（新结果优先）。
let merged = scenes;
try {
  const existing = JSON.parse(await readFile(OUT, 'utf8'));
  const freshDates = new Set(scenes.map(({ date }) => date));
  merged = [...existing.scenes.filter(({ date }) => !freshDates.has(date)), ...scenes]
    .sort((a, b) => a.date.localeCompare(b.date));
  console.log(`合并既有 ${existing.scenes.length} 景 + 新增 ${scenes.length} 景`);
} catch {
  console.log('未找到既有文件，写入全新时序');
}
const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    name: 'Microsoft Planetary Computer · Sentinel-2 L2A',
    url: 'https://planetarycomputer.microsoft.com/',
    method: 'NDVI = (B08 − B04) / (B08 + B04)，10 m 波段内部金字塔窗口均值，剔除 NoData 像元',
  },
  regions: REGIONS.map(({ id, name, half }) => ({ id, name, windowMeters: half * 2 })),
  scenes: merged,
};
await writeFile(OUT, `${JSON.stringify(payload)}\n`, 'utf8');
console.log(`已写入 public/data/ndvi-history.json，共 ${merged.length} 景，最新 ${merged.at(-1).date}`);
