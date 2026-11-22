/** Source-attested Forge parity for M11 Wall of Frost. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Wall of Frost Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm11-079-wall-of-frost-forge',
      name: 'Wall of Frost',
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 79 },
      manaCost: { generic: 1, U: 2 },
      colors: ['U'],
      subtypes: ['Wall'],
      power: 0,
      toughness: 7,
      keywords: [],
      keywordAbilities: [{ kind: 'defender' }],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfBlocksCreature',
          effects: [{ kind: 'skipNextUntap', target: { kind: 'triggeringCreature' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Wall of Frost',
        'ManaCost:1 U U',
        'Types:Creature Wall',
        'PT:0/7',
        'K:Defender',
        "T:Mode$ AttackerBlocked | ValidBlocker$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ Whenever CARDNAME blocks a creature, that creature doesn't untap during its controller's next untap step.",
        "SVar:Trig1Effect1:DB$ Pump | Defined$ TriggeredAttackerLKICopy | KW$ HIDDEN This card doesn't untap during your next untap step. | Duration$ Permanent",
        'SVar:HasBlockEffect:TRUE',
        "Oracle:Defender\\nWhenever Wall of Frost blocks a creature, that creature doesn't untap during its controller's next untap step.",
        '',
      ].join('\n'),
    );
  });
});
