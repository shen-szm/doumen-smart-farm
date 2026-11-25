import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchOfficialAlerts, unavailableAlerts } from './alerts.mjs';
import { emptyHistory, emptyObservations, fetchCurrentObservation, fetchObservationHistory } from './observations.mjs';
import { emptyWeather, fetchRegionalWeather } from './weather.mjs';
import { emptySoilProfile, fetchSoilProfile } from './soil.mjs';
import { emptyAgro, fetchAgro } from './agro.mjs';
import { deriveCrops } from './crops.mjs';
import { createStore } from './store.mjs';
import { createScheduler } from './scheduler.mjs';
import { refreshNdvi } from './ndvi.mjs';
import { refreshSatelliteSoil } from './satelliteSoil.mjs';
import { refreshWaterQuality } from './waterQuality.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// 自动记录的预警保留 90 天。
const ALERT_HISTORY_DAYS = 90;
// 页面请求触发的核对最多等这么久；没算完就先返回上一次的结果，后台继续。
const REQUEST_WAIT_MS = 4000;

// 大屏上的每一项数据都在服务器后台按时刷新，页面只读取结果：
// - 取数型接口（天气、实况、预警、墒情、农业气象、作物决策）：按各自的周期主动取数，没人打开页面也照常刷新。
//   最近一次成功的结果写入 data-cache/，进程重启或上游中断时顶上，比随构建发布的快照新。
// - 刷新型数据（卫星苗情、卫星表层墒情、区域水环境）：定时到来源核对，只补新增的部分。
export function createApiMiddleware({
  env = process.env, fetcher = fetch, now = () => Date.now(), store = createStore(), schedule, log = console.error,
} = {}) {
  // 后台任务先登记，等站点服务启动（start()）后再开始计时：vite build 加载配置文件时也会创建这个中间件，
  // 那时不应该触发任何取数。测试时传入空的 schedule 即可关闭后台任务。
  const jobs = [];
  const scheduler = createScheduler({ log });
  const queue = schedule ?? ((job) => jobs.push(job));
  let started = false;

  const bundled = (name) => {
    try {
      return JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
    } catch {
      return null;
    }
  };
  // 随构建发布的快照：服务器从来没有成功取到数据时的最后兜底。
  const snapshotOr = (name, emptyValue, validate) => {
    const snapshot = bundled(name);
    return snapshot && validate(snapshot) ? { ...snapshot, status: 'cached' } : emptyValue;
  };

  // 带缓存的一次取数。成功的结果在一个周期内直接复用；取数失败就沿用上一次的结果并标为 cached。
  // 进程刚启动时，「上一次的结果」先从磁盘读取：取数时间距现在不足一个周期的，直接使用，不必再等上游。
  function cachedRequest({ file, label, load, interval, fallback, delay }) {
    let entry;
    let expiresAt = 0;
    let pending;
    let ready;
    const request = () => {
      ready ??= Promise.resolve().then(async () => {
        const saved = file ? await store.read(`${file}.json`) : null;
        if (!saved) return;
        entry = saved;
        const age = now() - Date.parse(saved.fetchedAt);
        if (Number.isFinite(age) && age >= 0 && age < interval) expiresAt = now() + interval - age;
      });
      return ready.then(() => {
        if (entry && now() < expiresAt) return entry;
        if (pending) return pending;
        pending = load().then(async (value) => {
          entry = value;
          expiresAt = now() + interval;
          if (file) await store.write(`${file}.json`, value).catch(() => {});
          return value;
        }).catch((error) => {
          log(`[取数失败] ${label}：${error?.message ?? error}。沿用上一次的结果。`);
          entry = fallback(entry);
          expiresAt = now() + MINUTE;
          return entry;
        }).finally(() => {
          pending = undefined;
        });
        return pending;
      });
    };
    queue({ name: label, interval, delay, run: request });
    return request;
  }

  // 刷新型数据：定时执行 refresh 得到完整结果并落盘，接口直接返回最近一次结果。
  // refresh 收到上一次的结果，只补新增的部分。
  function scheduledReading({ file, label, refresh, interval, delay, validate, emptyValue }) {
    let entry;
    let pending;
    let ready;
    let failedAt = 0;
    const run = () => {
      if (pending) return pending;
      pending = (async () => {
        await ready;
        try {
          const next = await refresh(entry);
          if (!validate(next)) throw new Error('来源没有返回可用的数据');
          entry = next;
          failedAt = 0;
          await store.write(`${file}.json`, next).catch((error) => log(`[后台刷新] ${label}结果写入磁盘失败：${error?.message ?? error}`));
        } catch (error) {
          // 保留上一次的结果，等下一个周期再试。
          failedAt = now();
          if (entry && entry.status !== 'unavailable') entry = { ...entry, status: 'cached' };
          log(`[后台刷新] ${label}失败：${error?.message ?? error}`);
        }
        return entry;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    };
    ready = Promise.resolve().then(async () => {
      entry = await store.read(`${file}.json`);
      if (entry && !validate(entry)) entry = null;
      if (!entry) entry = snapshotOr(`${file}-snapshot.json`, null, validate);
      entry ??= emptyValue;
    });
    queue({ name: label, interval, delay, run });
    return async () => {
      await ready;
      const age = now() - Date.parse(entry.checkedAt);
      const stale = entry.status === 'unavailable' || !Number.isFinite(age) || age > interval;
      // 上次核对已超过一个周期（例如电脑刚开机）就当场核对一次；刚失败过则一分钟内不再重试。
      if (stale && now() - failedAt >= MINUTE) {
        await Promise.race([run(), sleep(REQUEST_WAIT_MS, undefined, { ref: false })]);
      }
      return entry;
    };
  }

  // 预警记录：每次取到的生效预警都记下来，来过又解除的预警也能在档案里查到。
  let alertHistoryReady;
  const recordAlerts = async (value) => {
    if (value?.status !== 'current') return;
    alertHistoryReady ??= Promise.resolve().then(async () => new Map(
      ((await store.read('alert-history.json'))?.alerts ?? []).map((alert) => [alert.id, alert])));
    const history = await alertHistoryReady;
    const seenAt = new Date(now()).toISOString();
    for (const alert of value.alerts ?? []) {
      history.set(alert.id, { ...alert, firstSeen: history.get(alert.id)?.firstSeen ?? seenAt, lastSeen: seenAt });
    }
    const cutoff = now() - ALERT_HISTORY_DAYS * DAY;
    for (const [id, alert] of history) if (Date.parse(alert.startsAt) < cutoff) history.delete(id);
    await store.write('alert-history.json', { generatedAt: seenAt, alerts: [...history.values()] });
  };

  const weather = cachedRequest({
    file: 'weather', label: '区域天气', delay: 3_000,
    load: () => fetchRegionalWeather(fetcher, now), interval: 15 * MINUTE,
    fallback: (previous) => previous?.current ? { ...previous, status: 'cached' }
      : snapshotOr('weather-snapshot.json', emptyWeather, (snapshot) => snapshot.current?.time && snapshot.fetchedAt),
  });
  const alerts = cachedRequest({
    label: '官方预警', delay: 6_000,
    load: async () => {
      const value = await fetchOfficialAlerts(env, fetcher, now);
      // 预警不从磁盘恢复（停机期间解除的预警会被当成仍在生效），只记录、不复用。
      await recordAlerts(value).catch((error) => log(`[预警记录] 写入失败：${error?.message ?? error}`));
      return value;
    },
    interval: 5 * MINUTE,
    fallback: () => unavailableAlerts,
  });
  const observations = cachedRequest({
    file: 'observations', label: '斗门站实况', delay: 9_000,
    load: () => fetchCurrentObservation(fetcher, now), interval: 10 * MINUTE,
    fallback: (previous) => {
      if (previous?.current) return { ...previous, status: 'cached' };
      const snapshot = snapshotOr('observations-snapshot.json', emptyObservations, (value) => value.current?.time);
      const { status, source, location, fetchedAt, current } = snapshot;
      return { status, source, location, fetchedAt, current };
    },
  });
  const observationHistory = cachedRequest({
    file: 'observation-history', label: '斗门站整点实况', delay: 12_000,
    load: () => fetchObservationHistory(fetcher, now), interval: 10 * MINUTE,
    fallback: (previous) => {
      if (previous?.history?.length) return { ...previous, historyStatus: 'cached' };
      const snapshot = snapshotOr('observations-snapshot.json', null, (value) => value.history?.length);
      return snapshot ? { ...emptyHistory, history: snapshot.history, historyStatus: 'cached' } : emptyHistory;
    },
  });
  const soilProfile = cachedRequest({
    file: 'soil-profile', label: '土壤剖面', delay: 15_000,
    load: () => fetchSoilProfile(fetcher, now), interval: 6 * HOUR,
    fallback: (previous) => previous?.days?.length ? { ...previous, status: 'cached' }
      : snapshotOr('soil-profile-snapshot.json', emptySoilProfile, (snapshot) => snapshot.days?.length && snapshot.fetchedAt),
  });
  const agro = cachedRequest({
    file: 'agro', label: '农业气象', delay: 20_000,
    load: () => fetchAgro(fetcher, now), interval: 6 * HOUR,
    fallback: (previous) => previous?.daily?.length ? { ...previous, status: 'cached' }
      : snapshotOr('agro-snapshot.json', emptyAgro, (snapshot) => snapshot.daily?.length && snapshot.fetchedAt),
  });
  // 作物决策由已缓存的逐时预报 + 农业气象日值派生；两者都拿不到时让请求失败，前端回退到快照文件。
  const crops = cachedRequest({
    file: 'crops', label: '作物决策', delay: 25_000,
    load: async () => {
      const result = deriveCrops(await weather(), await agro(), now);
      if (!result.stages.length) throw new Error('Crop decisions need weather and agro data');
      return result;
    },
    interval: 15 * MINUTE,
    fallback: (previous) => {
      if (previous?.stages?.length) return { ...previous, status: 'cached' };
      throw new Error('Crop decisions unavailable');
    },
  });
  const ndvi = scheduledReading({
    file: 'ndvi', label: '卫星苗情', delay: 40_000, interval: 6 * HOUR,
    refresh: (previous) => refreshNdvi({ previous, fetcher, now: now(), log }),
    validate: (value) => value.scenes?.length > 0,
    emptyValue: { status: 'unavailable', scenes: [], skipped: [] },
  });
  const satelliteSoil = scheduledReading({
    file: 'satellite-soil', label: '卫星表层墒情', delay: 70_000, interval: 6 * HOUR,
    refresh: (previous) => refreshSatelliteSoil({ previous, fetcher, now: now(), dir: store.dir, log }),
    validate: (value) => value.points?.length > 0,
    emptyValue: { status: 'unavailable', points: [] },
  });
  const waterQuality = scheduledReading({
    file: 'water-quality', label: '区域水环境', delay: 100_000, interval: DAY,
    refresh: (previous) => refreshWaterQuality({ previous, fetcher, now: now(), log }),
    validate: (value) => value.reports?.length > 0,
    emptyValue: { status: 'unavailable', sections: [], reports: [] },
  });

  const routes = new Map([
    ['/api/weather', weather],
    ['/api/observations', async () => {
      const [current, history] = await Promise.all([observations(), observationHistory()]);
      return { ...current, ...history };
    }],
    ['/api/soil-profile', soilProfile],
    ['/api/agro', agro],
    ['/api/crops', crops],
    ['/api/alerts', async () => {
      const result = await alerts();
      return { ...result, alerts: result.alerts.filter(({ endsAt }) => !endsAt || Date.parse(endsAt) > now()) };
    }],
    ['/api/alert-history', async () => {
      const saved = await store.read('alert-history.json');
      const history = saved?.alerts ?? [];
      history.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
      return { status: saved ? 'current' : 'unavailable', generatedAt: saved?.generatedAt ?? null, alerts: history };
    }],
    ['/api/ndvi', ndvi],
    ['/api/satellite-soil', satelliteSoil],
    ['/api/water-quality', waterQuality],
  ]);

  const middleware = (req, res, next) => {
    const route = routes.get(req.url?.split('?')[0]);
    if (!route) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    route().then((data) => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    }).catch(next);
  };
  // 由站点服务在启动时调用：开始执行登记的后台任务。重复调用无效。
  middleware.start = () => {
    if (started) return;
    started = true;
    for (const job of jobs.splice(0)) scheduler.add(job);
  };
  middleware.stop = () => scheduler.stop();
  return middleware;
}
