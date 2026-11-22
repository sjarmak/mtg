import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PSYCHIC_SPIRAL_INPUT = {
  kind: 'instant',
  id: 'rtr-47-psychic-spiral-forge',
  name: 'Psychic Spiral',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 47 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [
    { kind: 'shuffleGraveyardIntoLibrary', printedAllCardsFromYourGraveyard: true },
    {
      kind: 'millCards',
      count: { kind: 'cardsShuffledFromGraveyardThisResolution' },
      target: { kind: 'targetPlayer' },
    },
  ],
} as const;

describe('RTR #47 Psychic Spiral Forge export', () => {
  it('exports the installed Forge remembered shuffle-back and linked mill exactly', () => {
    expect(mustTranspile(parseCard(PSYCHIC_SPIRAL_INPUT))).toBe(
      [
        'Name:Psychic Spiral',
        'ManaCost:4 U',
        'Types:Instant',
        'A:SP$ ChangeZoneAll | ChangeType$ Card.YouOwn | Origin$ Graveyard | Destination$ Library | Shuffle$ True | RememberChanged$ True | SubAbility$ DBEffect1 | SpellDescription$ Shuffle all cards from your graveyard into your library. Target player mills that many cards.',
        'SVar:DBEffect1:DB$ Mill | ValidTgts$ Player | NumCards$ X | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True',
        'SVar:X:Remembered$Amount',
        'Oracle:Shuffle all cards from your graveyard into your library. Target player mills that many cards.',
        '',
      ].join('\n'),
    );
  });
});
