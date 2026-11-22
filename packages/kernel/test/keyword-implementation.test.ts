import { describe, expect, it } from 'vitest';
import { KEYWORDS } from '@mtg/dsl';
import { KERNEL_KEYWORD_IMPLEMENTATIONS } from '@mtg/kernel';

describe('kernel keyword implementation coverage', () => {
  it('classifies every DSL keyword against the subsystem that executes it', () => {
    expect(Object.keys(KERNEL_KEYWORD_IMPLEMENTATIONS)).toEqual([...KEYWORDS]);
    expect(KERNEL_KEYWORD_IMPLEMENTATIONS).toEqual({
      flying: { kind: 'implemented', subsystems: ['block-legality'] },
      vigilance: { kind: 'implemented', subsystems: ['attack-declaration'] },
      haste: { kind: 'implemented', subsystems: ['attack-legality', 'tap-cost-legality'] },
      trample: { kind: 'implemented', subsystems: ['combat-damage-assignment'] },
      deathtouch: {
        kind: 'implemented',
        subsystems: ['damage-marking', 'state-based-actions'],
      },
      lifelink: { kind: 'implemented', subsystems: ['damage-resolution'] },
      menace: { kind: 'implemented', subsystems: ['block-legality'] },
      reach: { kind: 'implemented', subsystems: ['block-legality'] },
      firstStrike: { kind: 'implemented', subsystems: ['combat-damage-steps'] },
    });
  });
});
