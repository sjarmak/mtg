import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact optional-copy replacement boundary', () => {
  it('keeps replacement confirmation and Forge-derived entity selection human-routed', () => {
    expect(bridge).toContain('confirmReplacementEffect');
    expect(bridge).toContain('chooseSingleEntityForEffect');
    expect(bridge).toContain('"confirm-replacement"');
    expect(bridge).toContain('"entity-selection"');
    expect(bridge).toContain('if (submittedRevision != revision) return "stale Forge session revision"');
    expect(bridge).toContain('if (!offered) return "Forge did not offer move " + moveId');
  });

  it('admits a mono-color Phyrexian spell cost to the reviewed life-or-blue payment seam', () => {
    expect(bridge).toContain('isReviewedPhyrexianManaCost');
    expect(bridge).toContain('"mana-payment-phyrexian-life"');
    expect(bridge).toContain('"mana-payment-cancel"');
    expect(bridge).toContain('selected Phyrexian payment became illegal');
  });
});
