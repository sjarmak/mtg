/** Installed-Forge parity for RTR Chromatic Lantern. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const LANTERN = parseCard({
  kind: 'artifact',
  id: 'rtr-226-chromatic-lantern-forge',
  name: 'Chromatic Lantern',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 226 },
  manaCost: { generic: 3 },
  subtypes: [],
  abilities: [
    {
      kind: 'static',
      scope: 'landsYouControl',
      subtype: null,
      modification: { kind: 'grantAnyColorManaAbility' },
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
    },
  ],
});

describe('RTR #226 Chromatic Lantern Forge export', () => {
  it('matches the installed script exactly', () => {
    expect(mustTranspile(LANTERN)).toBe(
      [
        'Name:Chromatic Lantern',
        'ManaCost:3',
        'Types:Artifact',
        'S:Mode$ Continuous | Affected$ Land.YouCtrl | AddAbility$ AnyMana | Description$ Lands you control have "{T}: Add one mana of any color."',
        'SVar:AnyMana:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1 | SpellDescription$ Add one mana of any color.',
        'A:AB$ Mana | Cost$ T | Produced$ Any | SpellDescription$ Add one mana of any color.',
        'Oracle:Lands you control have "{T}: Add one mana of any color."\\n{T}: Add one mana of any color.',
        '',
      ].join('\n'),
    );
  });
});
