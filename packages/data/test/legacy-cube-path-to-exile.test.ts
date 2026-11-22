import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPathToExileRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Path to Exile',
  'ManaCost:W',
  'Types:Instant',
  'A:SP$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature | SubAbility$ DBChange | StackDescription$ Exile {c:Targeted}. {p:TargetedController} may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle their library. | SpellDescription$ Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  'SVar:DBChange:DB$ ChangeZone | Optional$ True | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | DefinedPlayer$ TargetedController | ShuffleNonMandatory$ True | StackDescription$ None',
  'Oracle:Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedPathToExileRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Path to Exile boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Path to Exile', 'Name:Near Path'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:W', 'ManaCost:1 W'))],
    ['card type', EXACT.map((line) => line.replace('Types:Instant', 'Types:Sorcery'))],
    ['root origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    ['root destination', EXACT.map((line) => line.replace('Destination$ Exile', 'Destination$ Hand'))],
    ['target domain', EXACT.map((line) => line.replace('ValidTgts$ Creature', 'ValidTgts$ Permanent'))],
    ['subability topology', EXACT.map((line) => line.replace('SubAbility$ DBChange', 'SubAbility$ Other'))],
    ['search optionality', EXACT.map((line) => line.replace('Optional$ True', 'Optional$ False'))],
    ['search origin', EXACT.map((line) => line.replace('Origin$ Library', 'Origin$ Graveyard'))],
    [
      'search destination',
      EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand')),
    ],
    ['tapped flag', EXACT.map((line) => line.replace('Tapped$ True', 'Tapped$ False'))],
    ['basic-land filter', EXACT.map((line) => line.replace('ChangeType$ Land.Basic', 'ChangeType$ Land'))],
    [
      'fetcher and decider',
      EXACT.map((line) => line.replace('DefinedPlayer$ TargetedController', 'DefinedPlayer$ You')),
    ],
    [
      'shuffle rule',
      EXACT.map((line) => line.replace('ShuffleNonMandatory$ True', 'ShuffleNonMandatory$ False')),
    ],
    ['Oracle text', EXACT.map((line) => line.replace('Exile target creature.', 'Destroy target creature.'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Path to Exile composition');
  });
});
