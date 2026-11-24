import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchRegionalWeather } from '../server/weather.mjs';
import { fetchObservations } from '../server/observations.mjs';
import { fetchSoilProfile } from '../server/soil.mjs';
import { fetchAgro } from '../server/agro.mjs';
import { deriveCrops } from '../server/crops.mjs';

const dataDir = new URL('../public/data/', import.meta.url);
const indexUrl = 'https://data.mendeley.com/public-api/datasets/35wh56287y/files?folder_id=root&version=2';
const timezone = 'Europe/Rome';
const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone });
const replaySource = {
  name: 'Mendeley Data · 番茄田灌溉试验（第 2 版）',
  url: 'https://data.mendeley.com/datasets/35wh56287y/2',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  credit: 'Laura Belli, Luca Davoli, Giulia Oddi, Luca Preite, Martina Galaverni, Tommaso Ganino, Gianluigi Ferrari · 10.17632/35wh56287y.2',
  changes: '提取原始时间戳、种植行、土壤水分和水表读数，按试验地当地日期分组。',
};

async function requireResponse(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  return response;
}

function addReadings(days, csv, field, series) {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header.replace(/^\uFEFF/, '').split(',');
  const timestampColumn = columns.indexOf('ts_generation');
  const lineColumn = columns.indexOf('line');
  const valueColumn = columns.indexOf(field);
  if ([timestampColumn, lineColumn, valueColumn].includes(-1)) throw new Error(`Missing CSV columns for ${series}`);

  for (const row of rows) {
    if (row === header) continue; // The export repeats the header between crop lines.
    const cells = row.split(',');
    const timestamp = Number(cells[timestampColumn]);
    const line = cells[lineColumn];
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !['1', '2', '3'].includes(line)) {
      throw new Error(`Unexpected timestamp or crop line in ${series} CSV`);
    }

    const input = cells[valueColumn]?.trim();
    const value = input && input !== 'NULL' ? Number(input) : null;
    if (value !== null && !Number.isFinite(value)) throw new Error(`Unexpected numeric reading in ${series} CSV`);

    const date = localDay.format(timestamp);
    const day = days[date] ??= {};
    const record = day[line] ??= { soil: [], water: [] };
    record[series].push([timestamp, value]);
  }
}

async function downloadCsvs(names) {
  const files = await (await requireResponse(indexUrl)).json();
  return Promise.all(names.map(async (name) => {
    const file = files.find(({ filename }) => filename === name);
    if (!file?.content_details?.download_url) throw new Error(`Missing Mendeley dataset file ${name}`);
    return (await requireResponse(file.content_details.download_url)).text();
  }));
}

async function prepareReplay(directory) {
  const names = ['stuard_soil_data.csv', 'stuard_water_meter_data.csv'];
  const csvs = directory
    ? await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')))
    : await downloadCsvs(names);

  const days = {};
  addReadings(days, csvs[0], 'humidity', 'soil');
  addReadings(days, csvs[1], 'current_volume', 'water');
  const orderedDays = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
  let defaultDate = null;
  let bestRange = -1;

  for (const [date, day] of Object.entries(orderedDays)) {
    for (const { soil, water } of Object.values(day)) {
      soil.sort(([a], [b]) => a - b);
      water.sort(([a], [b]) => a - b);
    }

    // A full day with substantial water-meter movement makes the initial charts useful.
    const firstLine = day['1'];
    if (!firstLine || firstLine.soil.length < 120 || firstLine.water.length < 120) continue;
    const readings = firstLine.water.map(([, value]) => value).filter(Number.isFinite);
    if (!readings.length) continue;
    const range = Math.max(...readings) - Math.min(...readings);
    if (range > bestRange) {
      defaultDate = date;
      bestRange = range;
    }
  }

  if (!defaultDate) throw new Error('No sufficiently complete date in the experimental data');
  return {
    source: replaySource,
    location: '意大利帕尔马 · Stuard 农业试验站',
    timezone,
    units: { soil: '%RH', water: null, depthCm: 20 },
    waterUnitNote: '数据集说明将水表读数标为 m³，OY1310 设备手册的上报单位为 L。图表保留 CSV 原始读数。',
    waterUnitReference: 'https://www.nordicpropeye.com/wp-content/uploads/documents/Product-manuals/Manual-OY1310-LoRaWAN-Single-jet-smart-water-meter.pdf',
    defaultDate,
    days: orderedDays,
  };
}

