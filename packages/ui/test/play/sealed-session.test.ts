// @vitest-environment jsdom
/**
 * The sealed pool you were in the middle of, kept across a reload.
 *
 * `mtg-tewc.5`. What is stored is a seed and two edits, and every claim in this
 * file is about the gap that opens between the seed and the pool it names: the
 * set on the page can change, its collation can change, and the stored indices
 * name positions in a list that would then be a different list. So the tests
 * are mostly refusals — a resume that reopens against the wrong cards is
 * discovered by losing a game with it, which is the argument
 * `../../src/routes/deck/saved-decks.ts` already makes for a saved deck.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PackCollation } from '@mtg/deckbuild';
import { openSealed, toggle } from '../../src/routes/play/sealed';
import {
  clearSealedSession,
  readSealedSession,
  resumeSealed,
  SEALED_SESSION_KEY,
  SEALED_SESSION_VERSION,
  sessionSummary,
  writeSealedSession,
} from '../../src/routes/play/sealed-session';
import { readStored, writeStored } from '../../src/routes/deck/local-store';

afterEach(() => {
  clearSealedSession();
});

/**
 * `path.join` rather than `new URL(literal, import.meta.url)`: Vite rewrites
 * that pattern into an asset URL, which under jsdom resolves against the
 * document's `http://localhost` base instead of the file system.
 */
function fixture(name: string): readonly Card[] {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'setgen',
    'fixtures',
    'sets',
    name,
  );
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = fixture('tideglass-reach.set.json');
const SEED = 'session-test/v0';

/** The same set one card short: a set that moved under a stored pool. */
const TRIMMED = SET.slice(0, SET.length - 1);

/**
 * Sheets that can fill a pack out of this fixture, so a collated pool exists to
 * compare against an uncollated one. Written out rather than read off a staged
 * document: what is under test is the flag the session carries, and a set with
 * its own collation would put the fixture's shape between the claim and the
 * code.
 */
const SHEETS: PackCollation = {
  sheets: [
    {
      name: 'any',
      weights: Object.fromEntries(SET.map((card) => [card.id, 1])),
    },
  ],
  boosters: [{ contents: { any: 11 }, weight: 1 }],
};

describe('a sealed session survives the page it was dealt on', () => {
  it('puts back the pool, the cuts and the mana base', () => {
    const opened = openSealed(SET, SEED);
    const edited = toggle(toggle(opened, 0), 1);
    const withBasics = { ...edited, basics: { U: 9, B: 8 } };
    expect(writeSealedSession(withBasics, SEED, false)).toBe(true);

    const session = readSealedSession();
    expect(session).not.toBeNull();
    if (session === null) throw new Error('the session was just written');

    const resumed = resumeSealed(session, SET, null);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(`refused: ${resumed.problem.kind}`);
    expect(resumed.seed).toBe(SEED);
    expect(resumed.build.pool.map((card) => card.id)).toEqual(withBasics.pool.map((card) => card.id));
    expect(resumed.build.chosen).toEqual([...withBasics.chosen].sort((a, b) => a - b));
    expect(resumed.build.basics).toEqual({ U: 9, B: 8 });
  });

  /**
   * The reason this stores a seed rather than a pool, stated as a measurement.
   *
   * Six boosters of card objects is the derivation of forty characters, in a
   * store that throws at its quota rather than declining. The ratio here is the
   * whole argument, and a change that started storing the cards would move it.
   */
  it('stores the seed, not the pool', () => {
    const opened = openSealed(SET, SEED);
    writeSealedSession(opened, SEED, false);
    const stored = readStored(SEALED_SESSION_KEY) ?? '';
    expect(stored.length).toBeLessThan(JSON.stringify(opened.pool).length / 10);
    // The ids are in it, because they are the guard. The rules text is not.
    expect(stored).toContain(opened.pool[0]?.id ?? 'no pool');
    expect(stored).not.toContain('"rules"');
  });

  it('says how much of the pool was cut, without re-dealing it', () => {
    const opened = openSealed(SET, SEED);
    writeSealedSession(toggle(opened, 0), SEED, false);
    const session = readSealedSession();
    if (session === null) throw new Error('the session was just written');
    const summary = sessionSummary(session);
    expect(summary.seed).toBe(SEED);
    expect(summary.poolSize).toBe(opened.pool.length);
    expect(summary.chosenCount).toBe(toggle(opened, 0).chosen.length);
  });

  it('is forgotten when it is cleared', () => {
    writeSealedSession(openSealed(SET, SEED), SEED, false);
    expect(readSealedSession()).not.toBeNull();
    clearSealedSession();
    expect(readSealedSession()).toBeNull();
  });
});

