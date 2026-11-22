/** Exact refusal boundary for Careful Consideration's targeted discard callback. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Careful Consideration's exact discard", () => {
  it('pins the targeted draw-four root and its phase-dependent discard child', () => {
    expect(bridge).toContain('isReviewedCarefulConsiderationDiscard');
    expect(bridge).toContain('"Careful Consideration".equals(source.getName())');
    expect(bridge).toContain('source.isInstant()');
    expect(bridge).toContain('"4".equals(parent.getParam("NumCards"))');
    expect(bridge).toContain('"Player".equals(parent.getParam("ValidTgts"))');
    expect(bridge).toContain('"Targeted".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"X".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"Count$IfCastInOwnMainPhase.2.3".equals(source.getSVar("X"))');
  });

  it('lets only the targeted local player choose exactly the resolved two or three cards', () => {
    expect(bridge).toContain('boolean reviewedCareful =');
    expect(bridge).toContain('parent.getTargets().contains(discardingPlayer)');
    expect(bridge).toContain('discardingPlayer == player');
    expect(bridge).toContain('min == max && (min == 2 || min == 3)');
    // This test owns reviewedCareful's membership in the single-player exemption, not the
    // exemption's fixed activating-player fallback; a later set can add its own reviewed
    // guard between the two.
    expect(bridge).toMatch(
      /reviewedCareful\s*(?:\|\|\s*\w+\s*)*\|\|\s*ability\.getActivatingPlayer\(\) == player/u,
    );
    // The required-count disjunction names four cards today; a later set can add its own
    // reviewed guard between any two of them.
    expect(bridge).toMatch(
      /reviewedSeasoned\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedPrismari\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedMarket\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedCareful/u,
    );
  });
});
