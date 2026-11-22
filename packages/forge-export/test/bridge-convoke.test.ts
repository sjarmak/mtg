/** Static refusal boundary for the exact Convoke cohorts. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact reviewed Convoke route', () => {
  it('admits plain Convoke structurally and pins only the Convoke-plus-Delve composition by name', () => {
    expect(bridge).toContain('isReviewedConvokeAbility');
    expect(bridge).toContain('"Hogaak, Arisen Necropolis".equals(source.getName())');
    expect(bridge).toContain('source.hasKeyword(Keyword.DELVE)');
    expect(bridge).toContain('"None".equals(root.getParam("ManaRestriction"))');
    expect(bridge).toContain('!source.hasKeyword(Keyword.IMPROVISE)');
    expect(bridge).toContain('!source.hasKeyword(Keyword.ASSIST)');
    expect(bridge).toContain(
      'session.isReviewedConvokeAbility(ability) && !artifacts && creatures && maxReduction == null',
    );
  });

  it('names the card and the shape when a Convoke or Improvise callback is refused', () => {
    expect(bridge).toContain('Forge reached Convoke or Improvise outside its exact reviewed profile (');
    expect(bridge).toContain(
      'BridgeSession.describeConvokeShape(ability, artifacts, creatures, maxReduction)',
    );
    expect(bridge).toContain('"card=" + (source == null ? null : source.getName())');
  });

  it('puts the payment distribution on the wire and preserves Forge shard selection', () => {
    expect(bridge).toContain(
      'return ComputerUtilMana.getConvokeOrImproviseFromList(cost, candidates, false, true);',
    );
    expect(bridge).toContain('chooseConvokePayments');
    expect(bridge).toContain('new ManaCostBeingPaid(cost)');
    expect(bridge).toContain('remaining.payManaViaConvoke(chosenColor)');
    expect(bridge).toContain('"convoke-payment"');
    expect(bridge).toContain('"convoke-payment-done"');
    expect(bridge).toContain(
      'if (choices.isEmpty()) break;\n                choices.add(new Choice(\n                        "convoke-payment-done"',
    );
    expect(bridge).not.toContain('Forge reached convoke or improvise outside choose-many-v1');
  });
});