describe('a sealed session it cannot honor is refused, not repaired', () => {
  function stored(): NonNullable<ReturnType<typeof readSealedSession>> {
    const session = readSealedSession();
    if (session === null) throw new Error('the session was just written');
    return session;
  }

  it('refuses a pool the set on this page would not deal', () => {
    writeSealedSession(openSealed(SET, SEED), SEED, false);
    const resumed = resumeSealed(stored(), TRIMMED, null);
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error('a shorter set dealt the same pool');
    expect(resumed.problem.kind).toBe('set-changed');
  });

  /**
   * The same seed and the same cards, dealt by the printing's sheets instead of
   * the rarity recipe, is a different pool at the same positions. Refused on
   * the flag rather than on the ids, and that ordering is the point: the sheets
   * a set carries can change without any card changing, so a comparison of what
   * was dealt would sometimes agree by luck.
   */
  it('refuses a pool dealt the other way round, in both directions', () => {
    writeSealedSession(openSealed(SET, SEED), SEED, false);
    const bySheets = resumeSealed(stored(), SET, SHEETS);
    expect(bySheets.ok).toBe(false);
    if (bySheets.ok) throw new Error('the sheets reopened a recipe pool');
    expect(bySheets.problem.kind).toBe('collation');

    writeSealedSession(openSealed(SET, SEED, { collation: SHEETS }), SEED, true);
    const byRecipe = resumeSealed(stored(), SET, null);
    expect(byRecipe.ok).toBe(false);
    if (byRecipe.ok) throw new Error('the recipe reopened a collated pool');
    expect(byRecipe.problem.kind).toBe('collation');
  });

  it('drops a session written at another version', () => {
    writeSealedSession(openSealed(SET, SEED), SEED, false);
    const raw = JSON.parse(readStored(SEALED_SESSION_KEY) ?? '{}') as Record<string, unknown>;
    writeStored(SEALED_SESSION_KEY, JSON.stringify({ ...raw, version: SEALED_SESSION_VERSION + 1 }));
    expect(readSealedSession()).toBeNull();
  });

  it('drops a value that is not a session at all', () => {
    writeStored(SEALED_SESSION_KEY, 'not json');
    expect(readSealedSession()).toBeNull();
    writeStored(SEALED_SESSION_KEY, JSON.stringify({ version: SEALED_SESSION_VERSION }));
    expect(readSealedSession()).toBeNull();
  });

  /**
   * A cut that names a card past the end of the pool is dropped rather than
   * carried into a build that would index past its own list. It cannot happen
   * while the id guard holds, which is why it is checked here: the guard is one
   * comparison, and this is what stands behind it if it is ever loosened.
   */
  it('drops a cut that names a position the pool does not have', () => {
    const opened = openSealed(SET, SEED);
    writeSealedSession(opened, SEED, false);
    const raw = JSON.parse(readStored(SEALED_SESSION_KEY) ?? '{}') as Record<string, unknown>;
    writeStored(SEALED_SESSION_KEY, JSON.stringify({ ...raw, chosen: [0, opened.pool.length + 4] }));
    const resumed = resumeSealed(stored(), SET, null);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(`refused: ${resumed.problem.kind}`);
    expect(resumed.build.chosen).toEqual([0]);
  });
});
