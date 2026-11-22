import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedAlternateModeRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const script = (...lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(['Name:Alternate Mode Test', 'ManaCost:1 R', ...lines].join('\n'));

describe('Legacy Cube alternate-mode boundary', () => {
  it('lifts only the reviewed alternate-mode marker', () => {
    expect(legacyCubeReviewedAlternateModeRefusals(script('AlternateMode:Adventure'), inventory)).toEqual([]);
  });

  it('requires the marker', () => {
    expect(legacyCubeReviewedAlternateModeRefusals(script('Types:Creature Human'), inventory)).toContain(
      'missing reviewed alternate-mode marker',
    );
  });

  it.each([
    ['generated object', 'A:SP$ Token | TokenScript$ r_1_1_goblin'],
    ['optional target', 'A:SP$ Destroy | ValidTgts$ Creature | TargetMin$ 0'],
    ['foreign choice', 'A:SP$ TwoPiles'],
  ])('keeps an independent %s blocker', (_label, line) => {
    expect(
      legacyCubeReviewedAlternateModeRefusals(script('AlternateMode:Adventure', line), inventory),
    ).not.toEqual([]);
  });
});
