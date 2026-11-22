import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns Worldwake decision boundaries', () => {
  it("pins Mire's Toll to its exact targeted revealed-hand discard", () => {
    expect(bridge).toContain('isReviewedMiresTollDiscard');
    expect(bridge).toContain('"Mire\'s Toll".equals(source.getName())');
    expect(bridge).toContain('"RevealYouChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('"X".equals(ability.getParam("RevealNumber"))');
    expect(bridge).toContain('"Count$Valid Swamp.YouCtrl".equals(source.getSVar("X"))');
    expect(bridge).toContain('ability.getTargets().getFirstTargetedPlayer()');
  });

  it('pins Razor Boomerang to its exact unattach cost and selected equipment', () => {
    expect(bridge).toContain('import forge.game.cost.CostUnattach;');
    expect(bridge).toContain('isReviewedRazorBoomerangUnattachCost');
    expect(bridge).toContain('"Razor Boomerang".equals(candidate.getName())');
    expect(bridge).toContain('candidate.isAttachedToEntity(ability.getHostCard())');
    expect(bridge).toContain('return PaymentDecision.card(candidate);');
  });

  it('versions both widened callback boundaries', () => {
    expect(bridge).toContain('outside reviewed-singleton-discard-v4');
    expect(bridge).not.toContain('outside reviewed-singleton-discard-v3');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
    expect(bridge).not.toContain('outside chosen-cost-payment-v24');
  });
});
