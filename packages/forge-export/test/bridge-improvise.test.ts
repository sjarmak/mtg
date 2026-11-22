/** Static refusal boundary for the exact Improvise cohort. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact reviewed Improvise route', () => {
  it('admits plain Improvise structurally and refuses it paired with Convoke, Delve or Assist', () => {
    expect(bridge).toContain('isReviewedImproviseAbility');
    expect(bridge).toContain('!source.hasKeyword(Keyword.CONVOKE)');
    expect(bridge).toContain(
      'session.isReviewedImproviseAbility(ability) && artifacts && !creatures && maxReduction == null',
    );
  });

  it('names the card and the shape when a Convoke or Improvise callback is refused', () => {
    expect(bridge).toContain('Forge reached Convoke or Improvise outside its exact reviewed profile (');
    expect(bridge).toContain(
      'BridgeSession.describeConvokeShape(ability, artifacts, creatures, maxReduction)',
    );
  });

  it('pays every tapped artifact the colorless shard, never a color choice', () => {
    expect(bridge).toContain('chooseImprovisePayments');
    expect(bridge).toContain('canPayViaImprovise');
    expect(bridge).toContain('remaining.payManaViaConvoke(MagicColor.COLORLESS)');
    expect(bridge).toContain('"improvise-payment"');
    expect(bridge).toContain('"improvise-payment-done"');
  });
});
