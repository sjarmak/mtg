import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Stratus Dancer boundary', () => {
  it('pins the triggered counter to the exact face-up source and stack filter', () => {
    expect(
      [
        'isReviewedStratusDancerCounter',
        '"Stratus Dancer".equals(source.getName())',
        'ability.isTrigger()',
        'ability.getApi() == ApiType.Counter',
        'root == ability',
        'ability.getSubAbility() == null',
        '"Spell".equals(ability.getParam("TargetType"))',
        '"Instant,Sorcery".equals(ability.getParam("ValidTgts"))',
        'ability.getMinTargets() == 1',
        'ability.getMaxTargets() == 1',
        '!targets.getMandatory()',
        'targets.getZone().contains(ZoneType.Stack)',
        'reviewedStratusDancerCounter',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('does not make every triggered stack target owned', () => {
    // Stratus Dancer and Nimble Obstructionist are two exemptions from the triggered-ability
    // refusal; a later set's own && !isReviewedX(...) joins them before, between or after.
    expect(bridge).toMatch(
      /if \(ability\.isTrigger\(\)\s*(?:&&\s*!?[\w.]+(?:\([^()]*\))?\s*)*&&\s*!isReviewedStratusDancerCounter\(ability\)\s*(?:&&\s*!?[\w.]+(?:\([^()]*\))?\s*)*&&\s*!isReviewedNimbleObstructionistCounter\(ability\)\s*(?:&&\s*!?[\w.]+(?:\([^()]*\))?\s*)*\) return false;/u,
    );
  });
});
