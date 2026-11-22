import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedOptionalLibrarySearchRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const script = (name: string, lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode([`Name:${name}`, 'ManaCost:2 W', ...lines].join('\n'));

const reviewed = [
  [
    'Stoneforge Mystic',
    [
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
      'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Card.Equipment | ChangeNum$ 1 | ShuffleNonMandatory$ True',
    ],
  ],
  [
    'Land Tax',
    [
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigChange | CheckSVar$ Y | SVarCompare$ GTX',
      'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | ChangeNum$ 3 | ShuffleNonMandatory$ True',
    ],
  ],
  [
    'Primeval Titan',
    [
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
      'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigChange | TriggerZones$ Battlefield | OptionalDecider$ You | Secondary$ True',
      'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land | ChangeNum$ 2 | ShuffleNonMandatory$ True',
    ],
  ],
  [
    'Solemn Simulacrum',
    [
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
      'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | ShuffleNonMandatory$ True',
      'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigDraw | OptionalDecider$ TriggeredCardController',
    ],
  ],
  [
    'Golos, Tireless Pilgrim',
    [
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigChange',
      'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land | ChangeNum$ 1 | ShuffleNonMandatory$ True',
    ],
  ],
] as const;

describe('Legacy Cube optional library-search boundary', () => {
  it.each(reviewed)('admits the exact reviewed %s route', (name, lines) => {
    expect(legacyCubeReviewedOptionalLibrarySearchRefusals(script(name, lines), inventory)).toEqual([]);
  });

  it.each(reviewed)('refuses a shuffle-shape mutation of %s', (name, lines) => {
    const mutated = lines.map((line) =>
      line.includes('ShuffleNonMandatory$ True')
        ? line.replace('ShuffleNonMandatory$ True', 'ShuffleNonMandatory$ False')
        : line,
    );
    expect(legacyCubeReviewedOptionalLibrarySearchRefusals(script(name, mutated), inventory)).not.toEqual([]);
  });

  it.each(reviewed)('refuses an added foreign decider on %s', (name, lines) => {
    expect(
      legacyCubeReviewedOptionalLibrarySearchRefusals(
        script(name, [
          ...lines,
          'T:Mode$ Phase | Phase$ Upkeep | OptionalDecider$ Opponent | Execute$ Other',
        ]),
        inventory,
      ),
    ).not.toEqual([]);
  });

  it('does not grant an exact route to a different identity', () => {
    expect(
      legacyCubeReviewedOptionalLibrarySearchRefusals(
        script('Unreviewed Searcher', reviewed[0][1]),
        inventory,
      ),
    ).toContain('exact reviewed optional library-search composition');
  });
});
