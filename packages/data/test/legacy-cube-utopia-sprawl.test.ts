import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedUtopiaSprawlRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Utopia Sprawl',
  'ManaCost:G',
  'Types:Enchantment Aura',
  'K:Enchant:Forest',
  'SVar:AttachAILogic:Pump',
  'K:ETBReplacement:Other:ChooseColor',
  'SVar:ChooseColor:DB$ ChooseColor | Defined$ You | SpellDescription$ As CARDNAME enters, choose a color.',
  'T:Mode$ TapsForMana | ValidCard$ Card.AttachedBy | TriggerZones$ Battlefield | Execute$ TrigMana | Static$ True | TriggerDescription$ Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
  'SVar:TrigMana:DB$ Mana | Produced$ Chosen | Defined$ TriggeredCardController',
  'AI:RemoveDeck:All',
  'Oracle:Enchant Forest\\nAs Utopia Sprawl enters, choose a color.\\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedUtopiaSprawlRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Utopia Sprawl boundary', () => {
  it('lifts exactly the installed Forest Aura and chosen-mana composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Utopia Sprawl', 'Name:Near Sprawl'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:G', 'ManaCost:1 G'))],
    ['card type', EXACT.map((line) => line.replace('Types:Enchantment Aura', 'Types:Enchantment'))],
    ['enchant domain', EXACT.map((line) => line.replace('K:Enchant:Forest', 'K:Enchant:Land'))],
    ['attachment logic', EXACT.map((line) => line.replace('AttachAILogic:Pump', 'AttachAILogic:Curse'))],
    ['entry replacement', EXACT.map((line) => line.replace('Other:ChooseColor', 'Other:Other'))],
    ['color chooser', EXACT.map((line) => line.replace('DB$ ChooseColor', 'DB$ Draw'))],
    ['color recipient', EXACT.map((line) => line.replace('Defined$ You', 'Defined$ Opponent'))],
    ['trigger mode', EXACT.map((line) => line.replace('Mode$ TapsForMana', 'Mode$ ChangesZone'))],
    ['attached source', EXACT.map((line) => line.replace('ValidCard$ Card.AttachedBy', 'ValidCard$ Land'))],
    [
      'trigger zone',
      EXACT.map((line) => line.replace('TriggerZones$ Battlefield', 'TriggerZones$ Graveyard')),
    ],
    ['static trigger', EXACT.map((line) => line.replace('Static$ True', 'Static$ False'))],
    ['produced color', EXACT.map((line) => line.replace('Produced$ Chosen', 'Produced$ G'))],
    ['mana recipient', EXACT.map((line) => line.replace('Defined$ TriggeredCardController', 'Defined$ You'))],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:TrigMana:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Mana | Produced$ G']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Utopia Sprawl composition');
  });
});
