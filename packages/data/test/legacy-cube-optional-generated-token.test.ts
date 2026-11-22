import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedOptionalGeneratedTokenRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const SCRIPTS = {
  'Emeria Angel': [
    'Name:Emeria Angel',
    'ManaCost:2 W W',
    'Types:Creature Angel',
    'PT:3/3',
    'K:Flying',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | Execute$ TrigToken | OptionalDecider$ You | TriggerDescription$ Landfall — Whenever a land you control enters, you may create a 1/1 white Bird creature token with flying.',
    'SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_bird_flying | TokenOwner$ You',
    'Oracle:Flying\\nLandfall — Whenever a land you control enters, you may create a 1/1 white Bird creature token with flying.',
  ],
  'Awakening Zone': [
    'Name:Awakening Zone',
    'ManaCost:2 G',
    'Types:Enchantment',
    'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigToken | TriggerDescription$ At the beginning of your upkeep, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."',
    'SVar:TrigToken:DB$ Token | TokenScript$ c_0_1_eldrazi_spawn_sac | TokenOwner$ You',
    'DeckHints:Type$Eldrazi',
    'DeckHas:Ability$Mana.Colorless|Token',
    'Oracle:At the beginning of your upkeep, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."',
  ],
  'Avenger of Zendikar': [
    'Name:Avenger of Zendikar',
    'ManaCost:5 G G',
    'Types:Creature Elemental',
    'PT:5/5',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 0/1 green Plant creature token for each land you control.',
    'SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ g_0_1_plant | TokenOwner$ You',
    'SVar:X:Count$Valid Land.YouCtrl',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | Execute$ TrigPutCounterAll | OptionalDecider$ You | TriggerDescription$ Landfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    'SVar:TrigPutCounterAll:DB$ PutCounterAll | ValidCards$ Creature.Plant+YouCtrl | CounterType$ P1P1 | CounterNum$ 1 | AILogic$ Always',
    'SVar:BuffedBy:Land',
    'Oracle:When Avenger of Zendikar enters, create a 0/1 green Plant creature token for each land you control.\\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
  ],
} as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedOptionalGeneratedTokenRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube exact optional-trigger generated-token boundary', () => {
  it.each(Object.entries(SCRIPTS))('admits the exact %s composition', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    [
      'identity',
      SCRIPTS['Emeria Angel'].map((line) => line.replace('Name:Emeria Angel', 'Name:Emeria Archangel')),
    ],
    [
      'foreign decider',
      SCRIPTS['Emeria Angel'].map((line) =>
        line.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent'),
      ),
    ],
    [
      'Bird identity',
      SCRIPTS['Emeria Angel'].map((line) => line.replace('w_1_1_bird_flying', 'u_1_1_bird_flying')),
    ],
    [
      'Spawn owner',
      SCRIPTS['Awakening Zone'].map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent')),
    ],
    [
      'Plant amount',
      SCRIPTS['Avenger of Zendikar'].map((line) => line.replace('TokenAmount$ X', 'TokenAmount$ 1')),
    ],
    [
      'Plant counter amount',
      SCRIPTS['Avenger of Zendikar'].map((line) => line.replace('CounterNum$ 1', 'CounterNum$ 2')),
    ],
    ['removed line', SCRIPTS['Awakening Zone'].filter((line) => !line.startsWith('DeckHints:'))],
    ['additional line', [...SCRIPTS['Avenger of Zendikar'], 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps a hostile %s mutation closed', (_label, lines) => {
    expect(refusal(lines)).toContain('exact reviewed optional generated-token composition');
  });
});
