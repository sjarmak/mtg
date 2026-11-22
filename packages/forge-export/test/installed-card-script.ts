import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findForgeInstall } from '../src/install';

const CARD_SCRIPT_FILE = /^[a-z0-9_]+\.txt$/u;

export function readInstalledForgeCardScript(fileName: string): string | null {
  if (!CARD_SCRIPT_FILE.test(fileName)) throw new Error(`Invalid Forge card script file name: ${fileName}`);
  const install = findForgeInstall();
  if (install === null) return null;
  const archive = join(install.home, 'res', 'cardsfolder', 'cardsfolder.zip');
  if (!existsSync(archive)) throw new Error(`Forge printed-card archive does not exist: ${archive}`);
  const script = execFileSync('unzip', ['-p', archive, `${fileName[0]!}/${fileName}`], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (script.length === 0)
    throw new Error(`Forge card script is absent from the installed archive: ${fileName}`);
  return script;
}
