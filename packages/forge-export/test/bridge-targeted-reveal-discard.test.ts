import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

it('uses one structural revealed-hand discard boundary across card names and fixed costs', () => {
  expect(bridge).toContain('isReviewedTargetedRevealDiscard');
  expect(bridge).toContain('reviewedTargetedRevealDiscard');
  expect(bridge).toContain('discardingPlayer.isOpponentOf(player)');
  expect(bridge).toContain('ability.getTargets().contains(discardingPlayer)');
  expect(bridge).not.toContain('boolean reviewedLayBare =');
});