async function writeDataset(name, value) {
  await writeFile(new URL(name, dataDir), `${JSON.stringify(value)}\n`, 'utf8');
}

const args = process.argv.slice(2);
const options = args.filter((arg) => arg.startsWith('--'));
const csvDirectory = args.find((arg) => !arg.startsWith('--'));
const validOptions = ['--weather', '--replay', '--soil', '--agro', '--observations'];
if (options.some((option) => !validOptions.includes(option)) || (csvDirectory && !options.includes('--replay')) || options.length !== new Set(options).size) {
  throw new Error('Usage: node scripts/refresh-data.mjs [--weather --observations --soil --agro --replay [csv-directory]]');
}

await mkdir(dataDir, { recursive: true });
const tasks = [];
let weatherSnapshot = null;
let agroSnapshot = null;
if (!options.length || options.includes('--observations')) {
  tasks.push(fetchObservations().then(async (observations) => {
    if (!observations.current?.time) throw new Error('Observation snapshot is missing the current record');
    await writeDataset('observations-snapshot.json', {
      ...observations, status: 'cached', historyStatus: observations.history.length ? 'cached' : 'unavailable',
    });
    console.log(`Observation snapshot ${observations.fetchedAt}, station time ${observations.current.time}`);
  }));
}
if (!options.length || options.includes('--weather')) {
  tasks.push(fetchRegionalWeather().then(async (weather) => {
    if (weather.hourly.length !== 24 || !weather.soil.some(({ moisture }) => moisture !== null)) {
      throw new Error('Open-Meteo snapshot is missing required records');
    }
    weatherSnapshot = weather;
    await writeDataset('weather-snapshot.json', { ...weather, status: 'cached' });
    console.log(`Open-Meteo snapshot ${weather.fetchedAt}, ${weather.hourly.length} forecast hours and ${weather.soil.length} soil readings`);
  }));
}
if (!options.length || options.includes('--soil')) {
  tasks.push(fetchSoilProfile().then(async (soil) => {
    if (soil.days.length < 14 || !soil.days.some(({ moisture }) => Object.values(moisture).some((value) => value !== null))) {
      throw new Error('Soil profile snapshot is missing required records');
    }
    await writeDataset('soil-profile-snapshot.json', { ...soil, status: 'cached' });
    console.log(`Soil profile snapshot ${soil.fetchedAt}, ${soil.days.length} days through ${soil.days.at(-1).date}`);
  }));
}
if (!options.length || options.includes('--agro')) {
  tasks.push(fetchAgro().then(async (agro) => {
    if (agro.daily.length < 30 || !Number.isFinite(agro.et0.latest)) {
      throw new Error('Agro snapshot is missing required records');
    }
    agroSnapshot = agro;
    await writeDataset('agro-snapshot.json', { ...agro, status: 'cached' });
    console.log(`Agro snapshot ${agro.fetchedAt}, ${agro.daily.length} days, ET0 ${agro.et0.latestDate} = ${agro.et0.latest} mm/d, ${agro.risks.length} risk events, reference crop ${agro.referenceCrop?.name} (${agro.referenceCrop?.stage})`);
  }));
}
if (!options.length || options.includes('--replay')) {
  tasks.push(prepareReplay(csvDirectory).then(async (replay) => {
    await writeDataset('parma-replay.json', replay);
    console.log(`Parma replay ${Object.keys(replay.days).length} days, default date ${replay.defaultDate}`);
  }));
}
await Promise.all(tasks);

// 作物决策快照由天气与农业气象两份快照派生，本次两者都刷新时才重写。
if (weatherSnapshot && agroSnapshot) {
  const crops = deriveCrops(weatherSnapshot, agroSnapshot);
  await writeDataset('crops-snapshot.json', { ...crops, status: 'cached' });
  console.log(`Crop decisions snapshot ${crops.fetchedAt}, ${crops.stages.length} crops, ${crops.sprayWindows.length} spray windows, lamp ${crops.lamp?.total7} in 7 days`);
}
