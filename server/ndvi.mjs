// Sentinel-2 NDVI：从微软行星计算机（免注册）取影像，计算两个调研村及片区的 NDVI 时序。
// 服务器后台按增量定时刷新（见 server/api.mjs）；重建随构建发布的快照时也调用这里的函数。
import { setTimeout as sleep } from 'node:timers/promises';
import { BaseClient, BaseResponse, fromCustomClient } from 'geotiff';

const DAY_MS = 24 * 60 * 60 * 1000;
// 只采用少云的过境；云量不低于 30% 的影像不做计算，但在结果里列出来。
const CLOUD_LIMIT = 30;
// 时序展示近 240 天（覆盖早稻、晚稻两季），更早的影像不再检索。
export const NDVI_WINDOW_DAYS = 240;
// 「近期未采用」只列最近这么多天内的过境。
const SKIPPED_DAYS = 20;

export const NDVI_REGIONS = Object.freeze([
  { id: 'dahao', name: '大濠冲村', center: [113.15785, 22.22410], half: 320 },
  { id: 'xiaohao', name: '小濠冲村', center: [113.16875, 22.22667], half: 320 },
  { id: 'overall', name: '调研片区', center: [113.16330, 22.22539], half: 1300 },
]);
export const NDVI_SOURCE = Object.freeze({
  name: 'Microsoft Planetary Computer · Sentinel-2 L2A',
  url: 'https://planetarycomputer.microsoft.com/',
  method: 'NDVI = (B08 − B04) / (B08 + B04)，10 m 波段内部金字塔窗口均值，剔除 NoData 像元',
});
const SEARCH_BBOX = [113.148, 22.214, 113.180, 22.236];
const STAC_SEARCH = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const SAS_TOKEN = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a';

const isoDate = (time) => new Date(time).toISOString().slice(0, 10);
const sceneKey = ({ date, tile }) => `${date}|${tile}`;

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
  const y = k0 * (M + N * tan * (A ** 2 / 2 + (5 - T + 9 * C + C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}

// 来源在境外，偶尔会连接超时：每个请求限时 30 秒，失败自动重试两次。
async function requestJson(fetcher, url, options) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30_000), ...options });
      if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

export async function searchScenes({ fetcher = fetch, start, end, cloudBelow = CLOUD_LIMIT }) {
  const search = await requestJson(fetcher, STAC_SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox: SEARCH_BBOX,
      datetime: `${start}/${end}`,
      ...(cloudBelow == null ? {} : { query: { 'eo:cloud_cover': { lt: cloudBelow } } }),
      limit: 100,
      sortby: [{ field: 'properties.datetime', direction: 'ascending' }],
    }),
  });
  return (search.features ?? []).map((item) => {
    const { datetime = '', 'eo:cloud_cover': cloudCover } = item.properties ?? {};
    return {
      id: item.id, date: datetime.slice(0, 10), cloudCover, tile: item.id.split('_').at(-1),
      red: item.assets?.B04?.href, nir: item.assets?.B08?.href,
    };
  });
}

// COG 仅主图层带仿射标签：金字塔层级的原点/分辨率由主图层按宽度比例换算。
async function gridOf(tiff) {
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

// geotiff 的取数客户端：每次请求限时 60 秒，网络错误或服务端错误自动重试两次。
class ClientResponse extends BaseResponse {
  constructor(response) {
    super();
    this.response = response;
  }

  get status() { return this.response.status; }
  getHeader(name) { return this.response.headers.get(name) || undefined; }
  async getData() { return this.response.arrayBuffer(); }
}

class RetryingClient extends BaseClient {
  constructor(url, fetcher = fetch) {
    super(url);
    this.fetcher = fetcher;
  }

  async request({ headers, signal } = {}) {
    const timeout = AbortSignal.timeout(60_000);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.fetcher(this.url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          throw new Error(`image storage returned HTTP ${response.status}`);
        }
        return new ClientResponse(response);
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        if (attempt === 3) break;
        await sleep(2000 * attempt);
      }
    }
    throw lastError;
  }
}

// 一景影像：两个波段各取一次，在三个窗口内求 NDVI 均值。
export async function computeSceneNdvi(scene, { token, fetcher = fetch }) {
  if (!scene.red || !scene.nir) throw new Error('missing band asset');
  const bandTiffs = {};
  for (const band of ['red', 'nir']) {
    bandTiffs[band] = await fromCustomClient(new RetryingClient(`${scene[band]}?${token}`, fetcher), { blockSize: 256 });
  }
  const ndvi = {};
  for (const region of NDVI_REGIONS) ndvi[region.id] = await regionNdvi(bandTiffs, region);
  return { date: scene.date, cloudCover: scene.cloudCover, tile: scene.tile, ndvi };
}

// 增量刷新：目录里出现既有结果中没有的少云影像时才下载计算，其余时候只做检索。
// previous 是上一次的结果（可以为空）。
export async function refreshNdvi({ previous = null, fetcher = fetch, now = Date.now(), log = () => {} }) {
  const checkedAt = new Date(now).toISOString();
  const end = isoDate(now + DAY_MS);
  const start = isoDate(now - NDVI_WINDOW_DAYS * DAY_MS);
  const catalog = await searchScenes({ fetcher, start, end });
  const known = new Map((previous?.scenes ?? []).map((scene) => [sceneKey(scene), scene]));
  const { token } = await requestJson(fetcher, SAS_TOKEN);
  const scenes = [];
  for (const scene of catalog) {
    const existing = known.get(sceneKey(scene));
    if (existing) { scenes.push({ ...existing, cloudCover: scene.cloudCover }); continue; }
    try {
      scenes.push(await computeSceneNdvi(scene, { token, fetcher }));
      log(`NDVI 新增 ${scene.date}（云量 ${scene.cloudCover.toFixed(0)}%）`);
    } catch (error) {
      log(`NDVI ${scene.date}跳过：${error.message}`);
    }
  }
  if (!scenes.length) throw new Error('No usable scenes in the requested window');
  scenes.sort((a, b) => a.date.localeCompare(b.date) || a.tile.localeCompare(b.tile));

  // 最新一景之后因云量过高没有采用的过境（只检索，不下载）。
  let skipped = previous?.skipped ?? [];
  try {
    const since = isoDate(Math.max(Date.parse(`${scenes.at(-1).date}T00:00:00Z`), now - SKIPPED_DAYS * DAY_MS));
    const recent = await searchScenes({ fetcher, start: since, end, cloudBelow: null });
    const used = new Set(scenes.map(sceneKey));
    skipped = recent.filter((scene) => scene.cloudCover >= CLOUD_LIMIT && !used.has(sceneKey(scene)))
      .map(({ date, cloudCover }) => ({ date, cloudCover }));
  } catch (error) {
    log(`NDVI 未采用过境检索失败：${error.message}`);
  }

  return {
    status: 'current',
    checkedAt,
    generatedAt: new Date().toISOString(),
    source: NDVI_SOURCE,
    regions: NDVI_REGIONS.map(({ id, name, half }) => ({ id, name, windowMeters: half * 2 })),
    scenes,
    skipped,
  };
}
