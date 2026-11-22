/** Forge parity for a subtype-filtered trigger whose source functions in its owner's graveyard. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Veilborn Ghoul Forge export', () => {
  it('emits the land filter, graveyard trigger zone, optional decider, and exact source return', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-114-veilborn-ghoul-forge',
      name: 'Veilborn Ghoul',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 114 },
      manaCost: { generic: 4, B: 1 },
      colors: ['B'],
      subtypes: ['Zombie'],
      power: 4,
      toughness: 1,
      abilities: [
        { kind: 'static', scope: 'self', modification: { kind: 'cantBlock' } },
        {
          kind: 'triggered',
          condition: 'controlledLandSubtypeEnters',
          landSubtype: 'Swamp',
          triggerZone: 'graveyard',
          optional: true,
          effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
        },
      ],
    });

    const script = mustTranspile(card);
    expect(script).toContain('S:Mode$ CantBlock | ValidCard$ Card.Self');
    expect(script).toContain('ValidCard$ Swamp.YouCtrl');
    expect(script).toContain('TriggerZones$ Graveyard');
    expect(script).toContain('OptionalDecider$ You');
    expect(script).toContain(
      'TriggerDescription$ Whenever a Swamp you control enters, you may return CARDNAME from your graveyard to your hand.',
    );
    expect(script).toContain('SVar:Trig2Effect1:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand');
    expect(script).not.toContain('Defined$ TriggeredCard');
  });
});
