import { readFileSync } from 'node:fs';
import { fetchOfficialAlerts, unavailableAlerts } from './alerts.mjs';
import { emptyHistory, emptyObservations, fetchCurrentObservation, fetchObservationHistory } from './observations.mjs';
import { emptyWeather, fetchRegionalWeather } from './weather.mjs';
import { emptySoilProfile, fetchSoilProfile } from './soil.mjs';
import { emptyAgro, fetchAgro } from './agro.mjs';
import { deriveCrops } from './crops.mjs';

const MINUTE = 60 * 1000;

function readSnapshot(name, emptyValue, validate) {
  try {
    const snapshot = JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
    return validate(snapshot) ? { ...snapshot, status: 'cached' } : emptyValue;
  } catch {
    return emptyValue;
  }
}

function readWeatherSnapshot() {
  return readSnapshot('weather-snapshot.json', emptyWeather, (snapshot) => snapshot.current?.time && snapshot.fetchedAt);
}

function cachedRequest(load, interval, onError, now) {
  let entry;
  let expiresAt = 0;
  let pending;

  return () => {
    if (entry && now() < expiresAt) return Promise.resolve(entry);
    if (pending) return pending;

    pending = load().then((value) => {
      entry = value;
      expiresAt = now() + interval;
      return value;
    }).catch(() => {
      entry = onError(entry);
      expiresAt = now() + MINUTE;
      return entry;
    }).finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

export function createApiMiddleware({ env = process.env, fetcher = fetch, now = () => Date.now() } = {}) {
  const weather = cachedRequest(
    () => fetchRegionalWeather(fetcher, now),
    15 * MINUTE,
    (previous) => previous?.current ? { ...previous, status: 'cached' } : readWeatherSnapshot(),
    now,
  );
  const alerts = cachedRequest(() => fetchOfficialAlerts(env, fetcher, now), 5 * MINUTE, () => unavailableAlerts, now);
  const observations = cachedRequest(
    () => fetchCurrentObservation(fetcher, now), 10 * MINUTE,
    (previous) => {
      if (previous?.current) return { ...previous, status: 'cached' };
      const snapshot = readSnapshot('observations-snapshot.json', emptyObservations, (value) => value.current?.time);
      const { status, source, location, fetchedAt, current } = snapshot;
      return { status, source, location, fetchedAt, current };
    },
    now,
  );
  const observationHistory = cachedRequest(
    () => fetchObservationHistory(fetcher, now), 10 * MINUTE,
    (previous) => {
      if (previous?.history?.length) return { ...previous, historyStatus: 'cached' };
      const snapshot = readSnapshot('observations-snapshot.json', null, (value) => value.history?.length);
      return snapshot ? { ...emptyHistory, history: snapshot.history, historyStatus: 'cached' } : emptyHistory;
    },
    now,
  );
  const soilProfile = cachedRequest(
    () => fetchSoilProfile(fetcher, now), 6 * 60 * MINUTE,
    (previous) => previous?.days?.length ? { ...previous, status: 'cached' }
      : readSnapshot('soil-profile-snapshot.json', emptySoilProfile, (snapshot) => snapshot.days?.length && snapshot.fetchedAt),
    now,
  );
  const agro = cachedRequest(
    () => fetchAgro(fetcher, now), 6 * 60 * MINUTE,
    (previous) => previous?.daily?.length ? { ...previous, status: 'cached' }
      : readSnapshot('agro-snapshot.json', emptyAgro, (snapshot) => snapshot.daily?.length && snapshot.fetchedAt),
    now,
  );
  // 作物决策由已缓存的逐时预报 + 农业气象日值派生；两者都拿不到时让请求失败，前端回退到快照文件。
  const crops = cachedRequest(
    async () => {
      const result = deriveCrops(await weather(), await agro(), now);
      if (!result.stages.length) throw new Error('Crop decisions need weather and agro data');
      return result;
    },
    15 * MINUTE,
    (previous) => {
      if (previous?.stages?.length) return { ...previous, status: 'cached' };
      throw new Error('Crop decisions unavailable');
    },
    now,
  );
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
  ]);

  return (req, res, next) => {
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
}
