const live = new Set<number>();
let installed = false;

function killGroupQuietly(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
  }
}

function killAll(): void {
  for (const pgid of live) killGroupQuietly(pgid);
  live.clear();
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('exit', killAll);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const onSignal = (): void => {
      killAll();
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

export function trackProcessGroup(pgid: number | undefined): void {
  if (pgid === undefined) return;
  install();
  live.add(pgid);
}

export function killProcessGroup(pgid: number | undefined): void {
  if (pgid === undefined) return;
  live.delete(pgid);
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
  }
}
