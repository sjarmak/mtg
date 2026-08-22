/**
 * Two hand-built cubes and the criteria they are judged against.
 *
 * Written as data rather than pulled from `data/store/mtg.sqlite`: the store is
 * 626 MB, gitignored and absent in CI, and none of what `validate.ts` decides
 * needs a real card. The cards here are shaped like store rows and nothing more.
 *
 * The two lists exist as a pair. `balancedCube` satisfies every stated
 * criterion, so a validator that fails everything cannot pass it; `lopsidedCube`
 * violates every one of them at once, so a validator that passes everything
 * cannot pass it either. Between them a change that guts a check is visible.
 */
import type { CandidateCard } from '@mtg/decklab';
import { normalizeName, parseManaCost } from '@mtg/decklab';
import type { CubeCriteria, CubeCriteriaInput } from '../../src/criteria';
import { CubeCriteriaSchema } from '../../src/criteria';
import type { CubePool } from '../../src/universe';
import type { CubeEntry } from '../../src/validate';

export interface CardSpec {
  readonly name: string;
  readonly manaCost: string;
  readonly manaValue: number;
  readonly typeLine?: string;
  readonly colorIdentity: string;
  readonly priceUsd?: number;
}

/**
 * A store row's worth of card, with the fields the cube checks actually set.
 *
 * The oracle id is derived from the name rather than handed out by a counter,
 * because the copy limit is enforced on the id: a counter would give two
 * fixtures of the same card two identities and quietly make the duplicate
 * undetectable, which is the check the fixture exists to exercise.
 */
export function fixtureCard(spec: CardSpec): CandidateCard {
  return {
    oracleId: `fixture-${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: spec.name,
    manaCost: spec.manaCost,
    manaValue: spec.manaValue,
    typeLine: spec.typeLine ?? 'Creature — Fixture',
    oracleText: null,
    power: null,
    toughness: null,
    colorIdentity: spec.colorIdentity,
    keywords: [],
    priceUsd: spec.priceUsd ?? 1,
    parsedCost: parseManaCost(spec.manaCost),
    producedMana: [],
  };
}

export function fixtureEntry(card: CandidateCard, archetypes: readonly string[] = []): CubeEntry {
  return { card, count: 1, archetypes, reason: 'fixture' };
}

/**
 * A pool built from cards rather than from SQL.
 *
 * `outsideNames` are cards the store holds but the restrictions exclude, which
 * is the difference the gate has to draw between "you invented that card" and
 * "that one is illegal here".
 */
export function fixturePool(
  cards: readonly CandidateCard[],
  outsideNames: readonly string[] = [],
  filters: readonly string[] = ['legal in modern'],
): CubePool {
  return {
    universe: {
      cards,
      byName: new Map(cards.map((card) => [normalizeName(card.name), card])),
      filters,
    },
    knownNames: new Set([...cards.map((card) => card.name), ...outsideNames].map(normalizeName)),
  };
}

/**
 * A 50-card cube for a two-seat pod: small enough to read, large enough that
 * every check has something to measure.
 */
export const FIXTURE_CRITERIA_INPUT: CubeCriteriaInput = {
  prompt: 'a fifty-card test cube',
  format: 'modern',
  size: 50,
  seats: 2,
  cardsPerSeat: 25,
  curve: [
    { from: 0, to: 2, minCards: 20, maxCards: 30 },
    { from: 3, to: null, minCards: 20, maxCards: 30 },
  ],
  archetypes: [
    { name: 'azorius control', colors: ['W', 'U'], minPlayable: 10 },
    { name: 'rakdos aggro', colors: ['B', 'R'], minPlayable: 10 },
    { name: 'mono-green stompy', colors: ['G'], minPlayable: 10 },
  ],
};

export function fixtureCriteria(overrides: Partial<CubeCriteriaInput> = {}): CubeCriteria {
  return CubeCriteriaSchema.parse({ ...FIXTURE_CRITERIA_INPUT, ...overrides });
}

const PIP: Readonly<Record<string, string>> = { W: '{W}', U: '{U}', B: '{B}', R: '{R}', G: '{G}' };

/** `n` mono-colored cards, half of them cheap and half of them expensive. */
function run(color: string, count: number, archetypes: readonly string[]): readonly CubeEntry[] {
  return Array.from({ length: count }, (_unused, index) => {
    const cheap = index * 2 < count;
    const manaValue = cheap ? 2 : 4;
    const pip = PIP[color] ?? '{C}';
    return fixtureEntry(
      fixtureCard({
        name: `${color} fixture ${String(index + 1)}`,
        manaCost: `{${String(manaValue - 1)}}${pip}`,
        manaValue,
        colorIdentity: color,
      }),
      archetypes,
    );
  });
}

/**
 * Ten cards in each color, half at mana value 2 and half at 4, tagged so every
 * archetype clears its minimum. Every stated criterion holds exactly.
 */
export function balancedCube(): readonly CubeEntry[] {
  return [
    ...run('W', 10, ['azorius control']),
    ...run('U', 10, ['azorius control']),
    ...run('B', 10, ['rakdos aggro']),
    ...run('R', 10, ['rakdos aggro']),
    ...run('G', 10, ['mono-green stompy']),
  ];
}

/**
 * The same idea broken on every axis at once: two cards short of its size and
 * of its pod, half white against a fifth, nothing above mana value 1, three
 * cards for an archetype that wants ten, and one of those three white.
 */
export function lopsidedCube(): readonly CubeEntry[] {
  const flat = (color: string, count: number, archetypes: readonly string[]): readonly CubeEntry[] =>
    Array.from({ length: count }, (_unused, index) =>
      fixtureEntry(
        fixtureCard({
          name: `lopsided ${color} ${String(index + 1)}`,
          manaCost: PIP[color] ?? '{C}',
          manaValue: 1,
          colorIdentity: color,
        }),
        archetypes,
      ),
    );

  return [
    ...flat('W', 23, ['azorius control']),
    ...flat('W', 1, ['rakdos aggro']),
    ...flat('U', 2, ['azorius control']),
    ...flat('B', 10, []),
    ...flat('R', 2, ['rakdos aggro']),
    ...flat('R', 8, []),
    ...flat('G', 2, ['mono-green stompy']),
  ];
}
