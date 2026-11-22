import { describe, expect, it } from 'vitest';
import {
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeReviewedKroxaRefusals,
  legacyCubeReviewedUroRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/index';

const exact = [
  "Name:Uro, Titan of Nature's Wrath",
  'ManaCost:1 G U',
  'Types:Legendary Creature Elder Giant',
  'PT:6/6',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac | TriggerDescription$ When NICKNAME enters, sacrifice it unless it escaped.',
  'SVar:TrigSac:DB$ Sacrifice | SacValid$ Self | ConditionNotPresent$ Card.Self+escaped',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerDescription$ When NICKNAME enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.',
  'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerZones$ Battlefield | OptionalDecider$ You | Secondary$ True | TriggerDescription$ When NICKNAME enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.',
  'SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 3 | SubAbility$ DBDraw',
  'SVar:DBDraw:DB$ Draw | Defined$ You | SubAbility$ DBLand',
  'SVar:DBLand:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | ChangeType$ Land | ChangeNum$ 1',
  'K:Escape:G G U U ExileFromGrave<5/Card.Other/other>',
  'DeckHas:Ability$LifeGain',
  'Oracle:When Uro enters, sacrifice it unless it escaped.\\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedUroRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

const exactKroxa = [
  "Name:Kroxa, Titan of Death's Hunger",
  'ManaCost:B R',
  'Types:Legendary Creature Elder Giant',
  'PT:6/6',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac | TriggerDescription$ When NICKNAME enters, sacrifice it unless it escaped.',
  'SVar:TrigSac:DB$ Sacrifice | SacValid$ Self | ConditionNotPresent$ Card.Self+escaped',
  "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ DBDiscard | TriggerDescription$ Whenever NICKNAME enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.",
  "T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ DBDiscard | Secondary$ True | TriggerDescription$ Whenever NICKNAME enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.",
  'SVar:DBDiscard:DB$ Discard | Mode$ TgtChoose | Defined$ Player.Opponent | NumCards$ 1 | RememberDiscarded$ True | SubAbility$ DBRepeat',
  'SVar:DBRepeat:DB$ RepeatEach | RepeatPlayers$ Player.Opponent | RepeatSubAbility$ DBLoseLife | SubAbility$ DBCleanup',
  'SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 3 | ConditionCheckSVar$ X | ConditionSVarCompare$ EQ0 | Defined$ Player.IsRemembered',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:X:Remembered$Valid Card.nonLand+RememberedPlayerOwn',
  'K:Escape:B B R R ExileFromGrave<5/Card.Other/other>',
  "Oracle:When Kroxa enters, sacrifice it unless it escaped.\\nWhenever Kroxa enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.\\nEscape—{B}{B}{R}{R}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
];
const kroxaRefusal = (lines: readonly string[]) =>
  legacyCubeReviewedKroxaRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Uro boundary', () => {
  it('admits only the exact Escape, conditional sacrifice, gain-draw, and land composition', () => {
    expect(refusal(exact)).toEqual([]);
  });

  it.each([
    ['identity', "Name:Uro, Titan of Nature's Wrath", 'Name:Other Uro'],
    ['entry origin', 'Origin$ Any', 'Origin$ Graveyard'],
    ['sacrifice condition', 'Card.Self+escaped', 'Card.Self'],
    ['attack decider', 'OptionalDecider$ You', 'OptionalDecider$ Opponent'],
    ['attack secondary marker', 'Secondary$ True', 'Secondary$ False'],
    ['life amount', 'LifeAmount$ 3', 'LifeAmount$ 4'],
    ['draw recipient', 'Defined$ You', 'Defined$ Opponent'],
    ['land origin', 'Origin$ Hand', 'Origin$ Library'],
    ['land destination', 'Destination$ Battlefield', 'Destination$ Graveyard'],
    ['land type', 'ChangeType$ Land', 'ChangeType$ Creature'],
    ['land count', 'ChangeNum$ 1', 'ChangeNum$ 2'],
    ['Escape mana', 'K:Escape:G G U U', 'K:Escape:2 G U'],
    ['Escape count', 'ExileFromGrave<5/Card.Other/other>', 'ExileFromGrave<4/Card.Other/other>'],
    ['Escape filter', 'Card.Other/other', 'Card/any'],
  ] as const)('refuses a changed %s', (_label, from, to) => {
    expect(refusal(exact.map((line) => line.replace(from, to)))).toContain('exact reviewed Uro composition');
  });

  it('refuses extra script composition', () => {
    expect(refusal([...exact, 'A:AB$ Draw | Cost$ T | NumCards$ 1'])).toContain(
      'exact reviewed Uro composition',
    );
  });

  it('keeps both exact Titan Escape payments inside the audited cost boundary', () => {
    const paymentRefusals = (line: string) =>
      legacyCubeChosenCostPaymentRefusals(new TextEncoder().encode(`${line}\n`), {
        allowReviewedTitanEscapeCostPart: true,
      });

    expect(paymentRefusals('K:Escape:G G U U ExileFromGrave<5/Card.Other/other>')).toEqual([]);
    expect(paymentRefusals('K:Escape:B B R R ExileFromGrave<5/Card.Other/other>')).toEqual([]);
    expect(paymentRefusals('K:Escape:B R ExileFromGrave<5/Card.Other/other>')).not.toEqual([]);
    expect(paymentRefusals('K:Escape:B B R R ExileFromGrave<4/Card.Other/other>')).not.toEqual([]);
    expect(paymentRefusals('K:Escape:B B R R ExileFromGrave<5/Card/any>')).not.toEqual([]);
  });
});

describe('Legacy Cube reviewed Kroxa boundary', () => {
  it('admits only the exact Escape, sacrifice, and opponent-discard composition', () => {
    expect(kroxaRefusal(exactKroxa)).toEqual([]);
  });

  it.each([
    ['identity', "Name:Kroxa, Titan of Death's Hunger", 'Name:Other Kroxa'],
    ['entry origin', 'Origin$ Any', 'Origin$ Graveyard'],
    ['discard mode', 'Mode$ TgtChoose', 'Mode$ Random'],
    ['discard player', 'Defined$ Player.Opponent', 'Defined$ You'],
    ['discard count', 'NumCards$ 1', 'NumCards$ 2'],
    ['remember marker', 'RememberDiscarded$ True', 'RememberDiscarded$ False'],
    ['repeat player', 'RepeatPlayers$ Player.Opponent', 'RepeatPlayers$ You'],
    ['life amount', 'LifeAmount$ 3', 'LifeAmount$ 4'],
    ['conditional count', 'ConditionSVarCompare$ EQ0', 'ConditionSVarCompare$ GE1'],
    ['remembered filter', 'Card.nonLand+RememberedPlayerOwn', 'Card.Land+RememberedPlayerOwn'],
    ['Escape mana', 'K:Escape:B B R R', 'K:Escape:2 B R'],
    ['Escape count', 'ExileFromGrave<5/Card.Other/other>', 'ExileFromGrave<4/Card.Other/other>'],
  ] as const)('refuses a changed %s', (_label, from, to) => {
    expect(kroxaRefusal(exactKroxa.map((line) => line.replace(from, to)))).toContain(
      'exact reviewed Kroxa composition',
    );
  });

  it('refuses extra script composition', () => {
    expect(kroxaRefusal([...exactKroxa, 'A:AB$ Draw | Cost$ T | NumCards$ 1'])).toContain(
      'exact reviewed Kroxa composition',
    );
  });
});
