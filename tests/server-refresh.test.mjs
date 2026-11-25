import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiMiddleware } from '../server/api.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { parseListing, parseWaterReport } from '../server/waterQuality.mjs';
import { refreshNdvi } from '../server/ndvi.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE = Date.parse('2026-11-25T08:00:00Z');
const isoDay = (time) => new Date(time).toISOString().slice(0, 10);

const jsonResponse = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });
const textResponse = (value) => ({ ok: true, status: 200, json: async () => JSON.parse(value), text: async () => value });

// 调用一个接口：等它真正返回（或把错误交给 next）。
function request(middleware, path) {
  return new Promise((resolve, reject) => {
    let status;
    middleware({ url: path, method: 'GET' }, {
      writeHead(code) { status = code; },
      end(body) { resolve({ status, body: body ? JSON.parse(body) : null }); },
    }, reject);
  });
}

test('水环境：列表与两种报告表格的解析', () => {
  const listing = `
    <div class="list_div"><div><a href="http://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_22.html" target="_blank">主要江河水质月报（2026年9月）</a></div>
    <td>发布时间： 2026-11-12</td></div>
    <div class="list_div"><div><a href="http://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_11.html" target="_blank">主要江河断面河流水质指数表（2025年9月）</a></div>
    <td>发布时间： 2025-10-27</td></div>`;
  assert.deepEqual(parseListing(listing), [
    { id: 'post_22', title: '主要江河水质月报（2026年9月）', publishedAt: '2026-11-12',
      url: 'https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_22.html' },
    { id: 'post_11', title: '主要江河断面河流水质指数表（2025年9月）', publishedAt: '2025-10-27',
      url: 'https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_11.html' },
  ]);

  const sections = [{ id: 'zhuhai-bridge', river: '磨刀门水道', name: '珠海大桥' }];
  const grade = parseWaterReport(`
    <table><tr><td>页眉</td></tr></table>
    <table border="1"><tr><th>河段名称</th><th>断面名称</th><th>水质目标</th><th>水质现状</th><th>是否达标</th><th>超标污染物</th><th>数据来源</th></tr>
    <tr><td>磨刀门水道</td><td>珠海大桥</td><td>Ⅱ类</td><td>Ⅲ类</td><td>否</td><td>氨氮</td><td>国家采测分离监测数据</td></tr>
    <tr><td>新水道</td><td>新断面</td><td>Ⅲ类</td><td>Ⅲ类</td><td>是</td><td></td><td></td></tr></table>`,
  { url: 'https://example.test/post_22.html', title: '主要江河水质月报（2026年9月）', publishedAt: '2026-11-12' }, sections);
  assert.equal(grade.month, '2026-09');
  assert.equal(grade.kind, 'grade');
  assert.deepEqual(grade.measurements, [
    { sectionId: 'zhuhai-bridge', grade: 'Ⅲ类', target: 'Ⅱ类', compliant: false, pollutants: '氨氮', provider: '国家采测分离监测数据' },
    { sectionId: 'section-新断面', grade: 'Ⅲ类', target: 'Ⅲ类', compliant: true, pollutants: '无', provider: null },
  ]);
  assert.deepEqual(sections.at(-1), { id: 'section-新断面', river: '新水道', name: '新断面' }, '新断面补进断面清单');

  const index = parseWaterReport(`
    <table><tr><th>所在河流</th><th>断面名称</th><th>采样时间</th><th>河流水质指数</th></tr>
    <tr><td>磨刀门水道</td><td>珠海大桥</td><td>2025年9月</td><td>2.3059</td></tr></table>`,
  { url: 'https://example.test/post_11.html', title: '水质指数表', publishedAt: '2025-10-27' }, sections);
  assert.equal(index.kind, 'index');
  assert.equal(index.month, '2025-09', '标题里没有月份时取采样时间');
  assert.deepEqual(index.measurements, [{ sectionId: 'zhuhai-bridge', index: 2.3059 }]);

  assert.equal(parseWaterReport('<table><tr><th>别的表</th></tr></table>', { url: 'u', title: 't' }), null, '认不出的版式不猜');
});

// 星历目录的模拟响应：按请求里的云量门槛返回影像；影像存储一律连不上。
function fakeSpaceCatalog(catalog, passes) {
  const state = { searches: [] };
  state.fetcher = async (url, options = {}) => {
    if (url.endsWith('/token/sentinel-2-l2a')) return jsonResponse({ token: 'sig' });
    if (url.endsWith('/search')) {
      const { query, datetime } = JSON.parse(options.body);
      state.searches.push({ datetime, cloudBelow: query?.['eo:cloud_cover']?.lt ?? Infinity });
      // 真实服务按请求里的 sortby 升序返回，这里照样排序
      const scenes = [...catalog, ...(passes ?? [])].filter((scene) => scene.cloud < (query?.['eo:cloud_cover']?.lt ?? Infinity))
        .sort((a, b) => a.datetime.localeCompare(b.datetime));
      return jsonResponse({ features: scenes.map((scene) => ({ id: scene.id,
        properties: { datetime: scene.datetime, 'eo:cloud_cover': scene.cloud },
        assets: { B04: { href: 'https://blob.test/red' }, B08: { href: 'https://blob.test/nir' } } })) });
    }
    throw new Error('image storage unreachable');
  };
  return state;
}

