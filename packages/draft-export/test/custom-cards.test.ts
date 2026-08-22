/**
 * `[CustomCards]` entries: one DSL card in, one Draftmancer card object out.
 *
 * Nothing in this checkout parses the emitted file the way Draftmancer parses
 * it, so every field here is checked against the DSL renderer that produced it
 * rather than against a real import. The mana cost is checked twice — shape and
 * round-trip — because a cost Draftmancer cannot read is the one error that
 * makes a card silently undraftable rather than loudly wrong.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  BASIC_LANDS,
  EXAMPLE_SET,
  exampleCard,
  formatManaCost,
  isCastable,
  isCreature,
  renderOracleText,
  renderTypeLine,
  typeLineParts,
} from '@mtg/dsl';
import { rateCards, toCustomCard, toCustomCards } from '@mtg/draft-export';

const SCRYFALL_MANA_COST = /^(\{\d+\})?(\{[WUBRG]\})*$/;

const CUSTOM_CARDS = toCustomCards(rateCards(EXAMPLE_SET));

function customCard(name: string) {
  const found = CUSTOM_CARDS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no custom card named ${name}`);
  return found;
}

describe('mana costs', () => {
  it('writes every cost in Scryfall symbology', () => {
    for (const entry of CUSTOM_CARDS) {
      expect(entry.mana_cost).toMatch(SCRYFALL_MANA_COST);
    }
  });

  it('round-trips against the DSL renderer for every castable card', () => {
    for (const card of EXAMPLE_SET) {
      if (!isCastable(card)) continue;
      expect(customCard(card.name).mana_cost).toBe(formatManaCost(card.manaCost));
    }
  });

  it('gives a land the empty cost Scryfall gives it, not a zero cost', () => {
    for (const land of BASIC_LANDS) {
      expect(customCard(land.name).mana_cost).toBe('');
    }
  });
});

describe('card fields', () => {
  // This pins a guess, not a fact: `type` carries the whole rendered line and
  // `subtypes` repeats its tail, and nothing here knows whether Draftmancer
  // composes the two. ADR-0003 §3 tables it for the first real import; changing
  // the encoding means changing that row and this expectation together.
  it('takes the type line and subtypes from the DSL renderer', () => {
    for (const card of EXAMPLE_SET) {
      const entry = customCard(card.name);
      expect(entry.type).toBe(renderTypeLine(card));
      const subtypes = typeLineParts(card).subtypes;
      expect(entry.subtypes ?? []).toEqual(subtypes);
    }
  });

  it('names a land subtype even though the DSL card carries none', () => {
    expect(customCard('Plains').subtypes).toEqual(['Plains']);
    expect(customCard('Plains').type).toBe('Basic Land — Plains');
  });

  it('gives power and toughness to creatures only', () => {
    for (const card of EXAMPLE_SET) {
      const entry = customCard(card.name);
      if (isCreature(card)) {
        expect(entry.power).toBe(card.power);
        expect(entry.toughness).toBe(card.toughness);
      } else {
        expect(entry.power).toBeUndefined();
        expect(entry.toughness).toBeUndefined();
      }
    }
  });

  it('carries rarity and colors straight across', () => {
    const sentinel = exampleCard('slc-skywatch-sentinel');
    const entry = customCard(sentinel.name);
    expect(entry.rarity).toBe('common');
    expect(entry.colors).toEqual(['W']);
    expect(customCard('Plains').colors).toEqual([]);
  });

  it('writes colors in WUBRG order whatever order the card declared them', () => {
    const card: Card = { ...exampleCard('slc-wild-summons'), colors: ['G', 'U', 'W'] };
    expect(toCustomCard({ card, score: 0, rating: 1 }).colors).toEqual(['W', 'U', 'G']);
  });

  it('prints the rendered oracle text, and omits the field when there is none', () => {
    expect(customCard('Radiant Charge').oracle_text).toBe(
      renderOracleText(exampleCard('slc-radiant-charge')),
    );
    expect(customCard('Plains').oracle_text).toBe('{T}: Add {W}.');
    expect(customCard('Ironclad Golem').oracle_text).toBeUndefined();
  });

  it('gives every card the rating it was rated', () => {
    for (const rated of rateCards(EXAMPLE_SET)) {
      expect(customCard(rated.card.name).rating).toBe(rated.rating);
    }
  });
});
