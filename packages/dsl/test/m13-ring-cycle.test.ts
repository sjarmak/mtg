/** M13's five Rings through one attachment-host vocabulary. */
import { describe, expect, it } from 'vitest';
import {
  HAND_AUTHORED_TARGETS,
  CardEffectSchema,
  EffectSchema,
  ModelAbilitySchema,
  ModelEffectSchema,
  MODEL_TARGET_KINDS,
  parseCard,
  renderOracleText,
  safeParseCard,
  TARGET_KINDS,
  TokenEffectSchema,
  type Card,
  type CardInput,
  type Color,
  type Keyword,
} from '@mtg/dsl';

const RING_COLORS = {
  'Ring of Evos Isle': 'U',
  'Ring of Kalonia': 'G',
  'Ring of Thune': 'W',
  'Ring of Valkas': 'R',
  'Ring of Xathrid': 'B',
} as const satisfies Readonly<Record<string, Color>>;

const STATIC_GRANTS = {
  'Ring of Kalonia': 'trample',
  'Ring of Thune': 'vigilance',
  'Ring of Valkas': 'haste',
} as const satisfies Readonly<Record<string, Keyword>>;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function ringInput(name: keyof typeof RING_COLORS, collectorNumber: number): CardInput {
  const color = RING_COLORS[name];
  const grant = name in STATIC_GRANTS ? STATIC_GRANTS[name as keyof typeof STATIC_GRANTS] : undefined;
  const equip = {
    kind: 'activated' as const,
    cost: { mana: { generic: 1 } },
    attach: { modifications: grant === undefined ? [] : [{ kind: 'grantKeyword' as const, keyword: grant }] },
    effects: [],
  };
  const upkeep = {
    kind: 'triggered' as const,
    condition: 'beginningOfYourUpkeep' as const,
    effects: [
      {
        kind: 'putCounters' as const,
        counter: 'plusOnePlusOne' as const,
        count: 1,
        target: { kind: 'equippedCreature' as const },
        recipientCondition: { kind: 'hasColor' as const, color },
      },
    ],
  };
  const distinct =
    name === 'Ring of Evos Isle'
      ? {
          kind: 'activated' as const,
          cost: { mana: { generic: 2 } },
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn' as const,
              keyword: 'hexproof' as const,
              target: { kind: 'equippedCreature' as const },
            },
          ],
        }
      : name === 'Ring of Xathrid'
        ? {
            kind: 'activated' as const,
            cost: { mana: { generic: 2 } },
            effects: [
              { kind: 'regeneratePermanent' as const, target: { kind: 'equippedCreature' as const } },
            ],
          }
        : null;
  return {
    kind: 'artifact',
    id: `m13-${slug(name)}`,
    name,
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber },
    manaCost: { generic: 2 },
    subtypes: ['Equipment'],
    abilities: distinct === null ? [equip, upkeep] : [distinct, upkeep, equip],
  };
}

const RINGS: readonly Card[] = Object.keys(RING_COLORS).map((name, index) =>
  parseCard(ringInput(name as keyof typeof RING_COLORS, 211 + index)),
);

describe('M13 Ring cycle DSL', () => {
  it('keeps the attachment referent, live predicate, regeneration, and empty equip clause engine-only', () => {
    expect(TARGET_KINDS).toContain('equippedCreature');
    expect(MODEL_TARGET_KINDS as readonly string[]).not.toContain('equippedCreature');
    expect(HAND_AUTHORED_TARGETS.putCounters).toContain('equippedCreature');
    expect(HAND_AUTHORED_TARGETS.grantKeywordUntilEndOfTurn).toContain('equippedCreature');
    expect(HAND_AUTHORED_TARGETS.regeneratePermanent).toContain('equippedCreature');

    const evos = ringInput('Ring of Evos Isle', 211);
    expect(ModelAbilitySchema.safeParse(evos.abilities?.[2]).success).toBe(false);
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'activated',
        cost: { mana: { generic: 1 } },
        attach: { modification: { kind: 'grantKeyword', keyword: 'hexproof' } },
        effects: [],
      }).success,
    ).toBe(false);
    expect(
      ModelEffectSchema.safeParse({
        kind: 'grantKeywordUntilEndOfTurn',
        keyword: 'hexproof',
        target: { kind: 'targetCreature' },
      }).success,
    ).toBe(false);
    const counter = RINGS[0]?.abilities[1];
    if (counter?.kind !== 'triggered') throw new Error('Ring of Evos Isle lost its upkeep trigger');
    const effect = counter.effects[0];
    expect(CardEffectSchema.safeParse(effect).success).toBe(true);
    expect(EffectSchema.safeParse(effect).success).toBe(false);
    expect(TokenEffectSchema.safeParse(effect).success).toBe(false);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('renders all five current Oracle texts in their printed order', () => {
    expect(RINGS.map(renderOracleText)).toEqual([
      '{2}: Equipped creature gains hexproof until end of turn.\n' +
        "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's blue.\n" +
        'Equip {1}',
      'Equipped creature has trample.\n' +
        "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's green.\n" +
        'Equip {1}',
      'Equipped creature has vigilance.\n' +
        "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's white.\n" +
        'Equip {1}',
      'Equipped creature has haste.\n' +
        "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's red.\n" +
        'Equip {1}',
      '{2}: Regenerate equipped creature.\n' +
        "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's black.\n" +
        'Equip {1}',
    ]);
  });

  it('refuses every attachment-relative field when its source or pairing cannot supply the referent', () => {
    const evos = ringInput('Ring of Evos Isle', 211);
    const nonEquipment = safeParseCard({ ...evos, subtypes: [] });
    expect(nonEquipment.ok).toBe(false);
    if (!nonEquipment.ok) {
      expect(nonEquipment.violations.map(({ code }) => code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }

    const scoped = structuredClone(evos) as CardInput;
    const upkeep = scoped.abilities?.[1];
    if (upkeep?.kind !== 'triggered' || upkeep.effects[0]?.kind !== 'putCounters') {
      throw new Error('hostile Ring lost its upkeep counter');
    }
    upkeep.effects[0] = {
      ...upkeep.effects[0],
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
    };
    const invalidScope = safeParseCard(scoped);
    expect(invalidScope.ok).toBe(false);
    if (!invalidScope.ok) {
      expect(invalidScope.violations.map(({ code }) => code)).toContain('EFFECT_CONDITION_INVALID');
    }

    const freelyTargeted = structuredClone(evos) as CardInput;
    const targetedUpkeep = freelyTargeted.abilities?.[1];
    if (targetedUpkeep?.kind !== 'triggered' || targetedUpkeep.effects[0]?.kind !== 'putCounters') {
      throw new Error('targeted hostile Ring lost its upkeep counter');
    }
    targetedUpkeep.effects[0] = {
      ...targetedUpkeep.effects[0],
      target: { kind: 'targetCreature' },
    };
    const invalidTarget = safeParseCard(freelyTargeted);
    expect(invalidTarget.ok).toBe(false);
    if (!invalidTarget.ok) {
      expect(invalidTarget.violations.map(({ code }) => code)).toContain('EFFECT_CONDITION_INVALID');
    }
  });
});
