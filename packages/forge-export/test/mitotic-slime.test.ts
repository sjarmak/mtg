/** Forge parity for Mitotic Slime's card script and both linked token scripts. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileSet } from '@mtg/forge-export';

const MITOTIC_SLIME = parseCard({
  id: 'm11-185-mitotic-slime-forge',
  kind: 'creature',
  name: 'Mitotic Slime',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 185 },
  manaCost: { generic: 4, G: 1 },
  power: 4,
  toughness: 4,
  colors: ['G'],
  subtypes: ['Ooze'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'createToken',
          count: 2,
          token: {
            identity: 'mitotic-ooze-2-2',
            quoteAbilities: true,
            name: 'Ooze',
            power: 2,
            toughness: 2,
            colors: ['G'],
            subtypes: ['Ooze'],
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDies',
                effects: [
                  {
                    kind: 'createToken',
                    count: 2,
                    token: {
                      identity: 'mitotic-ooze-1-1',
                      name: 'Ooze',
                      power: 1,
                      toughness: 1,
                      colors: ['G'],
                      subtypes: ['Ooze'],
                    },
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

describe('Mitotic Slime Forge export', () => {
  /**
   * Sources: Card-Forge/forge current `cardsfolder/m/mitotic_slime.txt` and
   * `tokenscripts/g_2_2_ooze_mitotic.txt`; both use a ChangesZone trigger whose
   * body is a linked Token script.
   */
  it('emits the card and both generations of linked token scripts', () => {
    const result = transpileSet([MITOTIC_SLIME], { name: 'Magic 2011', date: '2010-07-16' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.scripts[0]?.text).toBe(
      [
        'Name:Mitotic Slime',
        'ManaCost:4 G',
        'Types:Creature Ooze',
        'PT:4/4',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME dies, create two 2/2 green Ooze creature tokens. They have "When this token dies, create two 1/1 green Ooze creature tokens."',
        'SVar:Trig1Effect1:DB$ Token | TokenAmount$ 2 | TokenScript$ g_2_2_ooze | TokenOwner$ You',
        'DeckHas:Ability$Token',
        'Oracle:When Mitotic Slime dies, create two 2/2 green Ooze creature tokens. They have "When this token dies, create two 1/1 green Ooze creature tokens."',
        '',
      ].join('\n'),
    );

    expect(result.value.tokens.map((file) => file.path)).toEqual([
      'tokens/g_2_2_ooze.txt',
      'tokens/g_1_1_ooze.txt',
    ]);
    expect(result.value.tokens[0]?.contents).toBe(
      [
        'Name:Ooze Token',
        'ManaCost:no cost',
        'Colors:green',
        'Types:Creature Ooze',
        'PT:2/2',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When this token dies, create two 1/1 green Ooze creature tokens.',
        'SVar:Trig1Effect1:DB$ Token | TokenAmount$ 2 | TokenScript$ g_1_1_ooze | TokenOwner$ You',
        'Oracle:When this token dies, create two 1/1 green Ooze creature tokens.',
        '',
      ].join('\n'),
    );
    expect(result.value.tokens[1]?.contents).toBe(
      [
        'Name:Ooze Token',
        'ManaCost:no cost',
        'Colors:green',
        'Types:Creature Ooze',
        'PT:1/1',
        'Oracle:',
        '',
      ].join('\n'),
    );
  });
});
