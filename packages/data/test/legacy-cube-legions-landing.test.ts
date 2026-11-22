import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedLegionsLandingRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  "Name:Legion's Landing",
  'ManaCost:W',
  'Types:Legendary Enchantment',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 1/1 white Vampire creature token with lifelink.',
  'SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_vampire_lifelink | TokenOwner$ You',
  'T:Mode$ AttackersDeclared | Execute$ DBTransform | ValidAttackers$ Creature | ValidAttackersAmount$ GE3 | TriggerZones$ Battlefield | AttackingPlayer$ You | TriggerDescription$ When you attack with three or more creatures, transform CARDNAME.',
  'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
  'AlternateMode:DoubleFaced',
  "Oracle:When Legion's Landing enters, create a 1/1 white Vampire creature token with lifelink.\\nWhen you attack with three or more creatures, transform Legion's Landing.",
  '',
  'ALTERNATE',
  '',
  'Name:Adanto, the First Fort',
  'ManaCost:no cost',
  'Types:Legendary Land',
  'A:AB$ Mana | Cost$ T | Produced$ W | Amount$ 1 | SpellDescription$ Add {W}.',
  'A:AB$ Token | Cost$ 2 W T | TokenScript$ w_1_1_vampire_lifelink | TokenOwner$ You | SpellDescription$ Create a 1/1 white Vampire creature token with lifelink.',
  "Oracle:(Transforms from Legion's Landing.)\\n{T}: Add {W}.\\n{2}{W}, {T}: Create a 1/1 white Vampire creature token with lifelink.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedLegionsLandingRefusals(Buffer.from(lines.join('\n')), syntax);

describe("Legacy Cube reviewed Legion's Landing boundary", () => {
  it('admits only the exact complete installed double-faced script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['front identity', EXACT.map((line) => line.replace("Name:Legion's Landing", 'Name:Near Landing'))],
    ['front mana cost', EXACT.map((line) => line.replace('ManaCost:W', 'ManaCost:1 W'))],
    ['front type', EXACT.map((line) => line.replace('Types:Legendary Enchantment', 'Types:Enchantment'))],
    ['entry mode', EXACT.map((line) => line.replace('Mode$ ChangesZone', 'Mode$ Phase'))],
    ['entry origin', EXACT.map((line) => line.replace('Origin$ Any', 'Origin$ Stack'))],
    ['entry destination', EXACT.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand'))],
    ['entry subject', EXACT.map((line) => line.replace('ValidCard$ Card.Self', 'ValidCard$ Card.YouCtrl'))],
    ['entry execute', EXACT.map((line) => line.replace('Execute$ TrigToken', 'Execute$ OtherToken'))],
    ['entry token API', EXACT.map((line) => line.replace('TrigToken:DB$ Token', 'TrigToken:DB$ Draw'))],
    [
      'entry token identity',
      EXACT.map((line) => line.replace('TokenScript$ w_1_1_vampire_lifelink', 'TokenScript$ w_1_1_soldier')),
    ],
    ['entry token owner', EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent'))],
    ['attack trigger mode', EXACT.map((line) => line.replace('Mode$ AttackersDeclared', 'Mode$ Attacks'))],
    ['attack execute', EXACT.map((line) => line.replace('Execute$ DBTransform', 'Execute$ OtherTransform'))],
    ['attacker filter', EXACT.map((line) => line.replace('ValidAttackers$ Creature', 'ValidAttackers$ Any'))],
    [
      'attack threshold',
      EXACT.map((line) => line.replace('ValidAttackersAmount$ GE3', 'ValidAttackersAmount$ GE2')),
    ],
    [
      'trigger zone',
      EXACT.map((line) => line.replace('TriggerZones$ Battlefield', 'TriggerZones$ Graveyard')),
    ],
    [
      'attacking player',
      EXACT.map((line) => line.replace('AttackingPlayer$ You', 'AttackingPlayer$ Opponent')),
    ],
    [
      'state API',
      EXACT.map((line) => line.replace('DBTransform:DB$ SetState', 'DBTransform:DB$ ChangeZone')),
    ],
    ['state subject', EXACT.map((line) => line.replace('Defined$ Self', 'Defined$ You'))],
    ['state mode', EXACT.map((line) => line.replace('Mode$ Transform', 'Mode$ TurnFaceUp'))],
    [
      'alternate marker',
      EXACT.map((line) => line.replace('AlternateMode:DoubleFaced', 'AlternateMode:Split')),
    ],
    ['back identity', EXACT.map((line) => line.replace('Name:Adanto, the First Fort', 'Name:Near Fort'))],
    ['back mana cost', EXACT.map((line) => line.replace('ManaCost:no cost', 'ManaCost:W'))],
    ['back type', EXACT.map((line) => line.replace('Types:Legendary Land', 'Types:Land'))],
    ['mana API', EXACT.map((line) => line.replace('A:AB$ Mana', 'A:AB$ Draw'))],
    ['mana tap cost', EXACT.map((line) => line.replace('Cost$ T | Produced$ W', 'Cost$ 1 | Produced$ W'))],
    ['produced color', EXACT.map((line) => line.replace('Produced$ W', 'Produced$ U'))],
    ['produced amount', EXACT.map((line) => line.replace('Amount$ 1', 'Amount$ 2'))],
    ['token API', EXACT.map((line) => line.replace('A:AB$ Token', 'A:AB$ Draw'))],
    ['token mana cost', EXACT.map((line) => line.replace('Cost$ 2 W T', 'Cost$ 3 W T'))],
    ['token tap cost', EXACT.map((line) => line.replace('Cost$ 2 W T', 'Cost$ 2 W'))],
    [
      'activated token identity',
      EXACT.map((line) =>
        line.startsWith('A:AB$ Token') ? line.replace('w_1_1_vampire_lifelink', 'w_1_1_soldier') : line,
      ),
    ],
    [
      'activated token owner',
      EXACT.map((line) =>
        line.startsWith('A:AB$ Token') ? line.replace('TokenOwner$ You', 'TokenOwner$ Opponent') : line,
      ),
    ],
    ['Oracle text', EXACT.map((line) => line.replace('three or more creatures', 'two or more creatures'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ] as const)('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain("exact reviewed Legion's Landing composition");
  });
});
