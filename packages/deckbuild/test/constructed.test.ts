/**
 * Constructed legality: sixty cards, four copies, Basic lands exempt.
 *
 * The two rules are stated here rather than inside the builder because Limited
 * must not inherit them, and the first assertion in each pair is the one that
 * says so: a pool builder that never asked for a copy limit reports no excess
 * however many times the same common was opened.
 */
import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  CONSTRUCTED_COPY_LIMIT,
  CONSTRUCTED_DECK_SIZE,
  buildFromSpells,
  constructedConfig,
  copyExcesses,
  formatCopyExcess,
  resolveConfig,
} from '../src/index';

function first(): Card {
  const [card] = EXAMPLE_CARDS;
  if (card === undefined) throw new Error('no example card');
  return card;
}

function copies(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

describe('the copy limit', () => {
  it('reports nothing when there is no limit, which is Limited', () => {
    expect(copyExcesses(copies(first(), 9), null)).toEqual([]);
  });

  it('names the card, how many are played, and what was allowed', () => {
    expect(copyExcesses(copies(first(), 5), CONSTRUCTED_COPY_LIMIT)).toEqual([
      { name: first().name, limit: 4, played: 5 },
    ]);
  });

  it('allows exactly the limit', () => {
    expect(copyExcesses(copies(first(), 4), CONSTRUCTED_COPY_LIMIT)).toEqual([]);
  });

  it('exempts Basic lands, so a mana base is never an excess', () => {
    const [swamp] = BASIC_LANDS.filter((card) => card.name === 'Swamp');
    if (swamp === undefined) throw new Error('no Swamp fixture');
    expect(copyExcesses(copies(swamp, 24), CONSTRUCTED_COPY_LIMIT)).toEqual([]);
  });

  it('counts by name, because two printings of one card are four copies between them', () => {
    const printing: Card = { ...first(), id: 'other-printing' };
    expect(copyExcesses([...copies(first(), 3), ...copies(printing, 3)], 4)).toEqual([
      { name: first().name, limit: 4, played: 6 },
    ]);
  });

  it('says so in one line', () => {
    expect(formatCopyExcess({ name: 'Saltbank Lookout', limit: 4, played: 5 })).toBe(
      'Saltbank Lookout: 5 copies, 4 allowed',
    );
  });
});

describe('the Constructed config', () => {
  it('resolves: sixty cards, a curve that sums to the spells, and a limit of four', () => {
    const config = resolveConfig(constructedConfig());
    expect(config.deckSize).toBe(CONSTRUCTED_DECK_SIZE);
    expect(config.copyLimit).toBe(CONSTRUCTED_COPY_LIMIT);
    expect(config.deckSize - config.landCount).toBe(36);
  });

  it('leaves Limited alone: the default config has no copy limit at all', () => {
    expect(resolveConfig().copyLimit).toBeNull();
  });

  it('takes an override for every field it sets, so a format is a caller and not a fork', () => {
    const config = resolveConfig(constructedConfig({ copyLimit: 1, minCreatures: 4 }));
    expect(config.copyLimit).toBe(1);
    expect(config.minCreatures).toBe(4);
    expect(config.deckSize).toBe(CONSTRUCTED_DECK_SIZE);
  });

  it('refuses a copy limit that is neither null nor a positive whole number', () => {
    expect(() => resolveConfig({ copyLimit: 0 })).toThrow(/copyLimit/u);
    expect(() => resolveConfig({ copyLimit: 2.5 })).toThrow(/copyLimit/u);
  });
});

describe('a manual deck under the Constructed config', () => {
  it('is incomplete while a card is over the limit, even at sixty cards', () => {
    const spells = [...copies(first(), 5), ...EXAMPLE_CARDS.slice(1)];
    const deck = buildFromSpells(spells, [...EXAMPLE_CARDS, ...BASIC_LANDS], constructedConfig());
    expect(deck.excesses.map((excess) => excess.name)).toEqual([first().name]);
    expect(deck.complete).toBe(false);
  });

  it('reports no excess for the same picks under Limited, which has no limit', () => {
    const spells = [...copies(first(), 5), ...EXAMPLE_CARDS.slice(1)];
    expect(buildFromSpells(spells, [...EXAMPLE_CARDS, ...BASIC_LANDS]).excesses).toEqual([]);
  });
});
