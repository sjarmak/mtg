/** Installed-Forge parity for RTR Avenging Arrow's damage-history target. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'instant',
  id: 'rtr-4-avenging-arrow-forge',
  name: 'Avenging Arrow',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 4 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { dealtDamageThisTurn: true } },
    },
  ],
});

describe('RTR Avenging Arrow Forge export', () => {
  it('matches the installed dealtDamageThisTurn selector and prompt', () => {
    expect(mustTranspile(CARD).split('\n')).toContain(
      'A:SP$ Destroy | ValidTgts$ Creature.dealtDamageThisTurn | TgtPrompt$ Select target creature that dealt damage this turn. | SpellDescription$ Destroy target creature that dealt damage this turn.',
    );
  });
});
