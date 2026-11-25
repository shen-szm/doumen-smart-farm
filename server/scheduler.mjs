// 后台定时任务：到点执行，任务之间互不影响。
// 单个任务出错只写一条日志，不影响站点，也不会让进程退出；定时器不阻止进程退出。
export function createScheduler({ log = console.error } = {}) {
  const timers = new Set();
  let stopped = false;

  function schedule(job, delay) {
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (stopped) return;
      try {
        await job.run();
      } catch (error) {
        log(`[后台刷新] ${job.name}失败：${error?.message ?? error}`);
      }
      if (!stopped) schedule(job, job.interval);
    }, delay);
    timer.unref?.();
    timers.add(timer);
  }

  return {
    add(job) {
      schedule(job, job.delay ?? 0);
      return job;
    },
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
