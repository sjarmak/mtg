/** Installed Forge 2.0.14 parity for RTR Wild Beastmaster. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-139-wild-beastmaster-forge',
  name: 'Wild Beastmaster',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 139 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  subtypes: ['Human', 'Shaman'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: { kind: 'triggeringCreaturePower' },
          toughness: { kind: 'triggeringCreaturePower' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          excludeReferent: true,
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

describe('RTR #139 Wild Beastmaster Forge export', () => {
  const script = mustTranspile(CARD);

  it('matches the installed self-attack trigger and strictly-other PumpAll profile', () => {
    expect(script).toContain(
      "T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigPump | TriggerDescription$ Whenever CARDNAME attacks, each other creature you control gets +X/+X until end of turn, where X is CARDNAME's power.",
    );
    expect(script).toContain(
      'SVar:TrigPump:DB$ PumpAll | ValidCards$ Creature.YouCtrl+StrictlyOther | NumAtt$ +X | NumDef$ +X',
    );
    expect(script).toContain('SVar:X:Count$CardPower');
  });

  it('does not leak the generic event-retained creature spelling into the exact card profile', () => {
    expect(script).not.toContain('TriggeredCreaturePower');
    expect(script).not.toContain('TriggeredCard$CardPower');
  });
});
