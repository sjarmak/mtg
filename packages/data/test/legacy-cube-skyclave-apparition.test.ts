import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSkyclaveApparitionRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Skyclave Apparition',
  'ManaCost:1 W W',
  'Types:Creature Kor Spirit',
  'PT:2/2',
  "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.",
  "SVar:TrigExile:DB$ ChangeZone | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Permanent.nonLand+!token+YouDontCtrl+cmcLE4 | TgtPrompt$ Select target nonland, nontoken permanent you don't control with mana value 4 or less. | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SpellDescription$ Exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.",
  "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
  'SVar:TrigToken:DB$ Token | TokenScript$ u_x_x_illusion | TokenOwner$ RememberedOwner | ConditionDefined$ Remembered | ConditionPresent$ Card.ExiledWithSource | TokenPower$ X | TokenToughness$ X | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:X:Remembered$CardManaCost',
  "Oracle:When Skyclave Apparition enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.\\nWhen Skyclave Apparition leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSkyclaveApparitionRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Skyclave Apparition boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Skyclave Apparition', 'Name:Near Apparition'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 W W', 'ManaCost:2 W'))],
    ['card type', EXACT.map((line) => line.replace('Creature Kor Spirit', 'Creature Spirit'))],
    ['power and toughness', EXACT.map((line) => line.replace('PT:2/2', 'PT:2/3'))],
    ['target minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['target maximum', EXACT.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    ['target domain', EXACT.map((line) => line.replace('Permanent.nonLand', 'Permanent'))],
    ['token exclusion', EXACT.map((line) => line.replace('+!token', ''))],
    ['target controller', EXACT.map((line) => line.replace('+YouDontCtrl', '+YouCtrl'))],
    ['mana-value bound', EXACT.map((line) => line.replace('+cmcLE4', '+cmcLE5'))],
    ['target origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    ['target destination', EXACT.map((line) => line.replace('Destination$ Exile', 'Destination$ Graveyard'))],
    ['memory', EXACT.map((line) => line.replace('RememberChanged$ True', 'RememberChanged$ False'))],
    ['leave origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Exile'))],
    ['leave destination', EXACT.map((line) => line.replace('Destination$ Any', 'Destination$ Graveyard'))],
    ['token root', EXACT.map((line) => line.replace('u_x_x_illusion', 'u_1_1_illusion'))],
    ['token owner', EXACT.map((line) => line.replace('TokenOwner$ RememberedOwner', 'TokenOwner$ You'))],
    ['token condition', EXACT.map((line) => line.replace('Card.ExiledWithSource', 'Card.IsRemembered'))],
    ['token power', EXACT.map((line) => line.replace('TokenPower$ X', 'TokenPower$ 1'))],
    ['token toughness', EXACT.map((line) => line.replace('TokenToughness$ X', 'TokenToughness$ 1'))],
    ['cleanup', EXACT.map((line) => line.replace('ClearRemembered$ True', 'ClearRemembered$ False'))],
    ['X derivation', EXACT.map((line) => line.replace('Remembered$CardManaCost', 'Count$Remembered'))],
    ['Oracle text', EXACT.map((line) => line.replace('X/X blue Illusion', '1/1 blue Illusion'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Skyclave Apparition composition');
  });
});
