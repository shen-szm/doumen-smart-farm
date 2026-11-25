// 重建随构建发布的快照（public/data/*-snapshot.json）：卫星苗情、卫星表层墒情、区域水环境。
// 线上服务器由后台定时刷新（server/api.mjs），不需要跑这个脚本。它用于静态部署、首次发布前的初始数据，
// 或想在本机核对数据时。三个模块都与既有快照合并，只补新增的部分。
// 用法：node scripts/refresh-cached.mjs [ndvi] [satellite-soil] [water-quality]    （不带参数 = 全部）
import { readFile, writeFile } from 'node:fs/promises';
import { refreshNdvi } from '../server/ndvi.mjs';
import { refreshSatelliteSoil } from '../server/satelliteSoil.mjs';
import { refreshWaterQuality } from '../server/waterQuality.mjs';

const OUT = new URL('../public/data/', import.meta.url);
const JOBS = {
  'ndvi': { file: 'ndvi-snapshot.json', refresh: refreshNdvi, summary: (value) => `${value.scenes.length} 景，最新 ${value.scenes.at(-1).date}` },
  'satellite-soil': { file: 'satellite-soil-snapshot.json', refresh: refreshSatelliteSoil, summary: (value) => `${value.points.length} 天，最新 ${value.points.at(-1).time.slice(0, 10)}` },
  'water-quality': { file: 'water-quality-snapshot.json', refresh: refreshWaterQuality, summary: (value) => `${value.reports.length} 份报告，最新 ${value.reports[0].month}` },
};

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(JOBS)) {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown dataset: ${name}. Available: ${Object.keys(JOBS).join(', ')}`);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(new URL(job.file, OUT), 'utf8'));
  } catch { /* 没有既有快照，从零开始 */ }
  const { status, ...snapshot } = await job.refresh({ previous, log: console.log });
  await writeFile(new URL(job.file, OUT), `${JSON.stringify({ ...snapshot, status: 'cached' })}\n`, 'utf8');
  console.log(`已写入 public/data/${job.file}：${job.summary(snapshot)}`);
}
