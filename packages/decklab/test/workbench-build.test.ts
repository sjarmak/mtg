/**
 * One workbench build, end to end against a scripted model.
 *
 * `mtg-yp33.6`. This file did not exist, and the two defects it now holds both
 * lived in the gap: the playtester's Vessari-v1 came back with 3 cards of a stated 60,
 * and the shelf said only that it was short. What it could not say — because
 * `toVariation` was dropping it — was that the selection loop had stopped at its
 * spend ceiling, which is the half of the sentence that names what to change.
 *
 * The land count is stated in every case here, so no answer is spent on it and
 * the script is proposal rounds only. The scripted provider repeats its last
 * answer, which is what lets one scripted round stand for however many the loop
 * decides to ask for.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PoolSet } from '../src/pool';
import { buildVariation } from '../src/workbench/build';
import type { WorkbenchCriteria } from '../src/workbench/variation';
import { DeckVariationSchema, summarize, WorkbenchCriteriaSchema } from '../src/workbench/variation';
import { scriptedProvider, type ScriptedAnswer } from './support/scripted-provider';

const SET_CODE = 'XMP';

function creature(id: string, name: string): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 1 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } as CardInput);
}

const SET: PoolSet = {
  code: SET_CODE,
  name: 'the flagship set',
  cards: Array.from({ length: 12 }, (_unused, index) =>
    creature(`xmp-beast-${String(index + 1)}`, `Kingdom Beast ${String(index + 1)}`),
  ),
};

function criteria(overrides: Record<string, unknown> = {}): WorkbenchCriteria {
  return WorkbenchCriteriaSchema.parse({
    prompt: 'a green beatdown deck',
    sets: [SET_CODE],
    colors: ['G'],
    size: 40,
    landCount: 16,
    ...overrides,
  });
}

/** One round naming these cards this many times each, repeated as often as asked. */
function script(names: readonly string[], count: number): readonly ScriptedAnswer[] {
  return [
    {
      plan: 'curve out and attack',
      cards: names.map((name) => ({
        name,
        count,
        criteria: ['sets'],
        reason: 'a two-drop that attacks',
      })),
    },
  ];
}

async function build(
  answers: readonly ScriptedAnswer[],
  stated: WorkbenchCriteria,
  maxSpendUsd = 10,
  costUsd = 0,
) {
  return buildVariation({
    provider: scriptedProvider(answers, { costUsd }),
    sets: [SET],
    criteria: stated,
    name: 'Vessari-v1',
    parentId: null,
    maxSpendUsd,
    now: () => new Date('2026-09-01T17:19:58.977Z'),
    newId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
}

describe('a workbench build', () => {
  it('keeps the set contract and selector identity on the saved variation', async () => {
    const variation = await build(
      script(
        SET.cards.slice(0, 6).map((card) => card.name),
        4,
      ),
      criteria({
        opponentPopulation: {
          id: 'local-field',
          members: [{ id: 'pressure', share: 1, strategy: 'curve out with creatures' }],
        },
      }),
    );
    expect(variation.construction).toMatchObject({
      format: {
        id: 'decklab-constructed-format/v1',
        source: { kind: 'sets', sets: ['XMP'] },
        deckSize: 40,
        copyLimit: 4,
        opponentPopulation: { id: 'local-field' },
      },
      selection: {
        id: 'decklab-model-repair/v1',
        provider: 'fixture',
        model: 'scripted',
        fallbackId: 'decklab-verified-partial/v1',
      },
    });
  });

  it('keeps a card whose count is over the stated limit, at the limit', async () => {
    // The failure this reproduces: `maxCopies` 1, a model proposing the ordinary
    // four-of spread, and every proposal discarded whole. Twelve names at four
    // copies each used to yield a deck of nothing; it now yields twelve.
    const variation = await build(
      script(
        SET.cards.map((card) => card.name),
        4,
      ),
      criteria({ maxCopies: 1 }),
    );

    expect(variation.spells).toHaveLength(12);
    expect(variation.spells.every((entry) => entry.count === 1)).toBe(true);
  });

  it('honors a limit above one, so the trim is the stated number and not always one', async () => {
    const variation = await build(
      script(['Kingdom Beast 1', 'Kingdom Beast 2'], 4),
      criteria({ maxCopies: 2 }),
    );

    expect(variation.spells.map((entry) => entry.count)).toStrictEqual([2, 2]);
  });

  it('says the selection stopped at its spend ceiling, not merely that the deck is short', async () => {
    // The sentence Vessari-v1 needed and did not get. `deck.shortfalls` knows the
    // deck is short; only the selection loop knows why it stopped filling it.
    // Two rounds that each add a card, at $0.40 a round against a $0.50
    // ceiling: the third round is the one the money stops, with 22 of the 24
    // spells still to find. A script that repeated one card would stop the loop
    // as idle instead, which is a different sentence.
    const variation = await build(
      [...script(['Kingdom Beast 1'], 1), ...script(['Kingdom Beast 2'], 1)],
      criteria(),
      0.5,
      0.4,
    );

    expect(variation.shortfalls.some((said) => said.includes('against a target of'))).toBe(true);
    expect(variation.shortfalls.some((said) => said.includes('allowed to spend on model calls'))).toBe(true);
  });

  it('says nothing extra when the deck filled, because there is nothing to explain', async () => {
    const variation = await build(
      script(
        SET.cards.map((card) => card.name),
        2,
      ),
      criteria({ size: 40 }),
    );

    expect(variation.shortfalls.filter((said) => said.includes('card selection ended'))).toEqual([]);
  });
});

describe('a saved variation records what its build cost', () => {
  // `mtg-yp33.7`. The shelf could say a deck was finished and never say what it
  // cost to finish, on a surface whose whole safety story is a stated ceiling.
  it('carries the rounds and the dollars, against the ceiling in force', async () => {
    const variation = await build(script(['Kingdom Beast 1'], 4), criteria(), 10, 0.75);

    expect(variation.build).toBeDefined();
    expect(variation.build?.rounds).toBeGreaterThan(0);
    expect(variation.build?.maxSpendUsd).toBe(10);
    expect(variation.build?.spentUsd).toBeCloseTo((variation.build?.rounds ?? 0) * 0.75, 10);
  });

  it('is read back by a shelf that has not loaded the decklist', async () => {
    // The row is what a person reads first, and the whole point of keeping the
    // number is that it is legible without opening the deck.
    const variation = await build(script(['Kingdom Beast 1'], 4), criteria(), 10, 0.75);

    expect(summarize(variation).spentUsd).toBe(variation.build?.spentUsd);
  });

  it('reads back a variation built before the spend was ever recorded', async () => {
    // Version 1 files are on disk from before this field existed. An added field
    // does not change what any other field means, so it is optional rather than
    // a version bump: a shelf that dropped the playtester's seven built decks to gain
    // a dollar figure would have made the surface worse than the hole it fixed.
    const built = await build(script(['Kingdom Beast 1'], 4), criteria());
    const { build: _dropped, ...older } = built;

    const reread = DeckVariationSchema.parse(older);
    expect(reread.build).toBeUndefined();
    expect(summarize(reread).spentUsd).toBeNull();
  });
});
