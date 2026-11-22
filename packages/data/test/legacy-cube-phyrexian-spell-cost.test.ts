import { describe, expect, it } from 'vitest';
import {
  legacyCubePhyrexianManaPaymentRefusals,
  legacyCubeReviewedPhyrexianSpellCostRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));

const dismember = [
  'Name:Dismember',
  'ManaCost:1 BP BP',
  'Types:Instant',
  'A:SP$ Pump | IsCurse$ True | ValidTgts$ Creature | NumAtt$ -5 | NumDef$ -5 | SpellDescription$ Target creature gets -5/-5 until end of turn.',
  'Oracle:({B/P} can be paid with either {B} or 2 life.)\\nTarget creature gets -5/-5 until end of turn.',
] as const;

const legionnaire = [
  'Name:Porcelain Legionnaire',
  'ManaCost:2 WP',
  'Types:Artifact Creature Phyrexian Soldier',
  'PT:3/1',
  'K:First Strike',
  'Oracle:({W/P} can be paid with either {W} or 2 life.)\\nFirst strike',
] as const;

describe('Legacy Cube reviewed Phyrexian spell costs', () => {
  it.each([
    ['Dismember', dismember],
    ['Porcelain Legionnaire', legionnaire],
  ] as const)('admits only the exact %s printed-cost route', (_label, script) => {
    expect(legacyCubePhyrexianManaPaymentRefusals(bytes(script))).toEqual([]);
    expect(legacyCubeReviewedPhyrexianSpellCostRefusals(bytes(script), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', dismember.map((line) => line.replace('Name:Dismember', 'Name:Unreviewed'))],
    ['another symbol count', dismember.map((line) => line.replace('ManaCost:1 BP BP', 'ManaCost:1 BP'))],
    ['another effect', dismember.map((line) => line.replace('NumDef$ -5', 'NumDef$ -4'))],
    ['another creature', legionnaire.map((line) => line.replace('PT:3/1', 'PT:3/2'))],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedPhyrexianSpellCostRefusals(bytes(script), inventory)).not.toEqual([]);
  });

  it('keeps non-Phyrexian and snow spell costs outside the profile', () => {
    expect(legacyCubePhyrexianManaPaymentRefusals(bytes(['Name:Plain', 'ManaCost:2 W']))).toEqual([
      'missing Phyrexian mana cost',
    ]);
    expect(legacyCubePhyrexianManaPaymentRefusals(bytes(['Name:Snow', 'ManaCost:S WP']))).toEqual([
      'snow mana cost',
    ]);
  });
});
