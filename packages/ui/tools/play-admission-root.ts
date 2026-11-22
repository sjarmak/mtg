/** Durable scratch ownership for printed-format Forge snapshots. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMISSION_OWNER_FILENAME = 'owner.pid';

type ProcessAlive = (pid: number) => boolean;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function ownerPid(path: string): number | null {
  try {
    const text = readFileSync(join(path, ADMISSION_OWNER_FILENAME), 'utf8').trim();
    if (!/^\d+$/u.test(text)) return null;
    const pid = Number(text);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Remove only directories whose recorded owner is provably dead. */
function sweepStaleAdmissions(parent: string, alive: ProcessAlive): void {
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(parent, entry.name);
    const pid = ownerPid(path);
    if (pid !== null && !alive(pid)) rmSync(path, { recursive: true, force: true });
  }
}

/** Allocate one launcher-owned root outside the host's temporary-directory reaper. */
export function createPlayAdmissionRoot(
  repoRoot: string,
  pid = process.pid,
  alive: ProcessAlive = processAlive,
): string {
  const parent = join(repoRoot, 'out', 'play-admission');
  mkdirSync(parent, { recursive: true });
  sweepStaleAdmissions(parent, alive);
  const root = mkdtempSync(join(parent, `${String(pid)}-`));
  try {
    writeFileSync(join(root, ADMISSION_OWNER_FILENAME), `${String(pid)}\n`, 'utf8');
    return root;
  } catch (cause) {
    rmSync(root, { recursive: true, force: true });
    throw cause;
  }
}
