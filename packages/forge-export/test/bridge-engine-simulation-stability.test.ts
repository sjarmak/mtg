/** Runtime boundary for Forge 2.0.14's unsafe full-game simulation path. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

function methodBody(signature: string, followingMember: string): string {
  const start = bridge.indexOf(signature);
  const end = bridge.indexOf(followingMember, start);
  if (start < 0 || end < 0) throw new Error(`could not isolate ${signature}`);
  return bridge.slice(start, end);
}

describe('the Forge engine seat avoids unstable full-game copies in every admitted format', () => {
  it('uses hybrid simulation for both Legacy Cube and AKH/HOU', () => {
    expect(bridge).toContain('Set<AIOption> options = Set.of(AIOption.USE_HYBRID_SIMULATION);');
    expect(bridge).not.toContain('requiresHybridSimulation');
    expect(bridge).not.toContain('if (string(card, "name").equals("Fall from Favor"))');
  });

  it('takes the cycling fallback from the open request rather than a format name', () => {
    expect(bridge).toContain('evaluateCycling = bool(request, "engineCyclingLookahead");');
    expect(bridge).not.toContain('unknown printed-format to Forge game-type mapping');
  });

  it('falls back to Forge native heuristics while transferred role markers are unsafe to copy', () => {
    const choose = methodBody(
      'public List<SpellAbility> chooseSpellAbilityToPlay()',
      '/** Forge 2.0.14 retains removed role markers',
    );
    expect(choose).toMatch(
      /AIOption actionMode = hasUncopyableTransferredRoleMarker\(getPlayer\(\)\.getGame\(\)\)\s*\? null\s*:/u,
    );
    expect(choose).toMatch(
      /getAi\(\)\.setUseSimulation\(actionMode\);\s*try \{[\s\S]*\} finally \{\s*getAi\(\)\.setUseSimulation\(defaultMode\);\s*\}/u,
    );
    // The monarch and the initiative are the two markers Forge's simulation cannot copy; a
    // later set's own game-wide marker joins this disjunction between or after them.
    expect(bridge).toMatch(
      /game\.getMonarch\(\) != null\s*(?:\|\|\s*game\.\w+\(\) != null\s*)*\|\|\s*game\.getHasInitiative\(\) != null/u,
    );
    expect(bridge).not.toContain('string(card, "name").equals("Court of Bounty")');
  });

  it('retries only pinned Forge land-simulation failures without simulation', () => {
    const choose = methodBody(
      'public List<SpellAbility> chooseSpellAbilityToPlay()',
      '/** Forge 2.0.14 retains removed role markers',
    );
    expect(choose).toContain('isUnsafeLandSimulationFailure(error)');
    expect(choose).toMatch(
      /catch \(RuntimeException error\) \{[\s\S]*getAi\(\)\.setUseSimulation\(null\);[\s\S]*super\.chooseSpellAbilityToPlay\(\)/u,
    );
    expect(bridge).toContain('"Phase.nextPhase() is called, but Stack isn\'t empty."');
    expect(bridge).toContain('"forge.ai.simulation.GameStateEvaluator"');
    expect(bridge).toContain('"simulateUpcomingCombatThisTurn"');
    expect(bridge).toContain('"forge.ai.AiController"');
    expect(bridge).toContain('"filterLandsToPlay"');
    expect(bridge).toContain('"forge.game.card.CardState"');
    expect(bridge).toContain('"copyFrom"');
    expect(bridge).toContain('"forge.game.card.CardCopyService"');
    expect(bridge).toContain('"getLKICopy"');
    expect(bridge).toContain('"forge.ai.simulation.OnePlaySafetyChecker"');
    expect(bridge).toContain('"isAcceptable"');
    expect(bridge).toContain('"forge.game.player.Player"');
    expect(bridge).toContain('"playLand"');
    expect(bridge).toContain('"forge.game.combat.CombatUtil"');
    expect(bridge).toContain('"checkDeclaredAttacker"');
  });
});
