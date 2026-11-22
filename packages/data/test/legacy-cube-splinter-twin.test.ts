import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSplinterTwinRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Splinter Twin',
  'ManaCost:2 R R',
  'Types:Enchantment Aura',
  'K:Enchant:Creature',
  'SVar:AttachAILogic:Pump',
  'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddAbility$ ABCopy | Description$ Enchanted creature has "{T}: Create a token that\'s a copy of this creature, except it has haste. Exile it at the beginning of the next end step."',
  "SVar:ABCopy:AB$ CopyPermanent | Cost$ T | Defined$ Self | AddKeywords$ Haste | AtEOT$ Exile | SpellDescription$ Create a token that's a copy of this creature, except it has haste. Exile it at the beginning of the next end step.",
  'SVar:NonStackingAttachEffect:True',
  'Oracle:Enchant creature\\nEnchanted creature has "{T}: Create a token that\'s a copy of this creature, except it has haste. Exile that token at the beginning of the next end step."',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSplinterTwinRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Splinter Twin boundary', () => {
  it('lifts exactly the installed creature Aura and copied-token composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Splinter Twin', 'Name:Near Twin'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:2 R R', 'ManaCost:3 R'))],
    ['card type', EXACT.map((line) => line.replace('Types:Enchantment Aura', 'Types:Enchantment'))],
    ['enchant domain', EXACT.map((line) => line.replace('K:Enchant:Creature', 'K:Enchant:Permanent'))],
    ['attachment logic', EXACT.map((line) => line.replace('AttachAILogic:Pump', 'AttachAILogic:Curse'))],
    ['affected object', EXACT.map((line) => line.replace('Creature.EnchantedBy', 'Creature.YouCtrl'))],
    ['granted ability', EXACT.map((line) => line.replace('AddAbility$ ABCopy', 'AddAbility$ Other'))],
    ['copy API', EXACT.map((line) => line.replace('AB$ CopyPermanent', 'AB$ Token'))],
    ['activation cost', EXACT.map((line) => line.replace('Cost$ T', 'Cost$ 1'))],
    ['copy definition', EXACT.map((line) => line.replace('Defined$ Self', 'Defined$ Parent'))],
    ['copy keyword', EXACT.map((line) => line.replace('AddKeywords$ Haste', 'AddKeywords$ Flying'))],
    ['delayed disposition', EXACT.map((line) => line.replace('AtEOT$ Exile', 'AtEOT$ Sacrifice'))],
    [
      'stacking behavior',
      EXACT.map((line) => line.replace('NonStackingAttachEffect:True', 'NonStackingAttachEffect:False')),
    ],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:ABCopy:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:AB$ CopyPermanent | Defined$ Self']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Splinter Twin composition');
  });
});
