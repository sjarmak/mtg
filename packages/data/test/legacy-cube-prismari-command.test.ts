import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedPrismariCommandRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const exact = [
  'Name:Prismari Command',
  'ManaCost:1 U R',
  'Types:Instant',
  'A:SP$ Charm | Choices$ DBShock,DBLoot,DBTreasure,DBShatter | CharmNum$ 2',
  'SVar:DBShock:DB$ DealDamage | ValidTgts$ Any | TgtPrompt$ Select any target to deal 2 damage to | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
  'SVar:DBLoot:DB$ Draw | NumCards$ 2 | ValidTgts$ Player | TgtPrompt$ Select target player to draw two cards, then discard two cards | Defined$ ThisTargetedPlayer | SubAbility$ DBDiscard | SpellDescription$ Target player draws two cards, then discards two cards.',
  'SVar:DBDiscard:DB$ Discard | Defined$ ParentTarget | NumCards$ 2 | Mode$ TgtChoose',
  'SVar:DBTreasure:DB$ Token | ValidTgts$ Player | TgtPrompt$ Select target player to create a Treasure token | TokenScript$ c_a_treasure_sac | TokenOwner$ ThisTargetedPlayer | SpellDescription$ Target player creates a Treasure token.',
  'SVar:DBShatter:DB$ Destroy | ValidTgts$ Artifact | TgtPrompt$ Select target artifact to destroy | Defined$ ThisTargetedCard | SpellDescription$ Destroy target artifact.',
  'DeckHas:Ability$Token',
  'Oracle:Choose two —\\n• Prismari Command deals 2 damage to any target.\\n• Target player draws two cards, then discards two cards.\\n• Target player creates a Treasure token.\\n• Destroy target artifact.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedPrismariCommandRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Prismari Command boundary', () => {
  it('admits only the exact two-distinct-mode targeted Treasure composition', () => {
    expect(refusal(exact)).toEqual([]);
  });

  it.each([
    ['identity', 'Name:Prismari Command', 'Name:Other Command'],
    ['mana cost', 'ManaCost:1 U R', 'ManaCost:U R'],
    ['mode count', 'CharmNum$ 2', 'CharmNum$ 3'],
    [
      'mode order',
      'Choices$ DBShock,DBLoot,DBTreasure,DBShatter',
      'Choices$ DBLoot,DBShock,DBTreasure,DBShatter',
    ],
    ['damage amount', 'NumDmg$ 2', 'NumDmg$ 3'],
    ['loot recipient', 'Defined$ ThisTargetedPlayer', 'Defined$ You'],
    ['discard count', 'NumCards$ 2 | Mode$ TgtChoose', 'NumCards$ 1 | Mode$ TgtChoose'],
    ['Treasure script', 'TokenScript$ c_a_treasure_sac', 'TokenScript$ c_a_treasure'],
    ['Treasure owner', 'TokenOwner$ ThisTargetedPlayer', 'TokenOwner$ You'],
    ['destroy filter', 'ValidTgts$ Artifact', 'ValidTgts$ Permanent'],
  ] as const)('refuses a changed %s', (_label, from, to) => {
    expect(refusal(exact.map((line) => line.replace(from, to)))).toContain(
      'exact reviewed Prismari Command composition',
    );
  });

  it('refuses extra script composition', () => {
    expect(refusal([...exact, 'SVar:Extra:DB$ Token | TokenScript$ c_a_treasure_sac'])).toContain(
      'exact reviewed Prismari Command composition',
    );
  });
});
