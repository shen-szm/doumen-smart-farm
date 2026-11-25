#!/usr/bin/env node
// 把「现场监控」文件夹里的原始录像转成网页播放版本，供大屏右栏的「现场监控」面板循环、静音播放。
// 每个录像生成三样东西：去掉音轨的压缩视频、一帧封面、以及清单 clips.json 里的一条记录。
//
// 用法：node scripts/prepare-monitor.mjs        转换 现场监控/ 下还没转换过（或比已有产物新）的录像
//       node scripts/prepare-monitor.mjs --all  全部重新转换
//
// 录像文件名里的日期用来命名和排序，支持「11月25日.mp4」「2026-11-25.mp4」「20261125.mp4」；认不出日期时取文件修改日期。
// 清单里每段录像的 note 是可选的说明（例如「无人机航拍」），显示在面板和大图弹层里，可手工补充。
// 原始录像体积大，不进版本库（.gitignore 已忽略 现场监控/）；网页版本在 public/media/monitor/。
//
// 依赖 ffmpeg：依次找环境变量 FFMPEG 指定的路径、PATH 里的 ffmpeg、Python 的 imageio-ffmpeg 自带的那份。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_DIR = path.join(ROOT, '现场监控');
const OUT_DIR = path.join(ROOT, 'public', 'media', 'monitor');
const MANIFEST = path.join(OUT_DIR, 'clips.json');
const WIDTH = 1280;
const VIDEO_FILE = /\.(mp4|mov|m4v)$/i;
const rebuild = process.argv.includes('--all');

function findFfmpeg() {
  const run = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' });
  const candidates = [process.env.FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    if (run(candidate).status === 0) return candidate;
  }
  const python = spawnSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  const bundled = python.status === 0 ? python.stdout.trim() : '';
  if (bundled && existsSync(bundled)) return bundled;
  throw new Error('找不到 ffmpeg：请安装后加入 PATH，或用环境变量 FFMPEG 指定它的路径。');
}

const pad = (value) => String(value).padStart(2, '0');
// 从文件名里认日期；年份缺省取文件修改年份。
function dateOf(name, modified) {
  const full = /(\d{4})[-_.]?(\d{1,2})[-_.]?(\d{1,2})/.exec(name);
  if (full) return `${full[1]}-${pad(full[2])}-${pad(full[3])}`;
  const chinese = /(\d{1,2})月(\d{1,2})日/.exec(name);
  if (chinese) return `${modified.getFullYear()}-${pad(chinese[1])}-${pad(chinese[2])}`;
  return `${modified.getFullYear()}-${pad(modified.getMonth() + 1)}-${pad(modified.getDate())}`;
}

function probe(ffmpeg, file) {
  const { stderr } = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const text = stderr ?? '';
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  const width = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(text);
  return {
    duration: duration ? Math.round(Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) : 0,
    width: width ? Number(width[1]) : 0,
  };
}

const ffmpeg = findFfmpeg();
if (!existsSync(SOURCE_DIR)) {
  console.log(`没有找到录像文件夹：${SOURCE_DIR}`);
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });

const sources = readdirSync(SOURCE_DIR).filter((name) => VIDEO_FILE.test(name)).sort();
if (!sources.length) {
  console.log(`「现场监控」里没有录像（支持 ${VIDEO_FILE.source.replace(/\\/g, '')}）`);
  process.exit(0);
}

const manifest = new Map();
try {
  for (const entry of JSON.parse(readFileSync(MANIFEST, 'utf8'))) manifest.set(entry.date, entry);
} catch { /* 还没有清单 */ }

let converted = 0;
for (const name of sources) {
  const source = path.join(SOURCE_DIR, name);
  const date = dateOf(name, statSync(source).mtime);
  const target = path.join(OUT_DIR, `${date}.mp4`);
  const poster = path.join(OUT_DIR, `${date}.webp`);
  if (!rebuild && existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
    console.log(`跳过 ${name}：${date} 的网页版本已是最新`);
    continue;
  }
  const info = probe(ffmpeg, source);
  // 不放大低分辨率片源；目标高度按比例，并凑成偶数（H.264 要求）。
  const scale = `scale='min(${WIDTH},iw)':-2`;
  const encode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-an', '-vf', scale,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', target], { stdio: 'inherit' });
  if (encode.status !== 0) throw new Error(`转换失败：${name}`);
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.round(info.duration * 0.35)), '-i', source,
    '-frames:v', '1', '-vf', 'scale=960:-2', '-c:v', 'libwebp', '-quality', '78', poster], { stdio: 'inherit' });
  // 清单里已有的其他字段（例如手工补充的 note）在重新转换时保留。
  manifest.set(date, { ...manifest.get(date), date, file: `${date}.mp4`, poster: existsSync(poster) ? `${date}.webp` : null,
    duration: info.duration, source: `现场监控/${name}` });
  converted += 1;
  console.log(`已转换 ${name} → public/media/monitor/${date}.mp4（${info.duration} 秒，源宽 ${info.width}，${(statSync(target).size / 1024 / 1024).toFixed(1)} MB）`);
}

// 清单按日期从新到旧；产物已不存在的记录一并去掉。
const clips = [...manifest.values()]
  .filter(({ file }) => existsSync(path.join(OUT_DIR, file)))
  .sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(MANIFEST, `${JSON.stringify(clips, null, 2)}\n`);
console.log(`清单 public/media/monitor/clips.json：${clips.length} 段录像（本次新转换 ${converted} 段）`);
