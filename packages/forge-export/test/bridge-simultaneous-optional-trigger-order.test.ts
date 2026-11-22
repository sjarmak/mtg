import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

function methodBody(signature: string, nextSignature: string): string {
  const start = bridge.indexOf(signature);
  const end = bridge.indexOf(nextSignature, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return bridge.slice(start, end);
}

describe('the Forge bridge orders simultaneous optional triggers by structure', () => {
  it('admits a wrapped optional trigger without branching on card names', () => {
    const predicate = methodBody(
      'private static boolean isReviewedSimultaneousOptionalTrigger(',
      'private static String describeTriggerOrderAbility(',
    );

    expect(predicate).toContain('ability instanceof WrappedAbility wrapper');
    expect(predicate).toContain('ability.isOptionalTrigger()');
    expect(predicate).toContain('trigger.getHostCard() == source');
    expect(predicate).toContain('wrapped.getTrigger() == trigger');
    expect(predicate).toContain('wrapped.getActivatingPlayer() == player');
    expect(predicate).not.toMatch(/Court of Bounty|Land Tax/u);
  });

  it('keeps the structural optional check scoped to simultaneous non-singleton batches', () => {
    // A later set's own exemption from the optional-trigger check lands as another
    // && !isReviewedX(...) beside this one, so tolerate terms between the two conjuncts.
    expect(bridge).toMatch(
      /!singleton && ability\.isOptionalTrigger\(\)\s*(?:&&\s*!?[\w.]+(?:\([^()]*\))?\s*)*&&\s*!isReviewedSimultaneousOptionalTrigger\(ability, player\)/u,
    );
  });

  it('enumerates each exact ability and verifies the returned identity again', () => {
    expect(bridge).toContain('"trigger-order-" + ability.getId()');
    expect(bridge).toContain('List.of(cardTarget(source))');
    expect(bridge).toContain(
      '!(value instanceof SpellAbility chosen)\n' +
        '                            || remaining.stream().noneMatch(candidate -> candidate == chosen)',
    );
  });
});
