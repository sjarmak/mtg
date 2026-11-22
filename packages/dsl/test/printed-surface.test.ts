/**
 * One structural walk for everything a card prints on its own account.
 *
 * The token layers are a token the card creates and the abilities printed on
 * it, followed by the one finite child-token tier admitted for Mitotic Slime.
 * The leaf token's effect schema excludes `createToken`, so a parsed card
 * cannot declare a third token generation.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, printedCardSurface } from '@mtg/dsl';

describe('printedCardSurface', () => {
  it('walks card effects, created tokens, and token abilities exactly once', () => {
    const card = parseCard({
      id: 'tst-surface',
      kind: 'creature',
      name: 'Recruit',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2 },
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Recruit',
                colors: [],
                subtypes: ['Part'],
                keywords: [],
                abilities: [
                  {
                    kind: 'activated',
                    cost: { mana: { generic: 1 }, sacrificeSelf: true },
                    effects: [
                      {
                        kind: 'putCounters',
                        counter: 'hide',
                        count: 1,
                        target: { kind: 'targetCreatureYouControl' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const surface = printedCardSurface(card);
    expect(surface.cardEffects.map((effect) => effect.kind)).toEqual(['createToken']);
    expect(surface.tokens.map((token) => token.name)).toEqual(['Recruit']);
    expect(surface.tokenAbilities.map((ability) => ability.kind)).toEqual(['activated']);
    expect(surface.abilities.map((ability) => ability.kind)).toEqual(['triggered', 'activated']);
    expect(surface.effects.map((effect) => effect.kind)).toEqual(['createToken', 'putCounters']);
  });

  it('includes the rules printed on a transforming Battle back face', () => {
    const card = parseCard({
      id: 'tst-surface-siege',
      kind: 'battle',
      name: 'Invasion of Surfaces',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 3, W: 1 },
      colors: ['W'],
      subtypes: ['Siege'],
      defense: 4,
      backFace: {
        kind: 'creature',
        name: 'Surface Victor',
        colors: ['W'],
        subtypes: ['Knight'],
        power: 4,
        toughness: 4,
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
          },
        ],
      },
    });

    const surface = printedCardSurface(card);
    expect(surface.cardEffects.map((effect) => effect.kind)).toEqual(['gainLife']);
    expect(surface.abilities.map((ability) => ability.kind)).toEqual(['triggered']);
    expect(surface.effects.map((effect) => effect.kind)).toEqual(['gainLife']);
  });
});
