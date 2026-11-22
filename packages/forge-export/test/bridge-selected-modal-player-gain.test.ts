import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

function methodBody(signature: string, followingMember: string): string {
  const start = bridge.indexOf(signature);
  const end = bridge.indexOf(followingMember, start);
  if (start < 0 || end < 0) throw new Error(`could not isolate ${signature}`);
  return bridge.slice(start, end);
}

describe('Forge bridge selected modal singleton target boundary', () => {
  it('owns the route from structural modal provenance without card names or prompts', () => {
    const guard = methodBody(
      'private static boolean isReviewedSelectedModalTarget(',
      'private boolean isReviewedSolitudeTarget(',
    );

    expect(guard).toContain('root.getApi() != ApiType.Charm');
    expect(guard).toContain('root.getAdditionalAbilityList("Choices")');
    expect(guard).toContain('isDeclaredModalChoice(modes, ability)');
    expect(guard).toContain('root.getSubAbility()');
    expect(guard).toContain('root.hasParam("ValidTgts")');
    expect(guard).toContain('root.hasParam("TargetMin")');
    expect(guard).toContain('root.hasParam("TargetMax")');
    expect(guard).toContain('selected == ability');
    expect(guard).not.toMatch(/Primal Command|TgtPrompt/u);
  });

  it('pins singleton, non-random, non-delegated player targeting and the complete active chain', () => {
    const guard = methodBody(
      'private static boolean isReviewedSelectedModalTarget(',
      'private boolean isReviewedSolitudeTarget(',
    );

    expect(guard).toContain('ability.getMinTargets() != 1');
    expect(guard).toContain('ability.getMaxTargets() != 1');
    expect(guard).toContain('ability.isDividedAsYouChoose()');
    expect(guard).toContain('restrictions.isRandomTarget()');
    expect(guard).toContain('restrictions.getMandatory()');
    expect(guard).toContain('ability.hasParam("TargetingPlayer")');
    expect(guard).toContain('Integer.toString(selectedCount).equals(root.getParam("CharmNum"))');
  });

  it('checks every offered entity before exposing the generic selected-mode route', () => {
    const choose = methodBody(
      'boolean chooseSingleTarget(Player player, SpellAbility ability)',
      'private static boolean isReviewedAuthorityTarget(',
    );

    expect(choose).toMatch(
      /boolean reviewedSelectedModalTarget = isReviewedSelectedModalTarget\(ability\);/u,
    );
    expect(choose).toMatch(/reviewedSelectedModalTarget[\s\S]*?!ability\.canTarget\(candidate\)/u);
    expect(choose).toContain('Forge offered an illegal target for an exact selected modal ability');
  });
});
