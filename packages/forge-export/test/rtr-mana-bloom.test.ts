/** Mana Bloom against Forge's installed card script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { MANA_BLOOM } from '../../dsl/test/rtr-mana-bloom.test';
import { mustTranspile } from './helpers';

describe('Mana Bloom in Forge', () => {
  it('exports the installed charge, limit, and zero-counter trigger spellings', () => {
    const script = mustTranspile(parseCard(MANA_BLOOM));
    expect(script).toContain('K:etbCounter:CHARGE:X');
    expect(script).toContain(
      'A:AB$ Mana | Cost$ SubCounter<1/CHARGE> | Produced$ Any | Amount$ 1 | ActivationLimit$ 1',
    );
    expect(script).toContain(
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | CheckSVar$ NoCharge | SVarCompare$ EQ0',
    );
    expect(script).toContain('SVar:NoCharge:Count$CardCounters.CHARGE');
  });
});
