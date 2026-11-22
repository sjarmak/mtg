/** Forge parity for M13 #71, pinned to Forge's shipped Switcheroo script. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SWITCHEROO = parseCard({
  kind: 'sorcery',
  id: 'm13-switcheroo',
  name: 'Switcheroo',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 71 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'exchangeControl', target: { kind: 'targetCreature', count: 2, minimum: 2 } }],
} as CardInput);

describe('Switcheroo Forge export', () => {
  it('writes Forge native ExchangeControl with exactly two creature targets', () => {
    const script = mustTranspile(SWITCHEROO);

    expect(script).toContain(
      'A:SP$ ExchangeControl | ValidTgts$ Creature | TargetMin$ 2 | TargetMax$ 2 | SpellDescription$ Exchange control of two target creatures.',
    );
  });
});
