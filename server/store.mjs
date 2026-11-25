// 服务器端的数据缓存目录：保存后台定时刷新的结果，以及各接口最近一次成功取到的数据。
// 目录在项目根下（与 public/ 同级），发布新版本时不会被覆盖。
// 写入先写临时文件再改名，任何时刻读到的都是完整内容。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = fileURLToPath(new URL('../data-cache/', import.meta.url));

export function createStore(dir = CACHE_DIR) {
  const file = (name) => path.join(dir, name);
  return {
    dir,
    async read(name) {
      try {
        return JSON.parse(await readFile(file(name), 'utf8'));
      } catch {
        return null;
      }
    },
    async write(name, value) {
      const target = file(name);
      const temp = `${target}.${process.pid}.tmp`;
      await mkdir(dir, { recursive: true });
      await writeFile(temp, JSON.stringify(value));
      await rename(temp, target);
    },
  };
}

// 测试用：接口行为与落盘缓存相同，只存在内存里。
export function createMemoryStore() {
  const files = new Map();
  return {
    dir: null,
    async read(name) {
      return files.has(name) ? structuredClone(files.get(name)) : null;
    },
    async write(name, value) {
      files.set(name, structuredClone(value));
    },
  };
}
