import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedReveillarkRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Reveillark',
  'ManaCost:4 W',
  'Types:Creature Elemental',
  'PT:4/3',
  'K:Flying',
  'K:Evoke:5 W',
  'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturnCreatures | TriggerDescription$ When CARDNAME leaves the battlefield, return up to two target creature cards with power 2 or less from your graveyard to the battlefield.',
  'SVar:TrigReturnCreatures:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetMin$ 0 | TargetMax$ 2 | ValidTgts$ Creature.powerLE2 | TargetsWithDefinedController$ TriggeredCardController | TgtPrompt$ Choose target creature',
  'SVar:NeedsToPlayEvokedVar:Z GE2',
  'SVar:Z:Count$ValidGraveyard Creature.YouCtrl+powerLE2',
  "Oracle:Flying\\nWhen Reveillark leaves the battlefield, return up to two target creature cards with power 2 or less from your graveyard to the battlefield.\\nEvoke {5}{W} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedReveillarkRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Reveillark boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Reveillark', 'Name:Nearlark'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:4 W', 'ManaCost:3 W'))],
    ['type', EXACT.map((line) => line.replace('Types:Creature Elemental', 'Types:Creature Bird'))],
    ['power', EXACT.map((line) => line.replace('PT:4/3', 'PT:3/3'))],
    ['toughness', EXACT.map((line) => line.replace('PT:4/3', 'PT:4/4'))],
    ['Flying', EXACT.map((line) => line.replace('K:Flying', 'K:Vigilance'))],
    ['Evoke spelling', EXACT.map((line) => line.replace('K:Evoke:5 W', 'K:Dash:5 W'))],
    ['Evoke cost', EXACT.map((line) => line.replace('K:Evoke:5 W', 'K:Evoke:4 W'))],
    ['trigger mode', EXACT.map((line) => line.replace('Mode$ ChangesZone', 'Mode$ Phase'))],
    ['trigger origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    ['trigger destination', EXACT.map((line) => line.replace('Destination$ Any', 'Destination$ Graveyard'))],
    ['trigger subject', EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Card.YouCtrl'))],
    [
      'trigger execute',
      EXACT.map((line) => line.replace('Execute$ TrigReturnCreatures', 'Execute$ OtherReturn')),
    ],
    [
      'return API',
      EXACT.map((line) => line.replace('TrigReturnCreatures:DB$ ChangeZone', 'TrigReturnCreatures:DB$ Draw')),
    ],
    [
      'return origin',
      EXACT.map((line) =>
        line.startsWith('SVar:TrigReturnCreatures:')
          ? line.replace('Origin$ Graveyard', 'Origin$ Exile')
          : line,
      ),
    ],
    [
      'return destination',
      EXACT.map((line) =>
        line.startsWith('SVar:TrigReturnCreatures:')
          ? line.replace('Destination$ Battlefield', 'Destination$ Hand')
          : line,
      ),
    ],
    ['target minimum', EXACT.map((line) => line.replace('TargetMin$ 0', 'TargetMin$ 1'))],
    ['target maximum', EXACT.map((line) => line.replace('TargetMax$ 2', 'TargetMax$ 3'))],
    ['target type', EXACT.map((line) => line.replace('ValidTgts$ Creature.powerLE2', 'ValidTgts$ Card'))],
    ['target power', EXACT.map((line) => line.replace('Creature.powerLE2', 'Creature.powerLE3'))],
    [
      'target controller',
      EXACT.map((line) =>
        line.replace(
          'TargetsWithDefinedController$ TriggeredCardController',
          'TargetsWithDefinedController$ You',
        ),
      ),
    ],
    [
      'target prompt',
      EXACT.map((line) => line.replace('TgtPrompt$ Choose target creature', 'TgtPrompt$ Choose card')),
    ],
    [
      'AI helper variable',
      EXACT.map((line) => line.replace('NeedsToPlayEvokedVar:Z GE2', 'NeedsToPlayEvokedVar:Z GE1')),
    ],
    ['AI count zone', EXACT.map((line) => line.replace('Count$ValidGraveyard', 'Count$ValidBattlefield'))],
    ['AI count type', EXACT.map((line) => line.replace('Creature.YouCtrl', 'Permanent.YouCtrl'))],
    ['AI count power', EXACT.map((line) => line.replace('YouCtrl+powerLE2', 'YouCtrl+powerLE3'))],
    [
      'Oracle text',
      EXACT.map((line) =>
        line.replace('return up to two target creature cards', 'return target creature card'),
      ),
    ],
    ['ordering', [EXACT[1]!, EXACT[0]!, ...EXACT.slice(2)]],
    ['missing line', EXACT.filter((line) => line !== 'K:Flying')],
    ['extra syntax', [...EXACT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });
});
