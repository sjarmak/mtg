/** Installed-Forge parity for Angel of Serenity's remembered mixed-zone targets. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const ANGEL_OF_SERENITY = {
  kind: 'creature',
  id: 'rtr-1-angel-of-serenity-forge',
  name: 'Angel of Serenity',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 1 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetPermanent',
            filter: { cardTypes: ['creature'] },
            excludeSource: true,
            count: 3,
          },
          linkToSource: true,
          creatureBattlefieldOrGraveyard: true,
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand', plural: true }],
    },
  ],
} as const;

describe('Angel of Serenity Forge export', () => {
  it('matches the installed ChangeZone/Remembered/Cleanup script', () => {
    const script = mustTranspile(parseCard(ANGEL_OF_SERENITY));
    expect(script).toContain(
      'SVar:TrigExile:DB$ ChangeZone | TargetMin$ 0 | TargetMax$ 3 | IsCurse$ True | ValidTgts$ Creature.Other | TgtPrompt$ Choose another target creature | RememberChanged$ True | Origin$ Battlefield,Graveyard | Destination$ Exile',
    );
    expect(script).toContain(
      'SVar:TrigReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Hand | SubAbility$ DBCleanup',
    );
    expect(script).toContain('SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True');
  });
});