test('卫星苗情：目录里没有新影像时只检索、不下载', async () => {
  const known = { date: '2026-10-07', cloudCover: 0.87, tile: '20261007T062706', ndvi: { dahao: 0.294, xiaohao: 0.279, overall: 0.27 } };
  const catalog = [{ id: 'S2A_MSIL2A_20261007T062706_R_T49QGE_20261007T062706', datetime: '2026-10-07T06:27:06Z', cloud: 0.87 }];
  const passes = [
    { id: 'p24', datetime: '2026-11-24T03:00:31Z', cloud: 58 },
    { id: 'p19', datetime: '2026-11-19T03:00:19Z', cloud: 99.6 },
  ];
  const logs = [];
  const space = fakeSpaceCatalog(catalog, passes);
  const result = await refreshNdvi({ previous: { scenes: [known] }, fetcher: space.fetcher, now: BASE, log: (line) => logs.push(line) });
  assert.deepEqual(space.searches.map(({ datetime }) => datetime.split('/')[1]), [isoDay(BASE + DAY), isoDay(BASE + DAY)]);
  assert.equal(space.searches[0].datetime.split('/')[0], isoDay(BASE - 240 * DAY), '检索近 240 天的少云影像');
  assert.equal(space.searches[1].cloudBelow, Infinity, '第二次检索不限云量，用来列出没采用的过境');
  assert.deepEqual(result.scenes, [known], '已有的影像原样沿用');
  assert.deepEqual(result.skipped, [{ date: '2026-11-19', cloudCover: 99.6 }, { date: '2026-11-24', cloudCover: 58 }]);
  assert.equal(result.status, 'current');
  assert.equal(result.checkedAt, new Date(BASE).toISOString());
  assert.deepEqual(logs, []);
});

test('卫星苗情：新影像下载不到就跳过，留到下一轮再试', async () => {
  const known = { date: '2026-10-07', cloudCover: 0.87, tile: '20261007T062706', ndvi: { dahao: 0.294, xiaohao: 0.279, overall: 0.27 } };
  const catalog = [
    { id: 'S2A_MSIL2A_20261007T062706_R_T49QGE_20261007T062706', datetime: '2026-10-07T06:27:06Z', cloud: 0.87 },
    { id: 'S2B_MSIL2A_20261116T062708_R_T49QGE_20261116T062708', datetime: '2026-11-16T06:27:08Z', cloud: 28.3 },
  ];
  const logs = [];
  const space = fakeSpaceCatalog(catalog);
  const result = await refreshNdvi({ previous: { scenes: [known] }, fetcher: space.fetcher, now: BASE, log: (line) => logs.push(line) });
  assert.deepEqual(result.scenes, [known]);
  assert.equal(result.status, 'current', '取不到新影像不算整体失败，已有的结果照常提供');
  assert.deepEqual(logs, ['NDVI 2026-11-16跳过：Request failed'], '只记一条跳过日志，已有的结果不受影响');
});

test('数据接口：磁盘上足够新的结果直接使用；过期后取数失败则沿用并标为缓存', async () => {
  const store = createMemoryStore();
  await store.write('weather.json', { status: 'current', fetchedAt: new Date(BASE - 5 * MINUTE).toISOString(), current: { time: 't' }, marker: 'disk' });
  let clock = BASE;
  const calls = [];
  const logs = [];
  const middleware = createApiMiddleware({
    store, schedule() {}, log: (line) => logs.push(line), now: () => clock,
    fetcher: async (url) => { calls.push(url); throw new Error('offline'); },
  });

  const fresh = await request(middleware, '/api/weather');
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.marker, 'disk');
  assert.equal(fresh.body.status, 'current');
  assert.equal(calls.length, 0, '结果还在有效期内，不访问上游');

  clock = BASE + 16 * MINUTE;
  const stale = await request(middleware, '/api/weather');
  assert.equal(calls.length, 1, '过了有效期才重新取数');
  assert.equal(stale.body.marker, 'disk');
  assert.equal(stale.body.status, 'cached', '上游不通时沿用磁盘上的结果');
  assert.ok(logs.some((line) => /\[取数失败\] 区域天气/.test(line)));
});

test('数据接口：预警不从磁盘恢复，避免把停机期间已解除的预警当成生效中', async () => {
  const store = createMemoryStore();
  let clock = BASE;
  const middleware = createApiMiddleware({ store, schedule() {}, log() {}, now: () => clock,
    fetcher: async () => { throw new Error('offline'); } });
  const { body } = await request(middleware, '/api/alerts');
  assert.equal(body.status, 'unavailable');
  assert.equal(await store.read('alerts.json'), null, '预警结果不写盘');
});

