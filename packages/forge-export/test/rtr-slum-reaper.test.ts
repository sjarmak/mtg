/** Source-attested Forge parity for RTR #77's each-player creature sacrifice. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-077',
  name: 'Slum Reaper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 77 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Horror'],
  power: 4,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'sacrificePermanent', players: 'eachPlayer', target: { kind: 'noTarget' } }],
    },
  ],
});

describe('RTR Slum Reaper Forge parity', () => {
  it('exports the current upstream trigger and Sacrifice definition', () => {
    const script = mustTranspile(CARD);

    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self',
    );
    expect(script).toContain('DB$ Sacrifice | Defined$ Player | SacValid$ Creature');
    expect(script).not.toContain('ValidTgts$ Player');
  });
});
