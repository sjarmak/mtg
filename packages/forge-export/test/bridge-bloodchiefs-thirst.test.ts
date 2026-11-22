/** Static refusal boundary for Bloodchief's Thirst's mutually exclusive target blocks. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only the exact reviewed Bloodchief's Thirst target route", () => {
  it('pins the root and subability topology, cardinality, APIs, and filters', () => {
    expect(bridge).toContain('isReviewedBloodchiefsThirstTarget(ability)');
    expect(bridge).toContain('"Bloodchief\'s Thirst".equals(source.getName())');
    expect(bridge).toContain('root.getApi() != ApiType.Destroy');
    expect(bridge).toContain('!root.isSpell()');
    expect(bridge).toContain('root.getRootAbility() != root');
    expect(bridge).toContain('"Creature.cmcLE2,Planeswalker.cmcLE2".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Creature,Planeswalker".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('boolean exactExclusiveCardinality');
    expect(bridge).toContain('root.getMinTargets() == 1');
    expect(bridge).toContain('root.getSubAbility().getMinTargets() == 0');
    expect(bridge).toContain('root.getMinTargets() == 0');
    expect(bridge).toContain('root.getSubAbility().getMinTargets() == 1');
  });

  it('permits the nested target block only for that exact route', () => {
    expect(bridge).toContain('boolean reviewedBloodchiefsThirstTarget');
    expect(bridge).toMatch(
      /!reviewedBloodchiefsThirstTarget\s+(?:&& !reviewed\w+\s+)*&& hasAnotherTargetBlock\(ability\)/u,
    );
    expect(bridge).toContain("Bloodchief's Thirst target outside its exact profile");
    expect(bridge).toContain("inactive Bloodchief's Thirst target block with an existing target");
  });
});
