/**
 * `tsx packages/setgen/tools/rekey-fixtures.ts --from <old> --to <new>` — moves
 * every recorded fixture whose prompt holds one sentence onto the key the
 * corrected sentence hashes to.
 *
 * # What a re-key is, and what it costs
 *
 * A fixture is keyed by `hash(system, prompt, schema)` (`@mtg/llm`'s
 * `fixtureKey`), and several strings the generator prints into a fill prompt are
 * prose about the generator rather than instructions to the model: a role's
 * `substitution` note is the standing example. Correcting one by a character
 * moves the key of every recording whose batch held it, and the replay looks a
 * fixture up by file name, so the correction orphans the recordings and only a
 * paid live run brings them back.
 *
 * A re-key is the other option, and it is the one this tree has taken three
 * times (`mtg-bc2.52`, `mtg-bc2.56`, `mtg-lr0z`): recompute the prompt, rename
 * the file to the key it now hashes to, and leave the recorded response exactly
 * as the model wrote it. **That preserves a response produced under the old
 * prompt.** The recording now answers a question one sentence different from the
 * one being asked, and that is the tradeoff rather than a defect to fix here:
 * the alternative is regenerating a committed set that eight other packages test
 * against. `packages/setgen/test/recorded-set.test.ts`'s header is where each
 * such move is written down, and it is written down per move rather than in
 * general, because the size of the lie is different every time.
 *
 * # What it refuses
 *
 * Nothing is written until every invariant holds, and the invariants are the
 * ones a rename can violate silently:
 *
 * - the two sentences differ, and the old one is actually on disk;
 * - every affected file stores the key it is named by, before the move;
 * - the new keys are distinct from each other, so no two recordings collapse
 *   onto one file;
 * - no new key lands on a fixture that is not itself moving, so no unrelated
 *   recording is overwritten.
 *
 * A run manifest names its fixtures by key (`fixtures/runs/*.json`), so the
 * moved keys are replaced there in place. That is the one legitimate rewrite of
 * a manifest `writeRunManifest` exists to forbid: the run, its calls and its
 * responses are unchanged, and only the names under it moved. Leaving it alone
 * would make `readManifestFixtures` throw on keys that are no longer there.
 *
 * It prints one line per file that moved and nothing at all when the corpus does
 * not hold the old sentence, so a second run after a successful one is silent.
 *
 *   tsx packages/setgen/tools/rekey-fixtures.ts \
 *     --from 'the old sentence, quoted exactly' \
 *     --to 'the corrected sentence'
 */
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyForRequest, readFixture, readRunManifest } from '@mtg/llm';
import type { RecordedFixture, RunManifest } from '@mtg/llm';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'fixtures');
const RUNS_DIR = join(FIXTURES_ROOT, 'runs');

interface Sentences {
  readonly from: string;
  readonly to: string;
}

/** One recording that holds the old sentence, and where it is going. */
interface Move {
  readonly dir: string;
  readonly oldKey: string;
  readonly newKey: string;
  readonly occurrences: number;
  readonly fixture: RecordedFixture;
}

function parseArgs(argv: readonly string[]): Sentences {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined) continue;
    values.set(arg.slice(2), next);
    index += 1;
  }
  const from = values.get('from');
  const to = values.get('to');
  if (from === undefined || to === undefined || from === '' || to === '') {
    throw new Error("usage: rekey-fixtures.ts --from '<old sentence>' --to '<corrected sentence>'");
  }
  if (from === to) {
    throw new Error('--from and --to are the same sentence, so no key would move');
  }
  return { from, to };
}

/** Every directory of recorded request/response pairs, whichever run wrote it. */
function fixtureDirs(): readonly string[] {
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('llm'))
    .map((entry) => join(FIXTURES_ROOT, entry.name))
    .sort();
}

