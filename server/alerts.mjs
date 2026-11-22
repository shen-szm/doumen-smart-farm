import { DOUMEN } from './weather.mjs';

const SOURCE = Object.freeze({ name: '和风天气 · 官方预警', url: 'https://dev.qweather.com/docs/api/warning/weather-alert/' });
const NATIONAL = new URL('https://product.weather.com.cn/alarm/grepalarm_cn.php');
const NATIONAL_SOURCE = Object.freeze({ name: '中国天气网 · 全国生效预警', url: 'https://www.weather.com.cn/alarm/' });
const LOCAL_AREA = /^(?:广东(?:省)?)?珠海(?:市)?(?:斗门(?:区)?.*)?$/;
const FILE_PARTS = /^(\d{6,10})-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})\.html$/;
const LEVELS = {
  '红色': 'red', '橙色': 'orange', '黄色': 'yellow', '蓝色': 'blue', '白色': 'white',
};
const LEVEL_CODES = { '01': '蓝色', '02': '黄色', '03': '橙色', '04': '红色' };
const RANK = { red: 5, orange: 4, yellow: 3, blue: 2, white: 1 };

export const unavailableAlerts = Object.freeze({
  status: 'unavailable',
  source: NATIONAL_SOURCE,
  location: DOUMEN,
  fetchedAt: null,
  alerts: [],
  attributions: [],
});

function activeTime(alert, now) {
  const start = Date.parse(alert.effectiveTime ?? alert.issuedTime);
  const end = alert.expireTime ? Date.parse(alert.expireTime) : Infinity;
  return start <= now && end > now;
}

export function normalizeAlerts(payload, now) {
  if (!Array.isArray(payload.alerts) && payload.metadata?.zeroResult !== true) {
    throw new Error('Incomplete QWeather response');
  }

  const records = payload.alerts ?? [];
  const superseded = new Set(records.flatMap((entry) => {
    const message = entry.messageType;
    const effective = Date.parse(entry.effectiveTime ?? entry.issuedTime);
    if ((message?.code === 'update' || message?.code === 'cancel') && effective <= now) {
      return Array.isArray(message.supersedes) ? message.supersedes : [];
    }
    return [];
  }));

  return {
    status: 'current',
    source: SOURCE,
    location: DOUMEN,
    fetchedAt: new Date(now).toISOString(),
    attributions: Array.isArray(payload.metadata?.attributions)
      ? payload.metadata.attributions.filter((value) => typeof value === 'string')
      : [],
    alerts: records.filter((entry) => entry.id && entry.messageType?.code !== 'cancel' &&
      !superseded.has(entry.id) && activeTime(entry, now)).map((entry) => ({
      id: entry.id,
      title: entry.headline || entry.eventType?.name || '天气预警',
      issuer: entry.senderName || null,
      area: null,
      startsAt: entry.effectiveTime ?? entry.issuedTime,
      endsAt: entry.expireTime ?? null,
      description: entry.description ?? '',
      severity: entry.severity ?? 'unknown',
      color: entry.color?.code?.toLowerCase() ?? null,
      instruction: entry.instruction ?? '',
      url: 'https://www.zhuhai.gov.cn/zw/yjgl/yjgg/',
    })),
  };
}

