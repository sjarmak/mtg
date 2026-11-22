/** Source-attested Forge parity for RTR Jarad, Golgari Lich Lord. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-174-jarad-forge',
  name: 'Jarad, Golgari Lich Lord',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 174 },
  manaCost: { B: 2, G: 2 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Zombie', 'Elf'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      printedSubjectReference: 'cardNameBeforeComma',
      modification: {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: {
          kind: 'countMatching',
          filter: { cardTypes: ['creature'] },
          whose: 'you',
          zone: 'controllerGraveyard',
        },
      },
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 1, B: 1, G: 1 },
        sacrificeMatching: {
          count: 1,
          excludeSource: true,
          filter: { cardTypes: ['creature'] },
        },
      },
      effects: [
        {
          kind: 'loseLife',
          amount: { kind: 'paidSacrificePower' },
          players: 'eachOpponent',
          target: { kind: 'noTarget' },
        },
      ],
    },
    {
      kind: 'activated',
      activationZone: 'graveyard',
      printedSourceReference: 'thisCard',
      cost: { mana: {}, sacrificeLandSubtypePair: ['Swamp', 'Forest'] },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
} as CardInput);

describe('RTR Jarad Forge export', () => {
  it('writes the installed graveyard count, paid-power, and two-land cost protocols', () => {
    const script = mustTranspile(CARD);
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ Static1Count | AddToughness$ Static1Count | Description$ CARDNAME gets +1/+1 for each creature card in your graveyard.',
    );
    expect(script).toContain('SVar:Static1Count:Count$Valid Graveyard Creature.YouOwn');
    expect(script).toContain(
      'A:AB$ LoseLife | Cost$ 1 B G Sac<1/Creature.Other/another creature> | Defined$ Player.Opponent | LifeAmount$ X',
    );
    expect(script).toContain('SVar:X:Sacrificed$CardPower');
    expect(script).toContain(
      'A:AB$ ChangeZone | Cost$ Sac<1/Swamp> Sac<1/Forest> | Origin$ Graveyard | Destination$ Hand | ActivationZone$ Graveyard',
    );
    expect(script).toContain(
      "Oracle:Jarad gets +1/+1 for each creature card in your graveyard.\\n{1}{B}{G}, Sacrifice another creature: Each opponent loses life equal to the sacrificed creature's power.\\nSacrifice a Swamp and a Forest: Return this card from your graveyard to your hand.",
    );
  });
});
