/**
 * Where recorded games may be written, and the refusals that keep them there.
 *
 * `./out-path.ts` guards `out/`, the directory a rig's frames go to and the
 * repository ignores whole. Recorded games are not a rig's output: they are
 * evidence somebody keeps, so they live under `data/`, beside the card store
 * and the image cache, in a family directory of their own that `.gitignore`
 * names twice for the same reason it names `data/store` twice. This is the
 * sibling guard. A recorder resolves its root through it before it binds a
 * port, and a root that is not `<repo>/data/<one family>` or a temporary
 * directory is refused by name: bare `data/` would put records beside the
 * database, the repository root is the incident `./out-path.ts` was written
 * for, and a second path segment is a typo that would scatter days across
 * directories nothing indexes.
 *
 * The record layout is `<root>/<yyyymmdd>/<id>.json` with one `index.jsonl`
 * at the root. `gameplayRecordPath` is the one place that spelling lives, and
 * it refuses an id that could leave the day directory, because the id on the
 * wire is the server's own and a path separator in it is a bug, not a request.
 */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Refusal with the path in it, so the message names what to fix. */
export class DataPathError extends Error {}

/** The family directory recorded games live in, under `data/`. */
export const GAMEPLAY_FAMILY = 'gameplay';

/** The one index at the family root, one JSON row per recorded game. */
export const GAMEPLAY_INDEX_FILENAME = 'index.jsonl';

/** `<repo>/data/gameplay`, the root every launcher records under. */
export function gameplayDir(repoRoot: string): string {
  return join(repoRoot, 'data', GAMEPLAY_FAMILY);
}

/** True when `child` is `parent` itself or anything under it. */
function within(parent: string, child: string): boolean {
  const step = relative(parent, child);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
}

/** Both spellings of a root: `/tmp` is a symlink to `/private/tmp` on some machines. */
function spellings(root: string): readonly string[] {
  try {
    return [root, realpathSync(root)];
  } catch {
    return [root];
  }
}

/**
 * The absolute directory a recorder may write into, or a refusal.
 *
 * Exactly `<repo>/data/<one segment>` is allowed, so a family root is a family
 * root and not `data/` itself or a directory two levels down. A temporary
 * directory is allowed as well, because the tests write records and have
 * nowhere else to put them. `repoRoot` is passed rather than derived so a test
 * can state one.
 */
export function resolveDataDir(requested: string, repoRoot: string): string {
  const dir = resolve(requested);
  for (const root of spellings(tmpdir())) if (within(root, dir)) return dir;
  const data = join(repoRoot, 'data');
  if (dirname(dir) === data && basename(dir) !== '' && basename(dir) !== '.' && basename(dir) !== '..') {
    return dir;
  }
  throw new DataPathError(
    `refusing to record games under ${dir}: a recorder writes under ${data}/<family> or a temporary directory. ` +
      `A path that is neither is usually a value passed where a path was meant.`,
  );
}

/** The UTC day directory a record made at `at` belongs in, as `yyyymmdd`. */
export function dayDirectory(at: Date): string {
  return at.toISOString().slice(0, 10).replaceAll('-', '');
}

/** `<dir>/<yyyymmdd>/<id>.json`, refusing an id that could name another directory. */
export function gameplayRecordPath(dir: string, at: Date, id: string): string {
  if (id === '' || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new DataPathError(`refusing to record a game under the id ${JSON.stringify(id)}: not a file name`);
  }
  return join(dir, dayDirectory(at), `${id}.json`);
}