function fixturesIn(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function moved(fixture: RecordedFixture, key: string, sentences: Sentences): RecordedFixture {
  return {
    ...fixture,
    key,
    request: { ...fixture.request, prompt: fixture.request.prompt.split(sentences.from).join(sentences.to) },
  };
}

/**
 * The moves the corpus asks for, with the pre-move integrity check that has to
 * pass first: a fixture that does not already answer to its own name is a
 * fixture some earlier hand-edit left behind, and moving it would bury that.
 */
function planMoves(sentences: Sentences): readonly Move[] {
  const moves: Move[] = [];
  for (const dir of fixtureDirs()) {
    for (const oldKey of fixturesIn(dir)) {
      const fixture = readFixture(join(dir, `${oldKey}.json`));
      const occurrences = fixture.request.prompt.split(sentences.from).length - 1;
      if (occurrences === 0) continue;
      const storedKey = keyForRequest({
        system: fixture.request.system,
        prompt: fixture.request.prompt,
        jsonSchema: fixture.request.schema,
      });
      if (storedKey !== oldKey || fixture.key !== oldKey) {
        throw new Error(
          `${join(dir, `${oldKey}.json`)} stores a request that hashes to ${storedKey} and calls itself ` +
            `${fixture.key}; re-keying a fixture that is already misfiled would hide that, so fix it first`,
        );
      }
      const next = moved(fixture, '', sentences);
      const newKey = keyForRequest({
        system: next.request.system,
        prompt: next.request.prompt,
        jsonSchema: next.request.schema,
      });
      moves.push({ dir, oldKey, newKey, occurrences, fixture });
    }
  }
  return moves;
}

/** Refuses every collision a rename can cause, before anything is written. */
function refuseCollisions(moves: readonly Move[]): void {
  const byNewKey = new Map<string, Move[]>();
  for (const move of moves) {
    byNewKey.set(move.newKey, [...(byNewKey.get(move.newKey) ?? []), move]);
  }
  for (const [newKey, sharing] of byNewKey) {
    if (sharing.length > 1) {
      throw new Error(
        `${sharing.length} recordings hash to ${newKey} after the correction ` +
          `(${sharing.map((move) => move.oldKey).join(', ')}); one would overwrite the others`,
      );
    }
  }
  for (const dir of fixtureDirs()) {
    const leaving = new Set(moves.filter((move) => move.dir === dir).map((move) => move.oldKey));
    const staying = new Set(fixturesIn(dir).filter((key) => !leaving.has(key)));
    for (const move of moves.filter((entry) => entry.dir === dir)) {
      if (staying.has(move.newKey)) {
        throw new Error(
          `${move.oldKey} would move onto ${move.newKey} in ${dir}, which is a recording that is not moving`,
        );
      }
    }
  }
}

/**
 * The manifests whose key lists name a moved fixture, rewritten in place.
 *
 * In manifest order rather than sorted: `readManifestFixtures` reads the list in
 * the order the run first asked for each key, and that order is the record of
 * how the run went.
 */
function rewriteManifests(moves: readonly Move[]): readonly string[] {
  const rename = new Map(moves.map((move) => [move.oldKey, move.newKey]));
  const touched: string[] = [];
  for (const name of readdirSync(RUNS_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const path = join(RUNS_DIR, name);
    const manifest = readRunManifest(path);
    if (!manifest.keys.some((key) => rename.has(key))) continue;
    const keys = manifest.keys.map((key) => rename.get(key) ?? key);
    const next: RunManifest = { ...manifest, keys: keys as RunManifest['keys'] };
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    touched.push(path);
  }
  return touched;
}

export function main(argv: readonly string[]): number {
  const sentences = parseArgs(argv);
  const moves = planMoves(sentences);
  if (moves.length === 0) return 0;
  refuseCollisions(moves);

  // Written before anything is deleted, so an interrupted run leaves both names
  // on disk rather than neither. A new key may be an old key of another move
  // (the fixtures were all read in `planMoves`), which is why the delete pass
  // skips a path some move has just claimed.
  const claimed = new Set(moves.map((move) => join(move.dir, `${move.newKey}.json`)));
  for (const move of moves) {
    const next = moved(move.fixture, move.newKey, sentences);
    writeFileSync(join(move.dir, `${move.newKey}.json`), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  for (const move of moves) {
    const old = join(move.dir, `${move.oldKey}.json`);
    if (!claimed.has(old)) rmSync(old);
  }

  for (const move of moves) {
    const times = move.occurrences === 1 ? '' : ` (${String(move.occurrences)}x)`;
    console.log(`${move.dir.replace(`${PACKAGE_ROOT}/`, '')}: ${move.oldKey} -> ${move.newKey}${times}`);
  }
  for (const path of rewriteManifests(moves)) {
    console.log(`${path.replace(`${PACKAGE_ROOT}/`, '')}: key list updated`);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
