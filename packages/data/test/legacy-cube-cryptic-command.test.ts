import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCrypticCommandRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Cryptic Command',
  'ManaCost:1 U U U',
  'Types:Instant',
  'A:SP$ Charm | Choices$ DBCounter,DBReturn,DBTapAll,DBDraw | CharmNum$ 2',
  'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter target spell.',
  "SVar:DBReturn:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Permanent | AILogic$ Good | SpellDescription$ Return target permanent to its owner's hand.",
  'SVar:DBTapAll:DB$ TapAll | ValidCards$ Creature.OppCtrl | AILogic$ AtLeast3 | SpellDescription$ Tap all creatures your opponents control.',
  'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.',
  "Oracle:Choose two —\\n• Counter target spell.\\n• Return target permanent to its owner's hand.\\n• Tap all creatures your opponents control.\\n• Draw a card.",
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedCrypticCommandRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Cryptic Command boundary', () => {
  it('admits only the exact two-mode Stack-target script', () => {
    expect(refusal(exact)).toEqual([]);
    for (const mutation of [
      exact.map((line) => line.replace('Name:Cryptic Command', 'Name:Other')),
      exact.map((line) => line.replace('CharmNum$ 2', 'CharmNum$ 1')),
      exact.map((line) => line.replace('TargetType$ Spell', 'TargetType$ Ability')),
      [...exact, 'SVar:Extra:DB$ ChangeTargets'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Cryptic Command composition');
    }
  });
});
