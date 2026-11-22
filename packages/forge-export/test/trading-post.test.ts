/** All four source-attested Forge lines for M13 Trading Post. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Trading Post Forge parity', () => {
  it('exports four independent activated abilities with their exact costs and zones', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm13-220-forge',
      name: 'Trading Post',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 220 },
      colors: [],
      manaCost: { generic: 4 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, tapSelf: true, discard: 1 },
          effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
        },
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, tapSelf: true, payLife: 1 },
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Goat',
                power: 0,
                toughness: 1,
                colors: ['W'],
                subtypes: ['Goat'],
                keywords: [],
              },
            },
          ],
        },
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
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1 },
            tapSelf: true,
            sacrificeMatching: { count: 1, filter: { cardTypes: ['artifact'] } },
          },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ],
    } as CardInput);

    const lines = mustTranspile(card)
      .split('\n')
      .filter((line) => line.startsWith('A:'));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('AB$ GainLife | Cost$ 1 T Discard<1/Card>');
    expect(lines[1]).toContain('AB$ Token | Cost$ 1 T PayLife<1>');
    expect(lines[2]).toContain(
      'AB$ ChangeZone | Cost$ 1 T Sac<1/Creature> | ValidTgts$ Artifact.YouCtrl | Origin$ Graveyard | Destination$ Hand',
    );
    expect(lines[3]).toContain('AB$ Draw | Cost$ 1 T Sac<1/Artifact> | Defined$ You | NumCards$ 1');
  });
});
