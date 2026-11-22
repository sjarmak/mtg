import { describe, expect, it } from 'vitest';
import type { Decision } from '@mtg/kernel';
import { askOpensItself, PRIORITY_WINDOWS } from '../../src/routes/play/ask-opens';

function decisionOf(kind: Decision['kind']): Decision {
  return { kind } as unknown as Decision;
}

describe('askOpensItself', () => {
  it('keeps every priority window shut', () => {
    for (const kind of PRIORITY_WINDOWS) expect(askOpensItself(decisionOf(kind))).toBe(false);
    expect([...PRIORITY_WINDOWS].sort()).toEqual([
      'declareAttackers',
      'declareBlockers',
      'orderAttackers',
      'orderBlockers',
      'priority',
    ]);
  });

  it('opens every other ask on its own', () => {
    const asks: Decision['kind'][] = [
      'mulligan',
      'optionalTrigger',
      'triggerTargets',
      'spellTargets',
      'may',
      'scry',
      'discard',
      'manaColor',
      'openingHandAction',
      'unless',
    ];
    for (const kind of asks) expect(askOpensItself(decisionOf(kind))).toBe(true);
  });

  it('is false with nothing asked', () => {
    expect(askOpensItself(null)).toBe(false);
  });
});
