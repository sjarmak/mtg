import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCounterUnlessCostRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const scripts = [
  [
    'Name:Mana Tithe',
    'ManaCost:W',
    'Types:Instant',
    'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 1 | SpellDescription$ Counter target spell unless its controller pays {1}.',
    'Oracle:Counter target spell unless its controller pays {1}.',
  ],
  [
    'Name:Pact of Negation',
    'ManaCost:0',
    'Colors:blue',
    'Types:Instant',
    "A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | SubAbility$ DBDelTrig | SpellDescription$ Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
    "SVar:DBDelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigLoseGame | TriggerDescription$ At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
    'SVar:TrigLoseGame:DB$ LosesGame | UnlessCost$ 3 U U | UnlessPayer$ You | Defined$ You',
    'SVar:NeedsToPlayVar:NumLands GE5',
    'SVar:NumLands:Count$Valid Land.YouCtrl',
    'AI:RemoveDeck:All',
    "Oracle:Counter target spell.\\nAt the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
  ],
  [
    'Name:Mana Leak',
    'ManaCost:1 U',
    'Types:Instant',
    'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 3 | SpellDescription$ Counter target spell unless its controller pays {3}.',
    'Oracle:Counter target spell unless its controller pays {3}.',
  ],
  [
    'Name:Supreme Will',
    'ManaCost:2 U',
    'Types:Instant',
    'A:SP$ Charm | Choices$ DBCounter,DBDig | Defined$ You',
    'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | UnlessCost$ 3 | SpellDescription$ Counter target spell unless its controller pays {3}.',
    'SVar:DBDig:DB$ Dig | DigNum$ 4 | ChangeNum$ 1 | NoReveal$ True | SpellDescription$ Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
    'Oracle:Choose one —\\n• Counter target spell unless its controller pays {3}.\\n• Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
  ],
] as const;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedCounterUnlessCostRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed counter UnlessCost boundary', () => {
  it.each(scripts.map((script) => [script] as const))(
    'admits only exact whole-card counter compositions',
    (exact) => {
      expect(refusal(exact)).toEqual([]);
      for (const mutation of [
        exact.map((line) => line.replace(/^Name:.*/u, 'Name:Other')),
        exact.map((line) => line.replace('TargetType$ Spell', 'TargetType$ Ability')),
        exact.map((line) => line.replace('UnlessCost$ 3', 'UnlessCost$ 4')),
        exact.map((line) => line.replace('UnlessCost$ 1', 'UnlessCost$ 2')),
        exact.map((line) => line.replace('UnlessPayer$ You', 'UnlessPayer$ Opponent')),
        [...exact, 'SVar:Extra:DB$ Counter | TargetType$ Spell | UnlessCost$ 1'],
      ]) {
        if (mutation.join('\n') === exact.join('\n')) continue;
        expect(refusal(mutation)).toContain('exact reviewed counter UnlessCost composition');
      }
    },
  );
});
