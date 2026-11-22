import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedUnlessCostRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const esper = [
  'Name:Esper Sentinel',
  'ManaCost:W',
  'Types:Artifact Creature Human Soldier',
  'PT:1/1',
  "T:Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ Player.Opponent | ActivatorThisTurnCast$ EQ1 | Execute$ TrigDraw | TriggerZones$ Battlefield | TriggerDescription$ Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is CARDNAME's power.",
  'SVar:TrigDraw:DB$ Draw | Defined$ You | UnlessCost$ X | UnlessPayer$ TriggeredActivator | NumCards$ 1',
  'SVar:X:Count$CardPower',
  "Oracle:Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.",
];

const nahiri = [
  'Name:Nahiri, the Harbinger',
  'ManaCost:2 R W',
  'Types:Legendary Planeswalker Nahiri',
  'Loyalty:4',
  'A:AB$ Draw | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | Defined$ You | NumCards$ 1 | UnlessCost$ Discard<1/Card> | UnlessSwitched$ True | UnlessPayer$ You | SpellDescription$ You may discard a card. If you do, draw a card.',
  'A:AB$ ChangeZone | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Enchantment,Artifact.tapped,Creature.tapped | TgtPrompt$ Select target enchantment, tapped artifact, or tapped creature | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target enchantment, tapped artifact, or tapped creature.',
  'A:AB$ ChangeZone | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | Ultimate$ True | Origin$ Library | Destination$ Battlefield | ChangeType$ Artifact,Creature | RememberChanged$ True | SubAbility$ DBPump | SpellDescription$ Search your library for an artifact or creature card, put it onto the battlefield, then shuffle. It gains haste. Return it to your hand at the beginning of the next end step.',
  'SVar:DBPump:DB$ Animate | Keywords$ Haste | Duration$ Permanent | AtEOT$ Hand | Defined$ Remembered | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'DeckHas:Ability$Discard',
  'Oracle:[+2]: You may discard a card. If you do, draw a card.\\n[-2]: Exile target enchantment, tapped artifact, or tapped creature.\\n[-8]: Search your library for an artifact or creature card, put it onto the battlefield, then shuffle. It gains haste. Return it to your hand at the beginning of the next end step.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedUnlessCostRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed UnlessCost boundary', () => {
  it.each([
    ['Esper Sentinel', esper],
    ['Nahiri, the Harbinger', nahiri],
  ] as const)('admits only the exact %s whole-card composition', (_name, exact) => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace(/^Name:.*/u, 'Name:Other')),
      exact.map((line) => line.replace('UnlessCost$ X', 'UnlessCost$ 1')),
      exact.map((line) => line.replace('UnlessCost$ Discard<1/Card>', 'UnlessCost$ Discard<2/Card>')),
      exact.map((line) => line.replace('UnlessPayer$ You', 'UnlessPayer$ Opponent')),
      exact.filter((line) => !line.startsWith('SVar:') && !line.startsWith('DeckHas:')),
      [...exact, 'SVar:Extra:DB$ Draw | UnlessCost$ 2'],
    ]) {
      if (mutation.join('\n') === exact.join('\n')) continue;
      expect(refusal(mutation)).toContain('exact reviewed UnlessCost composition');
    }
  });
});
