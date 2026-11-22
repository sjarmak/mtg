/** Static refusal boundary for Reveillark's optional zero-to-two graveyard targets. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact reviewed Reveillark target route', () => {
  it('pins the callback topology, target cardinality, zones, filter, and controller', () => {
    expect(bridge).toContain('boolean reviewedReveillark = isReviewedReveillarkTarget(ability);');
    expect(bridge).toContain('"Reveillark".equals(source.getName())');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 2');
    expect(bridge).toContain('"Creature.powerLE2".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Destination"))');
    expect(bridge).toContain(
      '"TriggeredCardController".equals(ability.getParam("TargetsWithDefinedController"))',
    );
    expect(bridge).toContain('card.getOwner() != player');
    expect(bridge).toContain('card.getNetPower() > 2');
  });

  it('offers explicit completion only at the reviewed zero-to-two bounds', () => {
    expect(bridge).toContain('"reveillark-targets-done"');
    expect(bridge).toContain('chosen.size() >= minimum');
    expect(bridge).toContain('chosen.size() < maximum');
    // Reveillark and Authority are the two cards allowed a zero-target completion today; a
    // later card added to the exception inserts its own && !reviewedX in this refusal.
    expect(bridge).toMatch(
      /if \(selected\.value == null\) \{\s+if \("target-cancel"\.equals\(selected\.id\)\) return false;\s+if \(!reviewedReveillark\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedAuthority\s*(?:&&\s*!\w+\s*)*\) return false;\s+break;\s+\}/u,
    );
    expect(bridge).toContain('selected reviewed multiple target disappeared');
  });
});
