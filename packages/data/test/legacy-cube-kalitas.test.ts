import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedKalitasRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Kalitas, Traitor of Ghet',
  'ManaCost:2 B B',
  'Types:Legendary Creature Vampire Warrior',
  'PT:3/4',
  'K:Lifelink',
  'R:Event$ Moved | ActiveZones$ Battlefield | Origin$ Battlefield | Destination$ Graveyard | ValidLKI$ Creature.!token+OppCtrl | ReplaceWith$ Exile | Description$ If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.',
  'SVar:Exile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBToken | Defined$ ReplacedCard',
  'SVar:DBToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenOwner$ You',
  'A:AB$ PutCounter | Cost$ 2 B Sac<1/Vampire.Other;Zombie.Other/another Vampire or Zombie> | CounterType$ P1P1 | CounterNum$ 2 | SpellDescription$ Put two +1/+1 counters on CARDNAME.',
  'Oracle:Lifelink\\nIf a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.\\n{2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas, Traitor of Ghet.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedKalitasRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Kalitas boundary', () => {
  it('admits only the exact replacement, Zombie, sacrifice, and counter composition', () => {
    expect(refusal(exact)).toEqual([]);
  });

  it.each([
    ['identity', 'Name:Kalitas, Traitor of Ghet', 'Name:Other Kalitas'],
    ['replacement origin', 'Origin$ Battlefield', 'Origin$ Graveyard'],
    ['replacement destination', 'Destination$ Graveyard', 'Destination$ Exile'],
    ['replacement filter', 'Creature.!token+OppCtrl', 'Creature.OppCtrl'],
    ['replacement result', 'ReplaceWith$ Exile', 'ReplaceWith$ DBToken'],
    ['changed object', 'Defined$ ReplacedCard', 'Defined$ Self'],
    ['token script', 'TokenScript$ b_2_2_zombie', 'TokenScript$ b_1_1_zombie'],
    ['token owner', 'TokenOwner$ You', 'TokenOwner$ Opponent'],
    [
      'sacrifice type',
      'Vampire.Other;Zombie.Other/another Vampire or Zombie',
      'Creature.Other/another creature',
    ],
    ['counter type', 'CounterType$ P1P1', 'CounterType$ LOYALTY'],
    ['counter amount', 'CounterNum$ 2', 'CounterNum$ 3'],
  ] as const)('refuses a changed %s', (_label, from, to) => {
    expect(refusal(exact.map((line) => line.replace(from, to)))).toContain(
      'exact reviewed Kalitas composition',
    );
  });

  it('refuses extra script composition', () => {
    expect(refusal([...exact, 'A:AB$ Draw | Cost$ T | NumCards$ 1'])).toContain(
      'exact reviewed Kalitas composition',
    );
  });
});
