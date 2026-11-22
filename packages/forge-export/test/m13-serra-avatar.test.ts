import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const UPSTREAM_SERRA_AVATAR = `Name:Serra Avatar
ManaCost:4 W W W
Types:Creature Avatar
PT:*/*
S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ X | Description$ CARDNAME's power and toughness are each equal to your life total.
SVar:X:Count$YourLifeTotal
T:Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigShuffle | TriggerDescription$ When CARDNAME is put into a graveyard from anywhere, shuffle it into its owner's library.
SVar:TrigShuffle:DB$ ChangeZone | Origin$ Graveyard | Destination$ Library | Shuffle$ True | Defined$ TriggeredCardLKICopy
Oracle:Serra Avatar's power and toughness are each equal to your life total.\\nWhen Serra Avatar is put into a graveyard from anywhere, shuffle it into its owner's library.
`;

const GENERATED_SERRA_AVATAR = `Name:Serra Avatar
ManaCost:4 W W W
Types:Creature Avatar
PT:*/*
S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ X | Description$ CARDNAME's power and toughness are each equal to your life total.
SVar:X:Count$YourLifeTotal
T:Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME is put into a graveyard from anywhere, shuffle it into its owner's library.
SVar:Trig1Effect1:DB$ ChangeZone | Origin$ Graveyard | Destination$ Library | Shuffle$ True | Defined$ TriggeredCardLKICopy
Oracle:Serra Avatar's power and toughness are each equal to your life total.\\nWhen Serra Avatar is put into a graveyard from anywhere, shuffle it into its owner's library.
`;

describe('M13 Serra Avatar Forge export', () => {
  it('matches the pinned upstream characteristic and graveyard script exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-32-serra-avatar-forge',
      name: 'Serra Avatar',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 32 },
      manaCost: { generic: 4, W: 3 },
      colors: ['W'],
      subtypes: ['Avatar'],
      power: 0,
      toughness: 0,
      characteristicPowerToughness: { kind: 'controllerLifeTotal' },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfPutIntoGraveyardFromAnywhere',
          effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
        },
      ],
    } satisfies CardInput);

    const generated = mustTranspile(card);
    expect(generated).toBe(GENERATED_SERRA_AVATAR);
    expect(UPSTREAM_SERRA_AVATAR).toContain(
      'Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self',
    );
    expect(generated).toContain(
      'Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self',
    );
    expect(UPSTREAM_SERRA_AVATAR).toContain(
      'Origin$ Graveyard | Destination$ Library | Shuffle$ True | Defined$ TriggeredCardLKICopy',
    );
    expect(generated).toContain(
      'Origin$ Graveyard | Destination$ Library | Shuffle$ True | Defined$ TriggeredCardLKICopy',
    );
  });
});
