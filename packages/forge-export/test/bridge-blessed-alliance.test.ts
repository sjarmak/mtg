import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Blessed Alliance boundary', () => {
  it('pins the Escalate root and all three ordered modes', () => {
    expect(
      [
        'isReviewedBlessedAllianceCharm',
        '"Blessed Alliance".equals(source.getName())',
        '"Escalate:2".equals(escalate.iterator().next().getOriginal())',
        '"1".equals(ability.getParam("MinCharmNum"))',
        '"3".equals(ability.getParam("CharmNum"))',
        '"DBGainLife,DBUntap,DBSacrifice".equals(ability.getParam("Choices"))',
        'isReviewedBlessedAllianceGainMode(modes.get(0), ability)',
        'isReviewedBlessedAllianceUntapMode(modes.get(1), ability)',
        'isReviewedBlessedAllianceSacrificeMode(modes.get(2), ability)',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins the exact target and effect boundaries', () => {
    expect(
      [
        'isReviewedBlessedAllianceTarget',
        'ApiType.GainLife, 1, 1',
        '"4".equals(ability.getParam("LifeAmount"))',
        'ApiType.Untap, 0, 2',
        '"Opponent".equals(ability.getParam("ValidTgts"))',
        '"Creature.attacking".equals(ability.getParam("SacValid"))',
        'chooseBlessedAllianceTargets',
        'chooseBlessedAllianceSacrifice',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('keeps other mode, target, and sacrifice shapes fail closed', () => {
    expect(bridge).toContain(
      'Forge reached Blessed Alliance mode selection outside its exact reviewed route',
    );
    expect(bridge).toContain('Forge reached Blessed Alliance targeting outside its exact reviewed route');
    expect(bridge).toContain('Forge reached sacrifice selection outside reviewed-blessed-alliance-v1');
  });
});
