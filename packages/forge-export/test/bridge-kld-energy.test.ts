import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

/** The witnesses that these guards actually let Forge finish are in observed-kld-energy.integration.test.ts. */
describe('the Forge bridge lets a player pay {E}', () => {
  it('treats an Energy cost part as decision-free, since the amount is fixed and nothing is chosen', () => {
    const block = /private static boolean isDecisionFree\(CostPart part\) \{([\s\S]*?)\n {8}\}/u.exec(bridge);
    if (block === null) throw new Error('isDecisionFree moved');
    expect(block[1]).toContain('type == CostPayEnergy.class');
  });

  it('pays an unless-cost or optional {E} only for the one player who owns it, after asking them', () => {
    expect(bridge).toContain('boolean reviewedEnergyPayment = exactPayer && part instanceof CostPayEnergy;');
    // Energy and Fabricate are two exemptions from the optional-payment refusal; every later
    // set narrows the refusal further with its own && !reviewedX, before or after them.
    expect(bridge).toMatch(
      /&&\s*!reviewedEnergyPayment\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedFabricateCounters\s*(?:&&\s*!\w+\s*)*\) \{\s*throw new IllegalStateException\(\s*"Forge reached an optional payment outside reviewed-prevent-effect-payment-v1"/u,
    );
    // The confirm-before-paying exemption list; a later set's own paid cost is added to it.
    expect(bridge).toMatch(
      /\(scopedAkhHouPayment\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedHandRevealCost\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedEnergyPayment\s*(?:\|\|\s*\w+\s*)*\)\s*(?:&&\s*!?[\w.]+(?:\([^()]*\))?\s*)*&&\s*!confirmPayment\(player, part, "Pay " \+ cost \+ "\?", ability\)/u,
    );
  });
});
