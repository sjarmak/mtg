/** Disciple of Bolas: a resolve-time sacrifice whose LKI feeds two effects. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AmountSchema,
  canonicalJson,
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type Card,
  type CardInput,
} from '../src/index';

const SACRIFICED_POWER = { kind: 'sacrificedPermanentPowerThisResolution' } as const;

function discipleInput(effects: readonly unknown[]): CardInput {
  return {
    kind: 'creature',
    id: 'm13-088-disciple-of-bolas',
    name: 'Disciple of Bolas',
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 88 },
    manaCost: { generic: 3, B: 1 },
    colors: ['B'],
    subtypes: ['Human', 'Wizard'],
    power: 2,
    toughness: 1,
    abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [...effects] }],
  } as unknown as CardInput;
}

const DISCIPLE_EFFECTS = [
  {
    kind: 'sacrificePermanent',
    filter: { cardTypes: ['creature'] },
    excludeSource: true,
    target: { kind: 'noTarget' },
  },
  { kind: 'gainLife', amount: SACRIFICED_POWER, target: { kind: 'noTarget' } },
  { kind: 'drawCards', count: SACRIFICED_POWER, target: { kind: 'noTarget' } },
] as const;

describe('the exact Disciple of Bolas sentence', () => {
  it('parses, validates, and renders the linked sacrifice paragraph', () => {
    const card = parseCard(discipleInput(DISCIPLE_EFFECTS));

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "When Disciple of Bolas enters the battlefield, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.",
    );
  });

  it('keeps resolve-time sacrifice LKI outside the generator vocabulary', () => {
    expect(AmountSchema.parse(SACRIFICED_POWER)).toEqual(SACRIFICED_POWER);
    expect(canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }))).not.toContain(
      'sacrificedPermanentPowerThisResolution',
    );
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
          { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
          { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps a noncreature sacrifice antecedent internally consistent', () => {
    const card = parseCard(
      discipleInput([
        {
          kind: 'sacrificePermanent',
          filter: { cardTypes: ['artifact'] },
          target: { kind: 'noTarget' },
        },
        { kind: 'gainLife', amount: SACRIFICED_POWER, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: SACRIFICED_POWER, target: { kind: 'noTarget' } },
      ]),
    );

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "When Disciple of Bolas enters the battlefield, sacrifice an artifact. You gain life equal to that permanent's power. Draw a number of cards equal to that permanent's power.",
    );
  });
});

describe('a sacrificed-power amount with no single sacrifice behind it', () => {
  it('refuses use before a sacrifice with an actionable path', () => {
    const card = discipleInput([
      { kind: 'gainLife', amount: SACRIFICED_POWER, target: { kind: 'noTarget' } },
    ]) as unknown as Card;

    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[0].amount.kind',
        message: expect.stringContaining('no earlier sacrifice'),
      }),
    );
  });

  it('refuses an earlier multi-permanent sacrifice rather than inventing one power', () => {
    const card = discipleInput([
      {
        kind: 'sacrificePermanent',
        count: 2,
        filter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      { kind: 'drawCards', count: SACRIFICED_POWER, target: { kind: 'noTarget' } },
    ]) as unknown as Card;

    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[1].count.kind',
        message: expect.stringContaining('exactly one permanent'),
      }),
    );
  });

  it('refuses multiple sacrifice writers even if one happens to take one permanent', () => {
    const card = discipleInput([
      {
        kind: 'sacrificePermanent',
        count: 2,
        filter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'sacrificePermanent',
        filter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      { kind: 'drawCards', count: SACRIFICED_POWER, target: { kind: 'noTarget' } },
    ]) as unknown as Card;

    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[2].count.kind',
        message: expect.stringContaining('2 earlier sacrifices'),
      }),
    );
  });
});
