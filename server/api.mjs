import { readFileSync } from 'node:fs';
import { fetchOfficialAlerts, unavailableAlerts } from './alerts.mjs';
import { emptyObservations, fetchObservations } from './observations.mjs';
import { emptyWeather, fetchRegionalWeather } from './weather.mjs';
import { emptySoilProfile, fetchSoilProfile } from './soil.mjs';
import { emptyAgro, fetchAgro } from './agro.mjs';

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
    () => fetchObservations(fetcher, now), 10 * MINUTE,
    (previous) => previous?.current ? { ...previous, status: 'cached' } : emptyObservations,
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
  const routes = new Map([
    ['/api/weather', weather],
    ['/api/observations', observations],
    ['/api/soil-profile', soilProfile],
    ['/api/agro', agro],
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
