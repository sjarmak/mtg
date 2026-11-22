/** Exact Mystifying Maze text and the generator boundary around its delayed return. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Card, CardInput } from '../src/index';
import { canonicalJson, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';

function mazeInput(): CardInput {
  return {
    kind: 'land',
    id: 'm11-mystifying-maze',
    name: 'Mystifying Maze',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 226 },
    producesMana: ['C'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 4 }, tapSelf: true },
        effects: [
          {
            kind: 'exileTarget',
            target: {
              kind: 'targetCreatureOpponentControls',
              filter: { combat: 'attacking' },
            },
            returnAtNextEndStep: { tapped: true, under: 'owner' },
          },
        ],
      },
    ],
  } as unknown as CardInput;
}

describe('Mystifying Maze exact DSL', () => {
  it('parses, validates, and renders both printed abilities exactly', () => {
    const card = parseCard(mazeInput());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "{T}: Add {C}.\n{4}, {T}: Exile target attacking creature an opponent controls. At the beginning of the next end step, return it to the battlefield tapped under its owner's control.",
    );
  });

  it('keeps the delayed-return rider out of the model-facing schema', () => {
    const modelSchema = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    expect(modelSchema).not.toContain('returnAtNextEndStep');
    expect(() =>
      ModelEffectSchema.parse({
        kind: 'exileTarget',
        target: { kind: 'targetCreature' },
        returnAtNextEndStep: { tapped: true, under: 'owner' },
      }),
    ).toThrow();
  });

  it('refuses a delayed return on a scoped exile rather than guessing one referent', () => {
    const card = structuredClone(mazeInput()) as unknown as Card;
    const ability = card.kind === 'land' ? card.abilities[0] : undefined;
    if (ability?.kind !== 'activated') throw new Error('Maze fixture lost its activation');
    const effect = ability.effects[0];
    if (effect?.kind !== 'exileTarget') throw new Error('Maze fixture lost its exile');
    (effect as unknown as { scope: string }).scope = 'creaturesThatPlayerControls';
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_EFFECT_SCOPE',
        path: 'abilities[0].effects[0].returnAtNextEndStep',
        message: expect.stringContaining('one exiled card'),
      }),
    );
  });

  it('refuses a delayed return for a card targeted outside the battlefield', () => {
    const card = structuredClone(mazeInput()) as unknown as Card;
    const ability = card.kind === 'land' ? card.abilities[0] : undefined;
    if (ability?.kind !== 'activated') throw new Error('Maze fixture lost its activation');
    const effect = ability.effects[0];
    if (effect?.kind !== 'exileTarget') throw new Error('Maze fixture lost its exile');
    (effect as unknown as { target: unknown }).target = {
      kind: 'targetCardInAGraveyard',
      filter: { cardTypes: ['creature'] },
    };
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_EFFECT_SCOPE',
        path: 'abilities[0].effects[0].returnAtNextEndStep',
        message: expect.stringContaining('battlefield permanent'),
      }),
    );
  });
});
