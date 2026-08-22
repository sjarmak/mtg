/**
 * Locating the Forge artifact.
 *
 * Forge is GPL-3.0. It is never vendored, never linked, and never imported —
 * it lives as a downloaded distribution under `tools/forge/dist/` (gitignored)
 * and is only ever driven as a subprocess. This module answers one question:
 * is that artifact present, and where.
 *
 * Every consumer must handle `null` as "Forge is not installed" and degrade to
 * a labeled skip. A missing engine is never a pass.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const JAR_PATTERN = /^forge-gui-desktop-(.+)-jar-with-dependencies\.jar$/;

export interface ForgeInstall {
  /** Forge program directory (the extracted distribution). */
  readonly home: string;
  /** Absolute path to the desktop jar that carries the `sim` entry point. */
  readonly jar: string;
  /** Version parsed from the jar name, e.g. `2.0.14`. */
  readonly version: string;
  /** Forge's user-data directory; `custom/` and `decks/` live under it. */
  readonly userDir: string;
  /** `<userDir>/custom` — cards, editions and tokens. */
  readonly customDir: string;
  /** `<userDir>/decks/constructed` — where `sim -d` resolves deck names. */
  readonly decksDir: string;
}

export interface ForgeInstallOptions {
  /** Overrides `FORGE_HOME` and the default `tools/forge/dist` location. */
  readonly forgeHome?: string;
  /** Overrides the user-data directory; defaults to `<forgeHome>/userdata`. */
  readonly userDir?: string;
}

/** Repository root, derived from this file's location inside the workspace. */
function repoRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
}

/** Default Forge program directory: the gitignored artifact drop. */
export function defaultForgeHome(): string {
  const fromEnv = process.env['FORGE_HOME'];
  if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
  return join(repoRoot(), 'tools', 'forge', 'dist');
}

function findJar(home: string): { readonly jar: string; readonly version: string } | null {
  if (!existsSync(home)) return null;
  for (const entry of readdirSync(home).sort()) {
    const match = JAR_PATTERN.exec(entry);
    if (match !== null && match[1] !== undefined) {
      return { jar: join(home, entry), version: match[1] };
    }
  }
  return null;
}

/**
 * Resolves the installation, or `null` when Forge is not present.
 *
 * The user directory defaults inside the distribution rather than to Forge's
 * platform default (`~/.forge`) so a lab run never writes into a developer's
 * personal Forge profile.
 */
export function findForgeInstall(options: ForgeInstallOptions = {}): ForgeInstall | null {
  const home = options.forgeHome !== undefined ? resolve(options.forgeHome) : defaultForgeHome();
  const found = findJar(home);
  if (found === null) return null;
  const userDir =
    options.userDir !== undefined
      ? resolve(options.userDir)
      : resolve(process.env['FORGE_USER_DIR'] ?? join(home, 'userdata'));
  return {
    home,
    jar: found.jar,
    version: found.version,
    userDir,
    customDir: join(userDir, 'custom'),
    decksDir: join(userDir, 'decks', 'constructed'),
  };
}

/** Explains where the transpiler looked, for honest "skipped" reporting. */
export function forgeMissingReason(options: ForgeInstallOptions = {}): string {
  const home = options.forgeHome !== undefined ? resolve(options.forgeHome) : defaultForgeHome();
  return `no forge-gui-desktop-*-jar-with-dependencies.jar under ${home}; set FORGE_HOME or install the distribution into tools/forge/dist`;
}

/**
 * Points Forge's data directories at the lab's sandbox.
 *
 * `forge.profile.properties` in the program directory is the only mechanism
 * Forge offers for relocating user data, so the gate writes it — and rewrites
 * it only when the contents would change, keeping repeat runs idempotent.
 */
export function ensureForgeProfile(install: ForgeInstall): string {
  const path = join(install.home, 'forge.profile.properties');
  const contents = [
    '# Written by @mtg/forge-export: keeps lab runs out of the developer profile.',
    `userDir=${install.userDir}`,
    `cacheDir=${join(install.userDir, 'cache')}`,
    '',
  ].join('\n');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current !== contents) writeFileSync(path, contents, 'utf8');
  for (const dir of [install.userDir, install.customDir, install.decksDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return path;
}