test('数据接口：刷新型数据过期后当场核对，新结果落盘', async () => {
  const store = createMemoryStore();
  await store.write('water-quality.json', {
    status: 'current', checkedAt: new Date(BASE - 2 * DAY).toISOString(), source: {}, sections: [],
    reports: [{ month: '2026-01', publishedAt: '2026-01-01', url: 'https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_1.html',
      kind: 'grade', measurements: [{ sectionId: 'zhuhai-bridge', grade: 'Ⅱ类' }] }],
  });
  const fetcher = async (url) => {
    if (url.endsWith('szhj/index.html')) return textResponse(`
      <a href="http://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_2.html" target="_blank">主要江河水质月报（2026年9月）</a>
      <td>发布时间： 2026-11-12</td>
      <a href="http://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/content/post_1.html" target="_blank">旧报告</a><td>发布时间： 2026-01-01</td>`);
    if (url.endsWith('post_2.html')) return textResponse(`
      <table><tr><th>河段名称</th><th>断面名称</th><th>水质目标</th><th>水质现状</th><th>是否达标</th><th>超标污染物</th><th>数据来源</th></tr>
      <tr><td>磨刀门水道</td><td>珠海大桥</td><td>Ⅱ类</td><td>Ⅱ类</td><td>是</td><td>无</td><td></td></tr></table>`);
    throw new Error(`unexpected request ${url}`);
  };
  const middleware = createApiMiddleware({ store, fetcher, schedule() {}, log() {}, now: () => BASE });
  const { status, body } = await request(middleware, '/api/water-quality');
  assert.equal(status, 200);
  assert.equal(body.status, 'current');
  assert.equal(body.checkedAt, new Date(BASE).toISOString());
  assert.deepEqual(body.reports.map(({ month }) => month), ['2026-09', '2026-01'], '新报告排在前，旧报告保留');
  assert.equal((await store.read('water-quality.json')).reports.length, 2, '结果落盘');

  const again = await request(middleware, '/api/water-quality');
  assert.equal(again.body.status, 'current', '刚核对过，不再访问来源');
});

test('数据接口：磁盘为空时先用随构建发布的快照', async () => {
  const middleware = createApiMiddleware({ store: createMemoryStore(), schedule() {}, log() {}, now: () => BASE,
    fetcher: async () => { throw new Error('offline'); } });
  const { body } = await request(middleware, '/api/ndvi');
  assert.equal(body.status, 'cached');
  assert.ok(body.scenes.length > 0);
});

test('数据接口：生效过的预警自动记入档案，解除后仍可查到', async () => {
  const store = createMemoryStore();
  const warning = '101280602-20261125075500-0202.html';
  let relieved = false;
  const fetcher = async (url) => {
    const address = String(url);
    if (address.endsWith('grepalarm_cn.php')) return textResponse(`var alarminfo = ${JSON.stringify(relieved ? { count: '0', data: [] }
      : { count: '1', data: [['广东珠海', warning, '', '', 'warning-1', '', '珠海市雷雨大风黄色预警']] })};`);
    if (address.includes('/alarm/webdata/')) return textResponse(`var alarminfo = ${JSON.stringify({
      ISSUETIME: '2026-11-25 07:55:00', RELIEVETIME: '', msgType: '发布', SIGNALLEVEL: '黄色',
      ISSUECONTENT: '珠海市气象台于11月25日7时55分发布雷雨大风黄色预警信号。',
    })};`);
    throw new Error(`unexpected request ${address}`);
  };
  const middleware = createApiMiddleware({ store, fetcher, schedule() {}, log() {}, now: () => BASE });
  const active = await request(middleware, '/api/alerts');
  assert.deepEqual(active.body.alerts.map(({ id }) => id), ['warning-1']);

  relieved = true;
  // 6 分钟后再次取数（新进程，磁盘缓存还在）：预警已解除，不再出现在生效列表里
  const later = createApiMiddleware({ store, fetcher, schedule() {}, log() {}, now: () => BASE + 6 * MINUTE });
  assert.deepEqual((await request(later, '/api/alerts')).body.alerts, []);
  const history = await request(later, '/api/alert-history');
  assert.equal(history.body.status, 'current');
  assert.deepEqual(history.body.alerts.map(({ id, title, firstSeen }) => [id, title, firstSeen]),
    [['warning-1', '珠海市雷雨大风黄色预警', new Date(BASE).toISOString()]]);
});

test('数据接口：后台任务只在站点服务启动后才开始', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const middleware = createApiMiddleware({ store: createMemoryStore(), log() {}, now: () => BASE,
    fetcher: async (url) => { calls.push(url); throw new Error('offline'); } });
  context.mock.timers.tick(10_000);
  assert.deepEqual(calls, [], '只创建接口、没启动服务时不取数（vite build 就是这样）');

  middleware.start();
  middleware.start();
  context.mock.timers.tick(10_000);
  await new Promise((resolve) => setImmediate(resolve));  // 定时器触发的取数要到微任务里才发出请求
  middleware.stop();
  const hosts = [...new Set(calls.map((url) => new URL(url).host))];
  assert.ok(hosts.includes('api.open-meteo.com'), '启动后按周期取天气');
  assert.ok(hosts.some((host) => /weather\.com\.cn$/.test(host)), '启动后按周期取预警');
});
