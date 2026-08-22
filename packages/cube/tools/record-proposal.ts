/**
 * Keeps the one live model call this package's fixture replays, and the list of
 * store cards that call named which the stand-in pool does not hold.
 *
 * ```
 * npx tsx packages/cube/tools/record-proposal.ts
 * ```
 *
 * It replays when a fixture for the request already exists and records only
 * when one does not. The fixture key is a hash of the request, so a present
 * fixture means the request is unchanged and a live call would buy the answer
 * that is already on disk; a missing one means `test/support/recorded-pool.ts`
 * or the prompt moved, which is exactly when a recording is owed. Recording
 * goes through `resolveProvider`, so the live backend is whatever the
 * environment offers — on this machine the authenticated `claude` binary.
 *
 * The excluded list is derived here rather than written by hand. It was a
 * literal in `recorded-pool.ts` holding the one name the recorded model
 * happened to say, which made the not-in-universe assertion in
 * `recorded-proposal.test.ts` partly constructed after seeing the answer
 * (mtg-bc2.125). What it must be is a fact about the store: every name the
 * answer used that the stand-in pool lacks and `data/store/mtg.sqlite` has.
 * Deriving it needs no recording, because the list feeds `knownNames` and the
 * prompt is built from the pool.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { closeStore, openStore, DEFAULT_DB_PATH } from '@mtg/data';
import { loadKnownNames, normalizeName } from '@mtg/decklab';
import { FixtureMissingError, resolveProvider } from '@mtg/llm';
import type { CubeProposal } from '../src/propose';
import { proposeCubeCards } from '../src/propose';
import {
  EXCLUDED_PATH,
  FIXTURE_DIR,
  RECORDED_CRITERIA,
  RECORDED_NEED,
  RECORDED_POOL,
} from '../test/support/recorded-pool';

function ask(record: boolean): Promise<CubeProposal> {
  const provider = resolveProvider({ provider: 'fixture', fixture: { dir: FIXTURE_DIR, record } });
  return proposeCubeCards(provider, RECORDED_CRITERIA, RECORDED_POOL, RECORDED_NEED, [], []);
}

async function proposal(): Promise<CubeProposal> {
  try {
    return await ask(false);
  } catch (error: unknown) {
    if (!(error instanceof FixtureMissingError)) throw error;
    process.stdout.write(`${error.message}\nrecording it live\n`);
    return await ask(true);
  }
}

/** The key of the fixture the excluded list was derived alongside. */
function fixtureKeyOnDisk(): string {
  const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
  const [only] = files;
  if (files.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one fixture in ${FIXTURE_DIR}, found ${String(files.length)}`);
  }
  return only.replace(/\.json$/, '');
}

/** Names the answer used that the pool lacks, split on whether the store has them. */
function splitOutsidePool(names: readonly string[]): {
  readonly excluded: readonly string[];
  readonly invented: readonly string[];
} {
  const outside = [...new Set(names)].filter(
    (name) => !RECORDED_POOL.universe.byName.has(normalizeName(name)),
  );
  const store = openStore(DEFAULT_DB_PATH, { readonly: true });
  try {
    const known = loadKnownNames(store);
    return {
      excluded: outside.filter((name) => known.has(normalizeName(name))),
      invented: outside.filter((name) => !known.has(normalizeName(name))),
    };
  } finally {
    closeStore(store);
  }
}

async function main(): Promise<void> {
  const answer = await proposal();
  const split = splitOutsidePool(answer.cards.map((card) => card.name));
  const file = { fixtureKey: fixtureKeyOnDisk(), names: split.excluded };
  writeFileSync(EXCLUDED_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

  process.stdout.write(`${String(answer.cards.length)} proposals against ${FIXTURE_DIR}\n`);
  for (const card of answer.cards) {
    const known = RECORDED_POOL.universe.cards.some((entry) => entry.name === card.name);
    process.stdout.write(
      `  ${known ? 'in pool ' : 'outside '} ${card.name} [${card.archetypes.join(', ')}]\n`,
    );
  }
  process.stdout.write(`wrote ${String(split.excluded.length)} excluded name(s) to ${EXCLUDED_PATH}\n`);
  for (const name of split.invented) {
    process.stdout.write(`  not in the store either, so left out of the excluded list: ${name}\n`);
  }
}

await main();