async function fetchQWeatherAlerts(env, fetcher, now) {
  const host = env.QWEATHER_HOST?.trim();
  const key = env.QWEATHER_KEY?.trim();
  const url = new URL(host.startsWith('https://') ? host : `https://${host}`);
  if (!url.hostname.endsWith('.qweatherapi.com') || url.username || url.password || url.port) {
    throw new Error('Invalid QWeather API host');
  }
  url.pathname = `/weatheralert/v1/current/${DOUMEN.latitude}/${DOUMEN.longitude.toFixed(2)}`;
  url.search = 'lang=zh&localTime=true';
  url.hash = '';

  const response = await fetcher(url, {
    headers: { 'X-QW-Api-Key': key },
    signal: AbortSignal.timeout(6000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`QWeather returned HTTP ${response.status}`);
  return normalizeAlerts(await response.json(), now());
}

function parseChinaWeatherAssignment(body) {
  const wrapped = body.trim().match(/^var\s+alarminfo\s*=\s*(\{[\s\S]*\})\s*;?$/);
  if (!wrapped) throw new Error('Unexpected China Weather public warnings format');
  return JSON.parse(wrapped[1]);
}

function localTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value.replace(' ', 'T')}+08:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function normalizeNationalAlertList(body, now) {
  const { count, data } = parseChinaWeatherAssignment(body);
  if (!Array.isArray(data) || !/^\d+$/.test(count) || Number(count) !== data.length ||
    data.some((row) => !Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string')) {
    throw new Error('Incomplete China Weather public warnings list');
  }
  const active = new Map();
  for (const [area, filename, , , identifier, , label] of data) {
    if (!LOCAL_AREA.test(area)) continue;
    const parts = FILE_PARTS.exec(filename);
    if (!parts || typeof label !== 'string') throw new Error('Incomplete Zhuhai warning entry');
    const [, , year, month, day, hour, minute, second, , levelCode] = parts;
    const startsAt = localTime(`${year}-${month}-${day} ${hour}:${minute}:${second}`);
    if (!startsAt || Date.parse(startsAt) > now || /解除|取消/.test(label)) continue;
    const severity = label.match(/(红色|橙色|黄色|蓝色|白色)预警/)?.[1] ?? LEVEL_CODES[levelCode] ?? '未提供';
    const id = identifier || filename;
    active.set(id, {
      id, filename, title: label, issuer: null, area, startsAt, endsAt: null, description: '',
      severity, color: LEVELS[severity] ?? null, instruction: '',
      url: `https://www.weather.com.cn/alarm/newalarmcontent.shtml?file=${encodeURIComponent(filename)}`,
    });
  }
  return [...active.values()];
}

async function loadChinaWeather(url, fetcher) {
  const response = await fetcher(url, {
    headers: { Referer: NATIONAL_SOURCE.url },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`China Weather warnings HTTP ${response.status}`);
  if (Number(response.headers?.get('Age')) > 600) throw new Error('China Weather returned a stale warnings list');
  return response.text();
}

async function attachNationalAlertDetails(entry, fetcher, now) {
  const { filename, ...summary } = entry;
  let detail;
  try {
    const url = new URL(`/alarm/webdata/${filename}`, NATIONAL);
    detail = parseChinaWeatherAssignment(await loadChinaWeather(url, fetcher));
  } catch {
    return summary;
  }
  const startsAt = localTime(detail.ISSUETIME) ?? summary.startsAt;
  const endsAt = localTime(detail.RELIEVETIME);
  if (detail.msgType?.toLowerCase() === 'cancel' || Date.parse(startsAt) > now ||
    (endsAt && Date.parse(endsAt) <= now)) return null;
  const description = typeof detail.ISSUECONTENT === 'string' ? detail.ISSUECONTENT : '';
  const issuedBy = description.match(/^([^，。；：:\d]{2,42}?(?:气象台|气象局))/)?.[1];
  const severity = typeof detail.SIGNALLEVEL === 'string' && detail.SIGNALLEVEL ? detail.SIGNALLEVEL : summary.severity;
  return {
    ...summary, startsAt, endsAt, description, severity,
    color: LEVELS[severity] ?? summary.color, issuer: issuedBy ?? null,
  };
}

async function fetchNationalAlerts(fetcher, clock) {
  const body = await loadChinaWeather(NATIONAL, fetcher);
  const now = clock();
  const local = normalizeNationalAlertList(body, now);
  const enriched = await Promise.all(local.map((entry) => attachNationalAlertDetails(entry, fetcher, now)));
  return {
    status: 'current',
    source: NATIONAL_SOURCE,
    location: { name: '珠海市及斗门区' },
    fetchedAt: new Date(now).toISOString(),
    alerts: enriched.filter(Boolean).sort((a, b) => (RANK[b.color] ?? 0) - (RANK[a.color] ?? 0) ||
      Date.parse(b.startsAt) - Date.parse(a.startsAt)),
    attributions: ['中国天气网', '国家预警信息发布中心'],
  };
}

export async function fetchOfficialAlerts(env, fetcher = fetch, now = () => Date.now()) {
  if (env.QWEATHER_HOST?.trim() && env.QWEATHER_KEY?.trim()) {
    try {
      return await fetchQWeatherAlerts(env, fetcher, now);
    } catch {
      // The public national list also covers city-level operational announcements.
    }
  }
  return fetchNationalAlerts(fetcher, now);
}
