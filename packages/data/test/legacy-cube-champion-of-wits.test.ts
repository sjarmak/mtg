import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedChampionOfWitsRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const CHAMPION = String.raw`Name:Champion of Wits
ManaCost:2 U
Types:Creature Snake Wizard
PT:2/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When CARDNAME enters, you may draw cards equal to its power. If you do, discard two cards.
SVar:TrigDraw:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 2 | Cost$ Draw<X/You>
K:Eternalize:5 U U
SVar:X:Count$CardPower
Oracle:When Champion of Wits enters, you may draw cards equal to its power. If you do, discard two cards.\nEternalize {5}{U}{U} ({5}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Wizard with no mana cost. Eternalize only as a sorcery.)`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string) =>
  legacyCubeReviewedChampionOfWitsRefusals(new TextEncoder().encode(`${script}\n`), inventory);

describe('Legacy Cube reviewed Champion of Wits boundary', () => {
  it('admits only the exact power-sized draw cost and discard-two trigger', () => {
    expect(refusal(CHAMPION)).toEqual([]);
    for (const mutation of [
      CHAMPION.replace('Name:Champion of Wits', 'Name:Other Champion'),
      CHAMPION.replace('Origin$ Any', 'Origin$ Hand'),
      CHAMPION.replace('Destination$ Battlefield', 'Destination$ Graveyard'),
      CHAMPION.replace('ValidCard$ Card.Self', 'ValidCard$ Creature.YouCtrl'),
      CHAMPION.replace('NumCards$ 2', 'NumCards$ 1'),
      CHAMPION.replace('Cost$ Draw<X/You>', 'Cost$ Draw<2/You>'),
      CHAMPION.replace('SVar:X:Count$CardPower', 'SVar:X:Count$CardToughness'),
      `${CHAMPION}\nSVar:Extra:DB$ Draw | NumCards$ 1`,
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Champion of Wits composition');
    }
  });

  it('admits only the exact Eternalize cost on the same complete script', () => {
    expect(refusal(CHAMPION)).toEqual([]);
    for (const mutation of [
      CHAMPION.replace('K:Eternalize:5 U U', 'K:Eternalize:4 U U'),
      CHAMPION.replace('K:Eternalize:5 U U', 'K:Embalm:5 U U'),
      CHAMPION.replace('PT:2/1', 'PT:3/1'),
      CHAMPION.replace('Types:Creature Snake Wizard', 'Types:Creature Human Wizard'),
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Champion of Wits composition');
    }
  });
});
