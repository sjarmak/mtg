import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedForetellRefusals, loadLegacyCubeSyntaxReview } from '../src/index';
import { generatedTokenScriptNames } from '../src/printed-card/token-references';

const STARNHEIM = [
  'Name:Starnheim Unleashed',
  'ManaCost:2 W W',
  'Types:Sorcery',
  'A:SP$ Token | TokenAmount$ Y | TokenScript$ w_4_4_angel_warrior_flying_vigilance | SpellDescription$ Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.',
  'SVar:Y:Count$Foretold.X.1',
  'SVar:X:Count$xPaid',
  'K:Foretell:X X W',
  'DeckHas:Ability$Token',
  'Oracle:Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.\\nForetell {X}{X}{W} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)',
] as const;

const ALRUNDS_EPIPHANY = [
  "Name:Alrund's Epiphany",
  'ManaCost:5 U U',
  'Types:Sorcery',
  'A:SP$ Token | TokenAmount$ 2 | TokenScript$ u_1_1_bird_flying | TokenOwner$ You | SubAbility$ DBAddTurn | SpellDescription$ Create two 1/1 blue Bird creature tokens with flying. Take an extra turn after this one. Exile CARDNAME.',
  'SVar:DBAddTurn:DB$ AddTurn | Defined$ You | NumTurns$ 1 | SubAbility$ DBChange | StackDescription$ None',
  'SVar:DBChange:DB$ ChangeZone | Origin$ Stack | Destination$ Exile | StackDescription$ None',
  'K:Foretell:4 U U',
  'DeckHas:Ability$Token',
  "Oracle:Create two 1/1 blue Bird creature tokens with flying. Take an extra turn after this one. Exile Alrund's Epiphany.\\nForetell {4}{U}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedForetellRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Foretell boundary', () => {
  it.each([
    ['Starnheim Unleashed', STARNHEIM, 'w_4_4_angel_warrior_flying_vigilance'],
    ["Alrund's Epiphany", ALRUNDS_EPIPHANY, 'u_1_1_bird_flying'],
  ] as const)('pins the exact generated-token root for %s', (_name, lines, token) => {
    expect(generatedTokenScriptNames(new TextEncoder().encode(`${lines.join('\n')}\n`))).toEqual([token]);
  });

  it.each([
    ['Starnheim Unleashed', STARNHEIM],
    ["Alrund's Epiphany", ALRUNDS_EPIPHANY],
  ] as const)('lifts the exact reviewed %s composition', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    ['Starnheim identity', STARNHEIM.map((line) => line.replace('Name:Starnheim Unleashed', 'Name:Other'))],
    ['Starnheim mana', STARNHEIM.map((line) => line.replace('ManaCost:2 W W', 'ManaCost:3 W'))],
    ['Starnheim token count', STARNHEIM.map((line) => line.replace('TokenAmount$ Y', 'TokenAmount$ X'))],
    [
      'Starnheim token root',
      STARNHEIM.map((line) =>
        line.replace('w_4_4_angel_warrior_flying_vigilance', 'w_4_4_angel_flying_vigilance'),
      ),
    ],
    ['Starnheim foretold branch', STARNHEIM.map((line) => line.replace('Foretold.X.1', 'Foretold.X.2'))],
    ['Starnheim X source', STARNHEIM.map((line) => line.replace('Count$xPaid', 'Count$ChosenX'))],
    ['Starnheim Foretell cost', STARNHEIM.map((line) => line.replace('K:Foretell:X X W', 'K:Foretell:X W'))],
    [
      'Epiphany identity',
      ALRUNDS_EPIPHANY.map((line) => line.replace("Name:Alrund's Epiphany", 'Name:Other')),
    ],
    ['Epiphany mana', ALRUNDS_EPIPHANY.map((line) => line.replace('ManaCost:5 U U', 'ManaCost:6 U'))],
    [
      'Epiphany token count',
      ALRUNDS_EPIPHANY.map((line) => line.replace('TokenAmount$ 2', 'TokenAmount$ 1')),
    ],
    ['Epiphany token root', ALRUNDS_EPIPHANY.map((line) => line.replace('u_1_1_bird_flying', 'u_1_1_bird'))],
    ['Epiphany extra turns', ALRUNDS_EPIPHANY.map((line) => line.replace('NumTurns$ 1', 'NumTurns$ 2'))],
    [
      'Epiphany spell destination',
      ALRUNDS_EPIPHANY.map((line) => line.replace('Destination$ Exile', 'Destination$ Graveyard')),
    ],
    [
      'Epiphany Foretell cost',
      ALRUNDS_EPIPHANY.map((line) => line.replace('K:Foretell:4 U U', 'K:Foretell:5 U')),
    ],
    ['additional line', [...ALRUNDS_EPIPHANY, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ] as const)('keeps hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Foretell composition');
  });
});
