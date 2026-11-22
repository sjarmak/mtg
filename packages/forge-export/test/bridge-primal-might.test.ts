/** Static refusal boundary for Primal Might's mandatory pump and optional fight targets. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact reviewed Primal Might target route', () => {
  it('pins the root and subability topology, cardinality, APIs, and filters', () => {
    expect(bridge).toContain('isReviewedPrimalMightTarget(ability)');
    expect(bridge).toContain('"Primal Might".equals(source.getName())');
    expect(bridge).toContain('root.getApi() != ApiType.Pump');
    expect(bridge).toContain('root.getSubAbility().getApi() != ApiType.Fight');
    expect(bridge).toContain('root.getRootAbility() != root');
    expect(bridge).toContain('"Creature.YouCtrl".equals(root.getParam("ValidTgts"))');
    expect(bridge).toContain('"Creature.YouDontCtrl".equals(root.getSubAbility().getParam("ValidTgts"))');
    expect(bridge).toContain('root.getMinTargets() != 1');
    expect(bridge).toContain('root.getSubAbility().getMinTargets() != 0');
    expect(bridge).toContain('root.getSubAbility().getMaxTargets() != 1');
  });

  it('permits the nested optional target only for that exact route', () => {
    expect(bridge).toContain('boolean reviewedPrimalMightTarget');
    expect(bridge).toMatch(
      /!reviewedPrimalMightTarget\s+(?:&& !reviewed\w+\s+)*&& hasAnotherTargetBlock\(ability\)/u,
    );
    expect(bridge).toContain('Primal Might target outside its exact profile');
  });
});
