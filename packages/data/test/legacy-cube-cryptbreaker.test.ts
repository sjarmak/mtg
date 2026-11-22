import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCryptbreakerRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Cryptbreaker',
  'ManaCost:B',
  'Types:Creature Zombie',
  'PT:1/1',
  'A:AB$ Token | Cost$ 1 B T Discard<1/Card> | TokenScript$ b_2_2_zombie | TokenOwner$ You | SpellDescription$ Create a 2/2 black Zombie creature token.',
  'A:AB$ Draw | Cost$ tapXType<3/Zombie> | NumCards$ 1 | AILogic$ AtOppEOT | SpellDescription$ You draw a card and you lose 1 life. | SubAbility$ DBLoseLife',
  'SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 1',
  'SVar:AIPreference:DiscardCost$Card',
  'AI:RemoveDeck:Random',
  'DeckHas:Ability$Token',
  'DeckNeeds:Type$Zombie',
  'Oracle:{1}{B}, {T}, Discard a card: Create a 2/2 black Zombie creature token.\\nTap three untapped Zombies you control: You draw a card and you lose 1 life.',
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedCryptbreakerRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Cryptbreaker boundary', () => {
  it('admits only the exact discard-token and tap-three-Zombies draw/life-loss composition', () => {
    expect(refusal(EXACT)).toEqual([]);
    for (const mutation of [
      EXACT.map((line) => line.replace('Name:Cryptbreaker', 'Name:Other Zombie')),
      EXACT.map((line) => line.replace('Types:Creature Zombie', 'Types:Creature Human')),
      EXACT.map((line) => line.replace('PT:1/1', 'PT:2/2')),
      EXACT.map((line) => line.replace('Cost$ 1 B T Discard<1/Card>', 'Cost$ B T Discard<1/Card>')),
      EXACT.map((line) => line.replace('Discard<1/Card>', 'Discard<2/Card>')),
      EXACT.map((line) => line.replace('TokenScript$ b_2_2_zombie', 'TokenScript$ b_2_2_vampire')),
      EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent')),
      EXACT.map((line) => line.replace('tapXType<3/Zombie>', 'tapXType<2/Zombie>')),
      EXACT.map((line) => line.replace('tapXType<3/Zombie>', 'tapXType<3/Creature>')),
      EXACT.map((line) => line.replace('NumCards$ 1', 'NumCards$ 2')),
      EXACT.map((line) => line.replace('SubAbility$ DBLoseLife', 'SubAbility$ Other')),
      EXACT.map((line) => line.replace('LifeAmount$ 1', 'LifeAmount$ 2')),
      EXACT.filter((line) => !line.startsWith('SVar:DBLoseLife:')),
      EXACT.filter((line) => !line.startsWith('A:AB$ Draw')),
      [...EXACT, 'SVar:Extra:DB$ Draw | NumCards$ 1'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Cryptbreaker composition');
    }
  });
});
