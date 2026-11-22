/** Gaea's Revenge against Forge's current checked-in card script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe("Gaea's Revenge Forge export", () => {
  it('emits the source-attested CantTarget static exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm11-174-gaeas-revenge-forge',
      name: "Gaea's Revenge",
      rarity: 'mythic',
      set: { code: 'M11', collectorNumber: 174 },
      manaCost: { generic: 5, G: 2 },
      colors: ['G'],
      subtypes: ['Elemental'],
      power: 8,
      toughness: 5,
      keywords: ['haste'],
      cannotBeCountered: true,
      targetingRestrictions: [{ kind: 'sourceLacksColor', color: 'G' }],
    });

    expect(mustTranspile(card)).toBe(
      [
        "Name:Gaea's Revenge",
        'ManaCost:5 G G',
        'Types:Creature Elemental',
        'PT:8/5',
        "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
        'K:Haste',
        "S:Mode$ CantTarget | ValidTarget$ Card.Self | ValidSource$ Card.nonGreen | Description$ CARDNAME can't be the target of nongreen spells or abilities from nongreen sources.",
        "Oracle:This spell can't be countered.\\nHaste\\nThis creature can't be the target of nongreen spells or abilities from nongreen sources.",
        '',
      ].join('\n'),
    );
  });
});
