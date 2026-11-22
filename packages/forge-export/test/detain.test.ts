/** Forge parity for the reusable Detain effect and both RTR target shapes. */
import { describe, expect, it } from 'vitest';
import { transpileCard } from '@mtg/forge-export';
import { spell } from './helpers';

describe('Detain Forge parity', () => {
  it('exports Forge master’s native Detain API for a creature', () => {
    const result = transpileCard(
      spell('Inaction Injunction', [
        { kind: 'detainPermanent', target: { kind: 'targetCreatureOpponentControls' } },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('A:SP$ Detain | ValidTgts$ Creature.OppCtrl');
  });

  it('preserves the optional two-target nonland-permanent bounds', () => {
    const result = transpileCard(
      spell('Archon Detain Probe', [
        {
          kind: 'detainPermanent',
          target: { kind: 'targetNonlandPermanentOpponentControls', count: 2 },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:SP$ Detain | ValidTgts$ Permanent.nonLand+OppCtrl | TargetMin$ 0 | TargetMax$ 2',
    );
  });
});
