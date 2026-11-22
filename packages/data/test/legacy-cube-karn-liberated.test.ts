import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedKarnLiberatedRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Karn Liberated',
  'ManaCost:7',
  'Types:Legendary Planeswalker Karn',
  'Loyalty:6',
  'A:AB$ ChangeZone | Cost$ AddCounter<4/LOYALTY> | Planeswalker$ True | ValidTgts$ Player | Origin$ Hand | Destination$ Exile | ChangeType$ Card | ChangeNum$ 1 | Chooser$ Targeted | Hidden$ True | IsCurse$ True | Mandatory$ True | SpellDescription$ Target player exiles a card from their hand.',
  'A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Permanent | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target permanent.',
  'A:AB$ RestartGame | Cost$ SubCounter<14/LOYALTY> | Planeswalker$ True | Ultimate$ True | RestrictFromZone$ Exile | RestrictFromValid$ Card.!ExiledWithSource,Spell,Card.Aura | SubAbility$ ReturnFromExile | SpellDescription$ Restart the game, leaving in exile all non-Aura permanent cards exiled with CARDNAME. Then put those cards onto the battlefield under your control.',
  'SVar:ReturnFromExile:DB$ ChangeZoneAll | ChangeType$ Permanent.nonAura+ExiledWithSource | Origin$ Exile | Destination$ Battlefield | GainControl$ True',
  'Oracle:[+4]: Target player exiles a card from their hand.\\n[-3]: Exile target permanent.\\n[-14]: Restart the game, leaving in exile all non-Aura permanent cards exiled with Karn Liberated. Then put those cards onto the battlefield under your control.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedKarnLiberatedRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Karn Liberated boundary', () => {
  it('admits only the exact restart and return lifecycle', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Karn Liberated', 'Name:Other')),
      exact.map((line) => line.replace('SubCounter<14/LOYALTY>', 'SubCounter<10/LOYALTY>')),
      exact.map((line) => line.replace('RestrictFromZone$ Exile', 'RestrictFromZone$ Graveyard')),
      exact.map((line) => line.replace('Card.!ExiledWithSource,Spell,Card.Aura', 'Card.Aura')),
      exact.map((line) => line.replace('SubAbility$ ReturnFromExile', '')),
      exact.map((line) => line.replace('GainControl$ True', 'GainControl$ False')),
      exact.filter((line) => !line.startsWith('SVar:ReturnFromExile:')),
      [...exact, 'SVar:Extra:DB$ RestartGame'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Karn Liberated composition');
    }
  });
});
