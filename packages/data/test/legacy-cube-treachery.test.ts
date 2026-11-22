import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedTreacheryRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Treachery',
  'ManaCost:3 U U',
  'Types:Enchantment Aura',
  'K:Enchant:Creature',
  'SVar:AttachAILogic:GainControl',
  'S:Mode$ Continuous | Affected$ Card.EnchantedBy | GainControl$ You | Description$ You control enchanted creature.',
  'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigUntap | TriggerDescription$ When CARDNAME enters, untap up to five lands.',
  'SVar:TrigUntap:DB$ Untap | UntapUpTo$ True | UntapType$ Land | Amount$ 5',
  'SVar:PlayMain1:TRUE',
  'SVar:FreeSpellAI:True',
  'Oracle:Enchant creature\\nWhen Treachery enters, untap up to five lands.\\nYou control enchanted creature.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedTreacheryRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

function replace(lines: readonly string[], from: string, to: string): readonly string[] {
  const changed = lines.map((line) => line.replace(from, to));
  expect(changed).not.toEqual(lines);
  return changed;
}

describe('Legacy Cube reviewed Treachery boundary', () => {
  it('admits only the exact Aura-control and up-to-five-land script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', replace(EXACT, 'Name:Treachery', 'Name:Near Treachery')],
    ['mana cost', replace(EXACT, 'ManaCost:3 U U', 'ManaCost:2 U U')],
    ['type line', replace(EXACT, 'Types:Enchantment Aura', 'Types:Enchantment')],
    ['enchant filter', replace(EXACT, 'K:Enchant:Creature', 'K:Enchant:Permanent')],
    ['control recipient', replace(EXACT, 'GainControl$ You', 'GainControl$ Opponent')],
    ['entry origin', replace(EXACT, 'Origin$ Any', 'Origin$ Stack')],
    ['entry destination', replace(EXACT, 'Destination$ Battlefield', 'Destination$ Graveyard')],
    ['trigger API', replace(EXACT, 'DB$ Untap', 'DB$ Tap')],
    ['optionality', replace(EXACT, 'UntapUpTo$ True', 'UntapUpTo$ False')],
    ['candidate filter', replace(EXACT, 'UntapType$ Land', 'UntapType$ Land.YouCtrl')],
    ['amount', replace(EXACT, 'Amount$ 5', 'Amount$ 4')],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Treachery composition');
  });
});
