/**
 * The sealed pool pane groups with the shared rule, not a fourth copy of it
 * (`mtg-627d`), and it groups on whichever axis the pane was set to
 * (`mtg-6599`).
 *
 * What is this pane's own, and therefore what this file pins: a member is a
 * pool index rather than a card, so two copies stay two members and the pane
 * can still toggle one of them; a land sorts at mana value 0; and a column's
 * count is copies, not distinct cards.
 */
import type { Card } from '@mtg/dsl';
import { manaValue, parseCard } from '@mtg/dsl';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cardGroupingFacts } from '../../src/routes/deck/build';
import { GROUPINGS, groupMembers } from '../../src/routes/deck/grouping';
import { sealedGroups } from '../../src/routes/play/SealedBuilder';
import type { SealedBuild } from '../../src/routes/play/sealed';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function pool(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.slice(0, 24).map((card) => parseCard(card));
}

function buildOf(cards: readonly Card[]): SealedBuild {
  return { pool: cards, chosen: [], basics: null, set: null, foils: null };
}

describe('the sealed curve is the shared grouping read over pool indexes', () => {
  it('sorts ascending and keeps every copy as its own member', () => {
    const cards = pool();
    const doubled = [...cards, ...cards];
    const build = buildOf(doubled);
    const indexes = doubled.map((_, index) => index);

    const groups = sealedGroups(build, indexes, 'manaValue');

    expect(groups.map((group) => group.manaValue)).toEqual(
      [...groups.map((group) => group.manaValue)].sort((left, right) => (left ?? 0) - (right ?? 0)),
    );
    expect(groups.reduce((sum, group) => sum + group.members.length, 0)).toBe(doubled.length);
    for (const group of groups) {
      for (const index of group.members) {
        const card = doubled[index];
        if (card === undefined) throw new Error('index outside the pool');
        expect(card.kind === 'land' ? 0 : manaValue(card.manaCost)).toBe(group.manaValue);
      }
    }
  });

  it('agrees with the shared helper member for member', () => {
    const cards = pool();
    const build = buildOf(cards);
    const indexes = cards.map((_, index) => index);

    const mine = sealedGroups(build, indexes, 'manaValue');
    const shared = groupMembers(
      indexes,
      (index) => {
        const card = cards[index];
        if (card === undefined) throw new Error('index outside the pool');
        return cardGroupingFacts(card);
      },
      () => 1,
      'manaValue',
    );

    expect(mine).toEqual(shared);
    expect(shared.map((group) => group.cards)).toEqual(mine.map((group) => group.members.length));
  });

  it('partitions the same pool on every axis the pane offers', () => {
    const cards = pool();
    const build = buildOf(cards);
    const indexes = cards.map((_, index) => index);

    for (const grouping of GROUPINGS) {
      const groups = sealedGroups(build, indexes, grouping);
      expect(groups.reduce((sum, group) => sum + group.cards, 0)).toBe(cards.length);
      expect(new Set(groups.flatMap((group) => group.members)).size).toBe(cards.length);
    }
  });

  it('offers rarity, because a DSL card carries one', () => {
    const cards = pool();
    const build = buildOf(cards);
    const indexes = cards.map((_, index) => index);

    const groups = sealedGroups(build, indexes, 'rarity');

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((group) => group.label)).not.toContain('Unknown rarity');
  });
});
