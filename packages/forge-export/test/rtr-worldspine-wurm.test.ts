import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const WORLDSPINE_WURM = parseCard({
  kind: 'creature',
  id: 'rtr-140-worldspine-wurm-forge',
  name: 'Worldspine Wurm',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 140 },
  manaCost: { generic: 8, G: 3 },
  colors: ['G'],
  subtypes: ['Wurm'],
  power: 15,
  toughness: 15,
  keywords: ['trample'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            name: 'Wurm',
            power: 5,
            toughness: 5,
            colors: ['G'],
            subtypes: ['Wurm'],
            keywords: ['trample'],
          },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromAnywhere',
      effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
    },
  ],
} satisfies CardInput);

describe('RTR #140 Worldspine Wurm Forge export', () => {
  it('faithfully exports both current upstream graveyard triggers', () => {
    expect(mustTranspile(WORLDSPINE_WURM)).toBe(
      [
        'Name:Worldspine Wurm',
        'ManaCost:8 G G G',
        'Types:Creature Wurm',
        'PT:15/15',
        'K:Trample',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When this creature dies, create three 5/5 green Wurm creature tokens with trample.',
        'SVar:Trig1Effect1:DB$ Token | TokenAmount$ 3 | TokenScript$ g_5_5_wurm_trample | TokenOwner$ You',
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig2Effect1 | TriggerDescription$ When CARDNAME is put into a graveyard from anywhere, shuffle it into its owner's library.",
        'SVar:Trig2Effect1:DB$ ChangeZone | Origin$ Graveyard | Destination$ Library | Shuffle$ True | Defined$ TriggeredCardLKICopy',
        'DeckHas:Ability$Token',
        "Oracle:Trample\\nWhen this creature dies, create three 5/5 green Wurm creature tokens with trample.\\nWhen Worldspine Wurm is put into a graveyard from anywhere, shuffle it into its owner's library.",
        '',
      ].join('\n'),
    );
  });
});
