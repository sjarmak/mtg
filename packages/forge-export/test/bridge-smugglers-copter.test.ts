import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Smuggler's Copter's reviewed decisions", () => {
  it('pins the exact attack-or-block loot root before routing its discard', () => {
    expect(bridge).toContain('isReviewedSmugglersCopterLootAbility');
    expect(bridge).toContain('return session.chooseSmugglersCopterLootDiscard(');
    expect(bridge).toContain('Forge reached discard selection outside reviewed-smugglers-copter-loot-v1');
    expect(bridge).toContain('"Draw<1/You>".equals(ability.getParam("Cost"))');
  });

  it('crews through the Kaladesh Vehicle table instead of a route of its own (mtg-hqqtb)', () => {
    expect(bridge).toMatch(
      /REVIEWED_KLD_VANILLA_CREW_VEHICLES\s*=\s*Map\.ofEntries\([\s\S]*?Map\.entry\("Smuggler's Copter", 1\)/u,
    );
    // The Copter-only chooser, candidate filter, cost predicate and contract id are gone; what
    // pins Crew 1 now is the table row and the shared shape in bridge-kld-vehicle-crew.test.ts.
    expect(bridge).not.toContain('SmugglersCopterCrew');
    expect(bridge).not.toContain('reviewed-smugglers-copter-crew-v1');
    expect(bridge).not.toContain('"Smuggler\'s Copter".equals(choiceSource.getName())');
  });
});
