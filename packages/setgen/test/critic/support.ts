/**
 * Shared builders for the critic test suite: a slot and a card cheap enough to
 * construct field-by-field, so each test states only what it is testing.
 *
 * Mirrors `test/validate.test.ts`'s local `slot()`/`card()` helpers one level
 * up, so the whole `test/critic/` directory shares one copy instead of ten.
 */
import type { Card } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import type { Entry, Slot } from '@mtg/setgen';

export function testSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'CW01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'W',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
    ...overrides,
  };
}

export function testCard(input: Record<string, unknown> = {}): Card {
  return parseCard({
    id: 'tst-test-card',
    name: 'Test Card',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    kind: 'creature',
    colors: ['W'],
    manaCost: mana({ generic: 1, W: 1 }),
    power: 2,
    toughness: 2,
    ...input,
  });
}

export function testEntry(slotOverrides: Partial<Slot> = {}, cardInput: Record<string, unknown> = {}): Entry {
  return { slot: testSlot(slotOverrides), card: testCard(cardInput) };
}
