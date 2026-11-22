/** Sublime Archangel against Forge's checked-in M13 card script. */
import { exaltedAbility, parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SUBLIME_ARCHANGEL = parseCard({
  kind: 'creature',
  id: 'm13-sublime-archangel',
  name: 'Sublime Archangel',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 36 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [
    exaltedAbility(),
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: null,
      modification: { kind: 'grantTriggeredAbility', ability: exaltedAbility() },
    },
  ],
  power: 4,
  toughness: 3,
});

describe('Sublime Archangel in Forge', () => {
  it('writes the exact upstream native Exalted grant', () => {
    const script = mustTranspile(SUBLIME_ARCHANGEL);
    expect(script).toContain('K:Flying\nK:Exalted\n');
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl | AddKeyword$ Exalted | Description$ Other creatures you control have Exalted.',
    );
    expect(script).toContain(
      'Oracle:Flying\\nExalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\\nOther creatures you control have exalted. (If a creature has multiple instances of exalted, each triggers separately.)\n',
    );
  });

  it('does not add unrelated reminder text merely because a card grants exalted', () => {
    const defender = parseCard({
      kind: 'creature',
      id: 'exalted-defender',
      name: 'Exalted Defender',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      subtypes: ['Wall'],
      keywordAbilities: [{ kind: 'defender' }],
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: null,
          modification: { kind: 'grantTriggeredAbility', ability: exaltedAbility() },
        },
      ],
      power: 0,
      toughness: 4,
    });

    const script = mustTranspile(defender);
    expect(script).toContain('Oracle:Defender\\nOther creatures you control have exalted.');
    expect(script).not.toContain("Defender (This creature can't attack.)");
  });
});
