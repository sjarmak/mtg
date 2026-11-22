/**
 * Building the lab, with the rules-text symbols it will be served beside.
 *
 * `vite build` alone is not enough, and the way it is not enough is silent.
 * `../vite.config.ts` compiles `__MTG_SYMBOL_SET__` from `MTG_SYMBOL_SET`, and
 * until `mtg-f1bl` only `play.ts` and `lab.ts` ever set it: a build left it
 * empty, `src/card/symbols.ts` read that as `original`, and the artifact drew
 * the lab's own pips beside a `dist/symbols/` holding all 39 real files. A
 * launcher prints the set it staged; a build printed nothing, so the page
 * looked finished and read wrong, and both frozen lab builds shipped that way.
 *
 * So a build is a launcher too. It stages the symbols exactly as `play.ts`
 * does — the shared cache under `data/images/` means a second build costs no
 * requests — says which set it got, and hands that set to Vite. Vite copies
 * `public/` into `dist/`, so the directory this run stages is the directory the
 * built page serves, and the compiled answer is true of the artifact rather
 * than of whoever's shell started it.
 *
 * Everything after the script name is forwarded, so `--outDir` and the rest of
 * Vite's flags still work.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import { SET_ICON_DIR } from '../src/card/set-icon';
import { SYMBOL_DIR } from '../src/card/symbols';
import { buildEnv, viteBuildArgs } from './build-args';
import { installedPrintedAdmissions } from './printed-format-registry';
import { libraryCandidates } from './set-candidates';
import {
  describeSetIcons,
  libraryIconRoster,
  printedCatalogIconRoster,
  setIconRoster,
  setIconsEnv,
  stageSetIcons,
} from './stage-set-icons';
import { describeSymbols, stageSymbols } from './stage-symbols';

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(UI_ROOT, '..', '..');

async function main(): Promise<void> {
  const symbols = await stageSymbols({
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(UI_ROOT, 'public', SYMBOL_DIR),
  });
  const { formats: printedFormats } = installedPrintedAdmissions(REPO_ROOT);
  const publicDir = join(UI_ROOT, 'public');
  const setIcons = await stageSetIcons({
    codes: setIconRoster(
      libraryIconRoster(libraryCandidates(REPO_ROOT)),
      printedCatalogIconRoster(printedFormats, publicDir),
    ),
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(UI_ROOT, 'public', SET_ICON_DIR),
  });
  process.stdout.write(`${describeSymbols(symbols)}\n${describeSetIcons(setIcons)}\n\n`);
  const vite = spawn('npx', [...viteBuildArgs(process.argv.slice(2))], {
    cwd: UI_ROOT,
    stdio: 'inherit',
    env: buildEnv(symbols.set, setIconsEnv(setIcons), process.env),
  });
  vite.on('error', (cause: Error) => {
    process.stderr.write(
      `could not start Vite (${cause.message}). Install dependencies at the repo root first.\n`,
    );
    process.exit(1);
  });
  vite.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

await main();
