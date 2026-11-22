import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  allocateSlots,
  assembleCard,
  checkZoomCapacity,
  parseBrief,
  parseSetFile,
  validateGeneratedSet,
  ZOOM_RULES_CHARACTER_CAPACITY,
} from '@mtg/setgen';
import type { Entry, Slot } from '@mtg/setgen';
import { synthesizeCard, TEST_BRIEF } from './helpers';

const KEYWORDS = ['flying', 'vigilance', 'lifelink', 'firstStrike', 'trample', 'deathtouch'] as const;

const ABILITIES = [
  {
    kind: 'triggered',
    condition: 'selfEnters',
    effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'activated',
    cost: { mana: { generic: 2, U: 1 } },
    effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'triggered',
    condition: 'selfDies',
    effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }],
  },
] as const;

function wordyCard(keywords: number): Card {
  return parseCard({
    id: `zrc-zoom-capacity-${String(keywords)}`,
    name: 'Warden of the Long Reading Room',
    kind: 'creature',
    rarity: 'mythic',
    set: { code: 'ZRC', collectorNumber: 1 },
    colors: ['W', 'U'],
    subtypes: ['Warden'],
    manaCost: { generic: 4, W: 1, U: 1 },
    power: 4,
    toughness: 5,
    keywords: KEYWORDS.slice(0, keywords),
    abilities: ABILITIES,
  });
}

const SLOT: Slot = {
  id: 'RU01',
  index: 0,
  collectorNumber: 1,
  rarity: 'rare',
  color: 'U',
  cardKind: 'creature',
  role: 'creature',
  manaValueMin: 6,
  manaValueMax: 6,
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  auraModifications: [],
  triggerConditions: [],
  mechanics: [],
  archetypes: [],
  signpost: false,
};

function entry(card: Card): Entry {
  return { slot: SLOT, card };
}

describe('the generated set stays inside the fixed zoom reading surface', () => {
  const atCapacity = wordyCard(5);
  const overCapacity = wordyCard(6);

  it('accepts the measured 262-character ordinary face', () => {
    expect(renderOracleText(atCapacity)).toHaveLength(ZOOM_RULES_CHARACTER_CAPACITY.ordinary);
    expect(checkZoomCapacity([entry(atCapacity)])).toStrictEqual([]);
  });

  it('refuses the measured 274-character overrun and names the slot to regenerate', () => {
    expect(renderOracleText(overCapacity)).toHaveLength(274);
    const findings = checkZoomCapacity([entry(overCapacity)]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'ZOOM_TEXT_OVERFLOW',
      severity: 'error',
      slotIds: ['RU01'],
    });
    expect(findings[0]?.message).toContain('Warden of the Long Reading Room');
    expect(findings[0]?.message).toContain('274');
    expect(findings[0]?.message).toContain('262');
    expect(findings[0]?.message).toContain('zoom');
  });

  it('drives that refusal through the generator validator and retry seam', () => {
    const allocation = allocateSlots(parseBrief(TEST_BRIEF));
    const cards = new Map<string, Card>();
    for (const slot of allocation.slots) {
      const assembled = assembleCard(slot, synthesizeCard(slot), allocation.brief.setCode);
      if (assembled.card !== undefined) cards.set(slot.id, assembled.card);
    }
    const blamed = allocation.slots[0];
    if (blamed === undefined) throw new Error('the test allocation has no slots');
    cards.set(blamed.id, overCapacity);

    const validation = validateGeneratedSet({ allocation, cards, tertiaryBudget: 20 });
    const refusal = validation.findings.find((item) => item.code === 'ZOOM_TEXT_OVERFLOW');
    expect(refusal?.slotIds).toStrictEqual([blamed.id]);
    expect(validation.ok).toBe(false);
    expect(validation.failingSlotIds).toContain(blamed.id);
  });

  it('keeps imported compatibility separate from generation policy', () => {
    expect(() =>
      parseSetFile({
        formatVersion: 1,
        set: {
          code: 'ZRC',
          name: 'Zoom Reading Contract',
          theme: 'A fixture for the generated-card capacity boundary.',
          seed: 'zoom-capacity',
          profile: 'test v1',
        },
        cards: [overCapacity],
      }),
    ).not.toThrow();
  });
});
