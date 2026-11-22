import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

it('uses a structural boundary for one mandatory card exiled from a revealed opposing hand', () => {
  const contractStart = bridge.indexOf('boolean reviewedTargetedRevealedHandExile =');
  const contractEnd = bridge.indexOf('boolean reviewedKarnHandExile =', contractStart);
  const runtimeContract = bridge.slice(contractStart, contractEnd);
  expect(bridge).toContain('isReviewedTargetedRevealedHandExile');
  expect(bridge).toContain('reviewedTargetedRevealedHandExile');
  expect(bridge).toContain('root.getApi() == ApiType.RevealHand');
  expect(bridge).toContain('"Targeted".equals(root.getParam("Defined"))');
  expect(bridge).toContain('"True".equals(root.getParam("IsCurse"))');
  expect(runtimeContract).toContain('origin.equals(List.of(ZoneType.Hand))');
  expect(runtimeContract).toContain('destination == ZoneType.Exile');
  expect(bridge).toContain('revealedHandRoot.getTargets().contains(revealedPlayer)');
  expect(bridge).toMatch(/reviewedTargetedRevealedHandExile\s*\? withReveal\(/u);
  expect(runtimeContract).toContain('&& !card.isLand()');
  expect(bridge).not.toContain('boolean reviewedNightTerrors =');
});
