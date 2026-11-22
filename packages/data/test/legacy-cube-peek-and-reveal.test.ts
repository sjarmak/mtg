import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPeekAndRevealRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));

const delver = [
  'Name:Delver of Secrets',
  'ManaCost:U',
  'Types:Creature Human Wizard',
  'PT:1/1',
  'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPeek | TriggerDescription$ At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform CARDNAME.',
  'SVar:TrigPeek:DB$ PeekAndReveal | PeekAmount$ 1 | RevealOptional$ True | RememberRevealed$ True | AILogic$ InstantOrSorcery | SubAbility$ DBTransform',
  'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | ConditionDefined$ Remembered | ConditionPresent$ Card.Instant,Card.Sorcery | ConditionCompare$ EQ1 | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'DeckHints:Type$Instant|Sorcery',
  'AlternateMode:DoubleFaced',
  'Oracle:At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.',
  '',
  'ALTERNATE',
  '',
  'Name:Insectile Aberration',
  'ManaCost:no cost',
  'Colors:blue',
  'Types:Creature Human Insect',
  'PT:3/2',
  'K:Flying',
  'Oracle:Flying',
] as const;

const velomachus = [
  'Name:Velomachus Lorehold',
  'ManaCost:5 R W',
  'Types:Legendary Creature Elder Dragon',
  'PT:5/5',
  'K:Flying',
  'K:Vigilance',
  'K:Haste',
  "T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLook | TriggerDescription$ Whenever CARDNAME attacks, look at the top seven cards of your library. You may cast an instant or sorcery spell with mana value less than or equal to CARDNAME's power from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.",
  'SVar:TrigLook:DB$ PeekAndReveal | Defined$ You | PeekAmount$ 7 | NoReveal$ True | RememberPeeked$ True | SubAbility$ DBPlay | SpellDescription$ Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.',
  'SVar:DBPlay:DB$ Play | ValidZone$ Library | Valid$ Card.IsRemembered | ValidSA$ Instant.cmcLEX,Sorcery.cmcLEX | Controller$ You | WithoutManaCost$ True | Optional$ True | Amount$ 1 | ForgetPlayed$ True | SubAbility$ DBRestRandomOrder',
  'SVar:DBRestRandomOrder:DB$ ChangeZoneAll | ChangeType$ Card.IsRemembered | Origin$ Library | Destination$ Library | LibraryPosition$ -1 | RandomOrder$ True | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:X:Count$CardPower',
  'SVar:HasAttackEffect:TRUE',
  'SVar:PlayMain1:TRUE',
  'DeckNeeds:Type$Instant|Sorcery',
  "Oracle:Flying, vigilance, haste\\nWhenever Velomachus Lorehold attacks, look at the top seven cards of your library. You may cast an instant or sorcery spell with mana value less than or equal to Velomachus Lorehold's power from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.",
] as const;

describe('Legacy Cube reviewed PeekAndReveal cohort', () => {
  it.each([
    ['Delver of Secrets', delver],
    ['Velomachus Lorehold', velomachus],
  ] as const)('admits only the exact %s composition', (_name, script) => {
    expect(legacyCubeReviewedPeekAndRevealRefusals(bytes(script), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', delver.map((line) => line.replace('Name:Delver of Secrets', 'Name:Other'))],
    ['mandatory reveal', delver.map((line) => line.replace('RevealOptional$ True', 'RevealOptional$ False'))],
    [
      'another transform condition',
      delver.map((line) => line.replace('Card.Instant,Card.Sorcery', 'Card.Instant')),
    ],
    ['another alternate face', delver.map((line) => line.replace('PT:3/2', 'PT:4/2'))],
    ['another peek amount', velomachus.map((line) => line.replace('PeekAmount$ 7', 'PeekAmount$ 6'))],
    [
      'paid casting',
      velomachus.map((line) => line.replace('WithoutManaCost$ True', 'WithoutManaCost$ False')),
    ],
    ['mandatory casting', velomachus.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    ['ordered remainder', velomachus.map((line) => line.replace('RandomOrder$ True', 'RandomOrder$ False'))],
    [
      'another eligibility filter',
      velomachus.map((line) => line.replace('Instant.cmcLEX,Sorcery.cmcLEX', 'Instant')),
    ],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedPeekAndRevealRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
