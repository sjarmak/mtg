/** M13's blocker-relative turn rules stay exact and hand-authored. */
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const COURTLY = {
  kind: 'creature',
  id: 'm13-courtly-provocateur',
  name: 'Courtly Provocateur',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 46 },
  manaCost: { generic: 2, U: 1 },
  colors: ['U'],
  subtypes: ['Human', 'Wizard'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'attacksThisTurnIfAble', target: { kind: 'targetCreature' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'blocksThisTurnIfAble', target: { kind: 'targetCreature' } }],
    },
  ],
} as const;

const JESTER = {
  kind: 'creature',
  id: 'm13-goblin-battle-jester',
  name: 'Goblin Battle Jester',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 135 },
  manaCost: { generic: 3, R: 1 },
  colors: ['R'],
  subtypes: ['Goblin'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      spellColors: ['R'],
      effects: [{ kind: 'cantBlockThisTurn', target: { kind: 'targetCreature' } }],
    },
  ],
} as const;

const RAMPAGE = {
  kind: 'sorcery',
  id: 'm13-predatory-rampage',
  name: 'Predatory Rampage',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 180 },
  manaCost: { generic: 3, G: 2 },
  colors: ['G'],
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 3,
      toughness: 3,
      target: { kind: 'noTarget' },
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
    },
    {
      kind: 'blocksThisTurnIfAble',
      target: { kind: 'noTarget' },
      scope: 'permanentsOpponentsControl',
      scopeFilter: { cardTypes: ['creature'] },
    },
  ],
} as const;

describe('M13 turn-scoped block authoring', () => {
  it('parses and renders all three cards exactly', () => {
    const courtly = parseCard(COURTLY as unknown as CardInput);
    const jester = parseCard(JESTER as unknown as CardInput);
    const rampage = parseCard(RAMPAGE as unknown as CardInput);

    expect(validateCard(courtly)).toEqual([]);
    expect(validateCard(jester)).toEqual([]);
    expect(validateCard(rampage)).toEqual([]);
    expect(renderOracleText(courtly)).toBe(
      '{T}: Target creature attacks this turn if able.\n{T}: Target creature blocks this turn if able.',
    );
    expect(renderOracleText(jester)).toBe(
      "Whenever you cast a spell that's red, target creature can't block this turn.",
    );
    expect(renderOracleText(rampage)).toBe(
      'Creatures you control get +3/+3 until end of turn. Each creature your opponents control blocks this turn if able.',
    );
  });

  it('keeps both block-rule primitives outside the model envelope', () => {
    for (const effect of [
      COURTLY.abilities[1].effects[0],
      JESTER.abilities[0].effects[0],
      RAMPAGE.effects[1],
    ]) {
      expect(CardEffectSchema.safeParse(effect).success).toBe(true);
      expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
    }
  });

  it('rejects a scoped group without a filter and a targeted rule with a group', () => {
    expect(() =>
      parseCard({
        ...RAMPAGE,
        effects: [
          {
            kind: 'blocksThisTurnIfAble',
            target: { kind: 'noTarget' },
            scope: 'permanentsOpponentsControl',
          },
        ],
      } as unknown as CardInput),
    ).toThrow(/scopeFilter/u);
    expect(() =>
      parseCard({
        ...RAMPAGE,
        effects: [
          {
            kind: 'blocksThisTurnIfAble',
            target: { kind: 'targetCreature' },
            scope: 'permanentsOpponentsControl',
            scopeFilter: { cardTypes: ['creature'] },
          },
        ],
      } as unknown as CardInput),
    ).toThrow(/target/u);
  });
});
