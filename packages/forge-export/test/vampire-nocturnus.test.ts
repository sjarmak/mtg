/** Forge master parity for Vampire Nocturnus's two continuous abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'm13-113-vampire-nocturnus-forge',
  name: 'Vampire Nocturnus',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 113 },
  colors: ['B'],
  manaCost: { generic: 1, B: 3 },
  power: 3,
  toughness: 3,
  subtypes: ['Vampire'],
  keywords: [],
  abilities: [
    { kind: 'staticPlayerRule', players: 'controller', rule: 'playWithTopLibraryRevealed' },
    {
      kind: 'staticBundle',
      scope: 'otherCreaturesYouControl',
      subtype: 'Vampire',
      includeSelf: true,
      enabledWhile: { kind: 'controllerTopLibraryHasColor', color: 'B' },
      modifications: [
        { kind: 'statBonus', power: 2, toughness: 1 },
        { kind: 'grantKeyword', keyword: 'flying' },
      ],
    },
  ],
});

describe('Vampire Nocturnus Forge parity', () => {
  it('matches Forge master continuous reveal and TopCardOfLibraryIs grammar', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toEqual(
      expect.arrayContaining([
        'S:Mode$ Continuous | Affected$ Card.TopLibrary+YouCtrl | AffectedZone$ Library | MayLookAt$ Player | Description$ Play with the top card of your library revealed.',
        'S:Mode$ Continuous | Affected$ Creature.Vampire+Other+YouCtrl,Card.Self | AddPower$ 2 | AddToughness$ 1 | AddKeyword$ Flying | TopCardOfLibraryIs$ Card.Black | Description$ As long as the top card of your library is black, CARDNAME and other Vampire creatures you control get +2/+1 and have flying.',
      ]),
    );
  });
});
