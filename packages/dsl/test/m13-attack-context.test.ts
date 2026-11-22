import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const ODRIC: CardInput = {
  kind: 'creature',
  id: 'm13-odric-master-tactician',
  name: 'Odric, Master Tactician',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 23 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  supertypes: ['legendary'],
  subtypes: ['Human', 'Soldier'],
  keywords: ['firstStrike'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAndThreeOthersAttack',
      effects: [{ kind: 'chooseBlockersThisCombat' }],
    },
  ],
  power: 3,
  toughness: 4,
};

const BLOOD_RECKONING: CardInput = {
  kind: 'enchantment',
  id: 'm13-blood-reckoning',
  name: 'Blood Reckoning',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 81 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'creatureAttacksYouOrPlaneswalkerYouControl',
      effects: [{ kind: 'loseLife', amount: 1, target: { kind: 'triggeringPlayer' } }],
    },
  ],
};

const NEFAROX: CardInput = {
  kind: 'creature',
  id: 'm13-nefarox-overlord-of-grixis',
  name: 'Nefarox, Overlord of Grixis',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 103 },
  manaCost: { generic: 4, B: 2 },
  colors: ['B'],
  supertypes: ['legendary'],
  subtypes: ['Demon'],
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureAttacksAlone',
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 1,
          target: { kind: 'triggeringCreature' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfAttacksAlone',
      effects: [
        {
          kind: 'sacrificePermanent',
          target: { kind: 'triggeringPlayer' },
          filter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
  power: 5,
  toughness: 5,
};

describe('M13 attackers-declared vocabulary', () => {
  it.each([ODRIC, BLOOD_RECKONING, NEFAROX])('validates $name without widening model schemas', (input) => {
    const card = parseCard(input);
    expect(validateCard(card)).toEqual([]);
    for (const ability of card.abilities) {
      if (ability.kind !== 'triggered') continue;
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
    const engineOnly = card.abilities
      .filter((ability) => ability.kind === 'triggered')
      .flatMap((ability) => ability.effects)
      .filter(
        (effect) =>
          effect.kind === 'chooseBlockersThisCombat' ||
          ('target' in effect && effect.target?.kind === 'triggeringPlayer'),
      );
    for (const effect of engineOnly) expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('prints all three cards exactly', () => {
    expect(renderOracleText(parseCard(ODRIC))).toContain(
      'Whenever Odric, Master Tactician and at least three other creatures attack, you choose which creatures block this combat and how those creatures block.',
    );
    expect(renderOracleText(parseCard(BLOOD_RECKONING))).toBe(
      "Whenever a creature attacks you or a planeswalker you control, that creature's controller loses 1 life.",
    );
    expect(renderOracleText(parseCard(NEFAROX))).toContain(
      'Whenever Nefarox, Overlord of Grixis attacks alone, defending player sacrifices a creature of their choice.',
    );
  });

  it('does not give a noncreature edict Nefarox creature wording', () => {
    const artifactEdict = parseCard({
      ...NEFAROX,
      id: 'artifact-edict-attacker',
      name: 'Artifact Edict Attacker',
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacksAlone',
          effects: [
            {
              kind: 'sacrificePermanent',
              target: { kind: 'triggeringPlayer' },
              filter: { cardTypes: ['artifact'] },
            },
          ],
        },
      ],
    });

    expect(renderOracleText(artifactEdict)).toContain('that player sacrifices an artifact.');
    expect(renderOracleText(artifactEdict)).not.toContain('sacrifices a creature');
  });

  it('refuses block-declaration authority outside Odric-shaped creature triggers', () => {
    const instant = safeParseCard({
      kind: 'instant',
      id: 'invalid-block-authority-spell',
      name: 'Invalid Block Authority Spell',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [{ kind: 'chooseBlockersThisCombat' }],
    });
    expect(instant.ok).toBe(false);
    if (instant.ok) throw new Error('invalid spell unexpectedly parsed');
    expect(instant.violations.map((entry) => entry.code)).toContain('EFFECT_ILLEGAL_ON_CARD_TYPE');

    const wrongTrigger = safeParseCard({
      ...ODRIC,
      id: 'invalid-block-authority-trigger',
      name: 'Invalid Block Authority Trigger',
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          effects: [{ kind: 'chooseBlockersThisCombat' }],
        },
      ],
    });
    expect(wrongTrigger.ok).toBe(false);
    if (wrongTrigger.ok) throw new Error('invalid trigger unexpectedly parsed');
    expect(wrongTrigger.violations.map((entry) => entry.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');

    const noncreature = safeParseCard({
      kind: 'enchantment',
      id: 'invalid-block-authority-source',
      name: 'Invalid Block Authority Source',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { W: 1 },
      colors: ['W'],
      subtypes: [],
      abilities: ODRIC.abilities,
    });
    expect(noncreature.ok).toBe(false);
    if (noncreature.ok) throw new Error('invalid source unexpectedly parsed');
    expect(noncreature.violations.map((entry) => entry.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
  });
});
