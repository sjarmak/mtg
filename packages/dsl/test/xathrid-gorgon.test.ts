/** Xathrid Gorgon's incarnation-bound petrification bundle. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  EFFECT_KINDS,
  HAND_AUTHORED_TARGETS,
  MODEL_COUNTER_KINDS,
  ModelEffectSchema,
  UNPRICED_EFFECT_KINDS,
  legalTargetsFor,
  renderOracleText,
  validateCards,
} from '@mtg/dsl';
import { parseCard, safeParseCard } from '../src/parse';

const PETRIFY = {
  kind: 'petrifyCreature' as const,
  target: { kind: 'targetCreature' as const },
};

const XATHRID_INPUT = {
  kind: 'creature' as const,
  id: 'm13-118-xathrid-gorgon',
  name: 'Xathrid Gorgon',
  rarity: 'rare' as const,
  set: { code: 'M13', collectorNumber: 118 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B' as const],
  subtypes: ['Gorgon'],
  power: 3,
  toughness: 6,
  keywords: ['deathtouch' as const],
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 2, B: 1 }, tapSelf: true },
      effects: [PETRIFY],
    },
  ],
};

describe('the petrification vocabulary', () => {
  it('is hand-authored engine vocabulary outside both generator schemas', () => {
    expect(ALL_EFFECT_KINDS).toContain('petrifyCreature');
    expect([...UNPRICED_EFFECT_KINDS]).toContain('petrifyCreature');
    expect([...EFFECT_KINDS]).not.toContain('petrifyCreature');
    expect(CardEffectSchema.safeParse(PETRIFY).success).toBe(true);
    expect(ModelEffectSchema.safeParse(PETRIFY).success).toBe(false);
    expect(HAND_AUTHORED_TARGETS.petrifyCreature).toBeUndefined();
    expect(legalTargetsFor('petrifyCreature')).toEqual(['targetCreature']);
  });

  it('keeps the marker counter hand-authored and behavior-free', () => {
    expect(COUNTER_KINDS).toContain('petrification');
    expect(MODEL_COUNTER_KINDS).not.toContain('petrification');
    expect(COUNTER_DECLARATIONS.petrification).toEqual({
      printName: 'petrification',
      modifications: [],
    });
  });

  it('refuses every target spelling except exactly one creature target', () => {
    for (const target of [
      { kind: 'noTarget' },
      { kind: 'targetPermanent' },
      { kind: 'targetCreatureYouControl' },
    ] as const) {
      const result = safeParseCard({
        ...XATHRID_INPUT,
        abilities: [
          {
            ...XATHRID_INPUT.abilities[0],
            effects: [{ kind: 'petrifyCreature', target }],
          },
        ],
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe('Xathrid Gorgon', () => {
  it('validates and renders the pinned current Oracle text exactly', () => {
    const card = parseCard(XATHRID_INPUT);
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Deathtouch\n{2}{B}, {T}: Put a petrification counter on target creature. It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can't be activated. (A creature with defender can't attack.)",
    );
  });
});
