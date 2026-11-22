import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Heartless Act boundary', () => {
  it('accepts either exact legal mode or both while rejecting empty, duplicate, and foreign modes', () => {
    expect(bridge).toContain('isReviewedHeartlessActCharm');
    expect(bridge).toContain('"Heartless Act".equals(source.getName())');
    expect(bridge).toContain('!"Destroy,Remove".equals(ability.getParam("Choices"))');
    expect(bridge).toContain('|| possible.isEmpty()');
    expect(bridge).toContain('|| possible.size() > 2');
    expect(bridge).toContain('if (isReviewedHeartlessActDestroyMode(mode, ability))');
    expect(bridge).toContain('if (sawDestroy) return false;');
    expect(bridge).toContain('if (isReviewedHeartlessActRemoveMode(mode, ability))');
    expect(bridge).toContain('if (sawRemove) return false;');
    expect(bridge).toContain('return sawDestroy || sawRemove;');
  });

  it('pins both mutually exclusive singleton target blocks', () => {
    expect(bridge).toContain('isReviewedHeartlessActTarget');
    expect(bridge).toContain('"Creature.!HasCounters".equals(mode.getParam("ValidTgts"))');
    expect(bridge).toContain('"Creature".equals(mode.getParam("ValidTgts"))');
    expect(bridge).toContain('!card.getCounters().isEmpty()');
  });

  it('pins Any counter choices to the selected target and the zero-through-three budget', () => {
    expect(bridge).toContain('validateReviewedHeartlessActCounterType');
    expect(bridge).toContain('validateReviewedHeartlessActNumber');
    expect(bridge).toContain('ability.getTargets().getFirstTargetedCard() != target');
    expect(bridge).toContain('target.getCounters(option) <= 0');
    expect(bridge).toContain('minimum != 0 || maximum < 1 || maximum > 3');
  });
});
