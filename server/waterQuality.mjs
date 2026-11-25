// 区域水环境：斗门区政府网「水质环境信息」栏目自动发现新发布的水质月报 / 水质指数表，并把表格解析成结构化数据。
// 栏目大约半年更新一次；后台定时核对，有新帖子才抓取正文。
import { setTimeout as sleep } from 'node:timers/promises';
const LISTING = 'https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/index.html';
export const WATER_SOURCE = Object.freeze({ name: '珠海市生态环境局斗门分局', url: LISTING });
const LISTING_ITEM = /<a\s[^>]*href="([^"]*\/hjbhxxgk\/szhj\/content\/(post_\d+)\.html)"[^>]*>([^<]+)<\/a>/g;
// 已知断面的固定标识（界面用它们做键）；栏目里出现新断面时按名称生成标识。
const SECTION_IDS = Object.freeze({ '珠海大桥': 'zhuhai-bridge', '尖峰大桥': 'jianfeng-bridge', '西炮台': 'west-fort', '虎跳门水道河口': 'hutiaomen-mouth' });
const ENTITIES = Object.freeze({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”', mdash: '—', hellip: '…' });

function text(fragment) {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  }).replace(/\s+/g, ' ').trim();
}

export const postId = (url) => /post_\d+/.exec(url)?.[0] ?? url;

// 栏目列表：按页面上的顺序（新的在前）。
export function parseListing(html) {
  const items = [];
  for (const match of html.matchAll(LISTING_ITEM)) {
    const published = /发布时间[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(html.slice(match.index, match.index + 900));
    items.push({
      id: match[2], title: text(match[3]), publishedAt: published?.[1] ?? null,
      url: new URL(match[1], LISTING).href.replace(/^http:/, 'https:'),
    });
  }
  return items;
}

// 正文里第一张带「断面名称」的表：水质月报给类别与达标情况，水质指数表给指数。
// 识别不了版式时返回 null（不猜）。
export function parseWaterReport(html, { url, title, publishedAt }, sections = []) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => text(cell[1])));
    const head = rows[0] ?? [];
    const column = (label) => head.findIndex((name) => name.replace(/\s/g, '').includes(label));
    const sectionAt = column('断面名称');
    const kind = column('水质现状') >= 0 ? 'grade' : column('河流水质指数') >= 0 ? 'index' : null;
    if (kind == null || sectionAt < 0) continue;

    const monthOf = (value) => {
      const parts = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(value ?? '');
      return parts ? `${parts[1]}-${parts[2].padStart(2, '0')}` : null;
    };
    const measurements = rows.slice(1).filter((cells) => cells.length >= head.length - 1 && cells[sectionAt]).map((cells) => {
      const name = cells[sectionAt];
      const river = cells[column('所在河流') >= 0 ? column('所在河流') : column('河段名称')] ?? '';
      let section = sections.find((entry) => entry.name === name);
      if (!section) {
        section = { id: SECTION_IDS[name] ?? `section-${name}`, river, name };
        sections.push(section);
      }
      if (kind === 'index') {
        const index = Number(cells[column('河流水质指数')]);
        return { sectionId: section.id, ...(Number.isFinite(index) ? { index } : {}) };
      }
      const compliance = cells[column('是否达标')];
      return {
        sectionId: section.id,
        grade: cells[column('水质现状')] || null,
        target: cells[column('水质目标')] || null,
        compliant: compliance ? /是|达标/.test(compliance) && !/未|不/.test(compliance) : null,
        pollutants: cells[column('超标污染物')] || '无',
        provider: cells[column('数据来源')] || null,
      };
    });
    if (!measurements.length) return null;
    const sampling = column('采样时间');
    return {
      month: monthOf(title) ?? (sampling >= 0 ? monthOf(rows[1]?.[sampling]) : null) ?? publishedAt?.slice(0, 7) ?? null,
      publishedAt, url, kind, title, measurements,
    };
  }
  return null;
}

// 这个站偶尔响应慢：每个请求限时 30 秒，失败自动重试两次。
async function requestText(fetcher, url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

// 栏目里出现、既有结果里没有的帖子才抓正文；栏目里撤下的旧报告继续保留。
export async function refreshWaterQuality({ previous = null, fetcher = fetch, now = Date.now(), log = () => {} }) {
  const listing = parseListing(await requestText(fetcher, LISTING));
  if (!listing.length) throw new Error('water quality listing has no reports');
  const reports = [...(previous?.reports ?? [])];
  const known = new Set(reports.map(({ url }) => postId(url)));
  const sections = [...(previous?.sections ?? [])];
  for (const item of listing) {
    if (known.has(item.id)) continue;
    try {
      const report = parseWaterReport(await requestText(fetcher, item.url), item, sections);
      if (!report) { log(`水环境「${item.title}」的表格无法识别，未收录`); continue; }
      reports.push(report);
      log(`水环境新增「${item.title}」`);
    } catch (error) {
      log(`水环境报告 ${item.id}读取失败：${error.message}`);
    }
  }
  if (!reports.length) throw new Error('no water quality reports');
  reports.sort((a, b) => (b.month ?? '').localeCompare(a.month ?? '') || (a.kind === b.kind ? 0 : a.kind === 'grade' ? -1 : 1));
  return {
    status: 'current',
    checkedAt: new Date(now).toISOString(),
    generatedAt: new Date().toISOString(),
    source: WATER_SOURCE,
    sections,
    reports,
  };
}
