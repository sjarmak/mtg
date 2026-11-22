import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedSatyrWayfinderRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Satyr Wayfinder',
  'ManaCost:1 G',
  'Types:Creature Satyr',
  'PT:1/1',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig | TriggerDescription$ When CARDNAME enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.',
  'SVar:TrigDig:DB$ Dig | DigNum$ 4 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Land | DestinationZone2$ Graveyard | Optional$ True',
  'Oracle:When Satyr Wayfinder enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedSatyrWayfinderRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Satyr Wayfinder boundary', () => {
  it('lifts exactly the optional four-card land Dig composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Satyr Wayfinder', 'Name:Other'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 G', 'ManaCost:G'))],
    ['trigger root', EXACT.map((line) => line.replace('T:Mode$ ChangesZone', 'T:Mode$ Phase'))],
    ['Dig API', EXACT.map((line) => line.replace('DB$ Dig', 'DB$ Draw'))],
    ['DigNum', EXACT.map((line) => line.replace('DigNum$ 4', 'DigNum$ 5'))],
    ['public reveal', EXACT.map((line) => line.replace('Reveal$ True', 'Reveal$ False'))],
    ['selection count', EXACT.map((line) => line.replace('ChangeNum$ 1', 'ChangeNum$ 2'))],
    ['selection filter', EXACT.map((line) => line.replace('ChangeValid$ Land', 'ChangeValid$ Card'))],
    [
      'remainder destination',
      EXACT.map((line) => line.replace('DestinationZone2$ Graveyard', 'DestinationZone2$ Exile')),
    ],
    ['optional choice', EXACT.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Satyr Wayfinder composition');
  });
});
