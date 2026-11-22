import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedMultipleTargetRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));
const plow = [
  'Name:Plow Under',
  'ManaCost:3 G G',
  'Types:Sorcery',
  "A:SP$ ChangeZone | TargetMin$ 2 | TargetMax$ 2 | ValidTgts$ Land | TgtPrompt$ Select two target lands | Origin$ Battlefield | Destination$ Library | LibraryPosition$ 0 | SpellDescription$ Put two target lands on top of their owners' libraries.",
] as const;

describe('Legacy Cube reviewed multiple targets', () => {
  it('admits the exact Plow Under two-land block', () => {
    expect(legacyCubeReviewedMultipleTargetRefusals(bytes(plow), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', plow.map((line) => line.replace('Name:Plow Under', 'Name:Other'))],
    ['another minimum', plow.map((line) => line.replace('TargetMin$ 2', 'TargetMin$ 1'))],
    ['another maximum', plow.map((line) => line.replace('TargetMax$ 2', 'TargetMax$ 3'))],
    ['another zone', plow.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    ['another target type', plow.map((line) => line.replace('ValidTgts$ Land', 'ValidTgts$ Permanent'))],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedMultipleTargetRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
