import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedAlternateCostRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const script = (...lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(['Name:Alternate Cost Test', 'ManaCost:1 R', ...lines].join('\n'));

describe('Legacy Cube reviewed alternate-cost boundary', () => {
  it.each([
    'Eternalize',
    'Evoke',
    'Flashback',
    'Kicker',
    'Suspend',
    'Miracle',
    'Overload',
    'Escalate',
    'Dash',
    'Splice',
    'Cycling',
    'Entwine',
    'Ninjutsu',
    'Escape',
    'Multikicker',
  ])('admits the exact reviewed %s keyword when no other blocker remains', (keyword) => {
    expect(legacyCubeReviewedAlternateCostRefusals(script(`K:${keyword}:1 R`), inventory)).toEqual([]);
  });

  it('requires at least one reviewed keyword', () => {
    expect(legacyCubeReviewedAlternateCostRefusals(script('A:SP$ Draw | NumCards$ 1'), inventory)).toContain(
      'missing reviewed alternate-cost keyword',
    );
  });

  it.each([
    ['generated object', 'K:Flashback:1 R', 'A:SP$ Token | TokenScript$ r_1_1_goblin'],
    ['unreviewed keyword', 'K:Kicker:1 R', 'K:Buyback:2'],
    ['multiple targets', 'K:Overload:6 U', 'A:SP$ Destroy | ValidTgts$ Creature | TargetMax$ 2'],
  ])('keeps an independent %s blocker', (_label, keyword, line) => {
    expect(legacyCubeReviewedAlternateCostRefusals(script(keyword, line), inventory)).not.toEqual([]);
  });
});
