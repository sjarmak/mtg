/** A true CR 115 target for one visible card in its controller's graveyard. */
import { describe, expect, it } from 'vitest';
import {
  HAND_AUTHORED_TARGETS,
  MODEL_TARGET_KINDS,
  ModelTargetSpecSchema,
  PERMANENT_CARD_KINDS,
  TargetFilterSchema,
  TargetSpecSchema,
  ZoneReachingModelEffectSchema,
  parseCard,
  renderOracleText,
  type CardInput,
  type TargetKind,
} from '../src/index';

const GRAVEYARD_TARGET: TargetKind = 'targetCardInYourGraveyard' as TargetKind;
const ANY_GRAVEYARD_TARGET: TargetKind = 'targetCardInAGraveyard' as TargetKind;

function recallPost(): CardInput {
  return {
    kind: 'artifact',
    id: 'tst-recall-post',
    name: 'Recall Post',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    colors: [],
    manaCost: { generic: 4 },
    abilities: [
      {
        kind: 'activated',
        cost: {
          mana: { generic: 1 },
          tapSelf: true,
          sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
        },
        effects: [
          {
            kind: 'returnToHand',
            target: { kind: 'targetCardInYourGraveyard', filter: { cardTypes: ['artifact'] } },
          },
        ],
      },
    ],
  } as CardInput;
}

describe('a targeted card in your graveyard', () => {
  it('is a hand-authored engine kind and never widens the model vocabulary', () => {
    expect(
      TargetSpecSchema.parse({
        kind: 'targetCardInYourGraveyard',
        filter: { cardTypes: ['artifact'] },
      }),
    ).toEqual({ kind: 'targetCardInYourGraveyard', filter: { cardTypes: ['artifact'] } });
    expect(ModelTargetSpecSchema.safeParse({ kind: 'targetCardInYourGraveyard' }).success).toBe(false);
    expect(MODEL_TARGET_KINDS).not.toContain(GRAVEYARD_TARGET);
    expect(HAND_AUTHORED_TARGETS.returnToHand).toContain(GRAVEYARD_TARGET);
  });

  it('also names either public graveyard without widening either model schema', () => {
    expect(
      TargetSpecSchema.parse({
        kind: 'targetCardInAGraveyard',
        filter: { cardTypes: ['creature'] },
      }),
    ).toEqual({ kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } });
    expect(ModelTargetSpecSchema.safeParse({ kind: 'targetCardInAGraveyard' }).success).toBe(false);
    expect(MODEL_TARGET_KINDS).not.toContain(ANY_GRAVEYARD_TARGET);
    expect(HAND_AUTHORED_TARGETS.returnFromGraveyard).toContain(ANY_GRAVEYARD_TARGET);
    expect(HAND_AUTHORED_TARGETS.exileTarget).toContain(ANY_GRAVEYARD_TARGET);
  });

  it('carries a bounded mana value through a true graveyard target', () => {
    expect(TargetFilterSchema.parse({ maxManaValue: 3 })).toEqual({ maxManaValue: 3 });
    expect(TargetFilterSchema.safeParse({ maxManaValue: -1 }).success).toBe(false);
    expect(TargetFilterSchema.safeParse({ maxManaValue: 17 }).success).toBe(false);

    const titanReturn = parseCard({
      kind: 'sorcery',
      id: 'tst-titan-return',
      name: 'Titan Return',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 4 },
      colors: ['W'],
      manaCost: { generic: 2, W: 1 },
      effects: [
        {
          kind: 'returnFromGraveyard',
          target: {
            kind: 'targetCardInYourGraveyard',
            filter: { cardTypes: [...PERMANENT_CARD_KINDS], maxManaValue: 3 },
          },
        },
      ],
    } as CardInput);

    expect(renderOracleText(titanReturn)).toBe(
      'Return target permanent card with mana value 3 or less from your graveyard to the battlefield.',
    );
    const effect = titanReturn.effects[0];
    if (effect?.kind !== 'returnFromGraveyard') throw new Error('probe lost its graveyard return');
    expect(ModelTargetSpecSchema.safeParse(effect.target).success).toBe(false);
  });

  it('uses existing zone verbs for targeted reanimation and graveyard exile', () => {
    const rise = parseCard({
      kind: 'sorcery',
      id: 'tst-rise',
      name: 'Rise Again',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 2 },
      colors: ['B'],
      manaCost: { generic: 4, B: 1 },
      effects: [
        {
          kind: 'returnFromGraveyard',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
          control: 'you',
          alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
        },
      ],
    } as CardInput);
    const rebirth = parseCard({
      kind: 'instant',
      id: 'tst-rebirth',
      name: 'Vile Return',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 3 },
      colors: ['B'],
      manaCost: { B: 1 },
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
        },
      ],
    } as CardInput);

    expect(renderOracleText(rise)).toBe(
      'Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.',
    );
    expect(renderOracleText(rebirth)).toBe('Exile target creature card from a graveyard.');
    expect(ZoneReachingModelEffectSchema.safeParse(rise.effects[0]).success).toBe(false);
  });

  it('prints the visible-zone target instead of a resolution-time choice', () => {
    expect(renderOracleText(parseCard(recallPost()))).toBe(
      '{1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.',
    );
  });

  it('prints the hand destination for a targeted graveyard return', () => {
    const find = parseCard({
      kind: 'sorcery',
      id: 'tst-treasured-find',
      name: 'Treasured Find',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 5 },
      colors: ['B', 'G'],
      manaCost: { B: 1, G: 1 },
      effects: [
        {
          kind: 'returnFromGraveyard',
          destination: 'hand',
          target: { kind: 'targetCardInYourGraveyard' },
        },
        { kind: 'exileThisSpell' },
      ],
    } as CardInput);

    expect(renderOracleText(find)).toBe(
      'Return target card from your graveyard to your hand. Exile Treasured Find.',
    );
  });
});
