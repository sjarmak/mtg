import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCompanionRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const yorion = [
  'Name:Yorion, Sky Nomad',
  'ManaCost:3 WU WU',
  'Types:Legendary Creature Bird Serpent',
  'PT:4/5',
  'K:Companion:Special:DeckSizePlus20:Your starting deck contains at least twenty cards more than the minimum deck size.',
  'K:Flying',
  'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigExile | TriggerDescription$ When NICKNAME enters, exile any number of other cards you own and control. Return those cards to the battlefield at the beginning of the next end step.',
  'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ChangeType$ Permanent.nonLand+Other+YouOwn+YouCtrl | SelectPrompt$ Select any number of other nonland permanents you own and control | Hidden$ True | ChangeNum$ X | RememberChanged$ True | SubAbility$ DelTrig',
  'SVar:DelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ TrigReturn | RememberObjects$ RememberedLKI | TriggerDescription$ Return those cards to the battlefield at the beginning of the next end step. | SubAbility$ DBCleanup',
  'SVar:TrigReturn:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | Defined$ DelayTriggerRememberedLKI',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:X:Count$Valid Permanent.nonLand+Other+YouOwn+YouCtrl',
  'Oracle:Companion — Your starting deck contains at least twenty cards more than the minimum deck size. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} any time you could cast a sorcery.)\\nFlying\\nWhen Yorion enters, exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step.',
];

const obosh = [
  'Name:Obosh, the Preypiercer',
  'ManaCost:3 BR BR',
  'Types:Legendary Creature Hellion Horror',
  'PT:3/5',
  'K:Companion:Card.cmcM21,Land:Your starting deck contains only cards with odd mana value and land cards.',
  'R:Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ Card.YouCtrl+cmcM21 | ValidTarget$ Permanent,Player | ReplaceWith$ DmgTwice | Description$ If a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
  'SVar:DmgTwice:DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ Y',
  'SVar:Y:ReplaceCount$DamageAmount/Twice',
  'SVar:PlayMain1:TRUE',
  'Oracle:Companion — Your starting deck contains only cards with odd mana values and land cards. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} any time you could cast a sorcery.)\\nIf a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedCompanionRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed companion boundary', () => {
  it.each([[yorion], [obosh]] as const)('admits an exact reviewed whole-card script', (script) => {
    expect(refusal(script)).toEqual([]);
  });

  it.each(
    [
      yorion.map((line) => line.replace('DeckSizePlus20', 'DeckSizePlus10')),
      yorion.map((line) => line.replace('Destination$ Exile', 'Destination$ Hand')),
      yorion.filter((line) => !line.startsWith('SVar:DBCleanup:')),
      obosh.map((line) => line.replace('Card.cmcM21,Land', 'Card.cmcLE2,Land')),
      obosh.map((line) => line.replace('ReplaceCount$DamageAmount/Twice', 'ReplaceCount$DamageAmount')),
      [...obosh, 'SVar:Extra:DB$ Draw'],
    ].map((script) => [script] as const),
  )('refuses a mutated companion composition', (script) => {
    expect(refusal(script)).toContain('exact reviewed companion composition');
  });
});
