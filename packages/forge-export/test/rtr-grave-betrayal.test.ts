/** Grave Betrayal against Forge's installed delayed-return script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const GRAVE_BETRAYAL = parseCard({
  kind: 'enchantment',
  id: 'rtr-067-grave-betrayal-forge',
  name: 'Grave Betrayal',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 67 },
  manaCost: { generic: 5, B: 2 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureDies',
      effects: [],
      opponentCreatureDiesReturnAtNextEndStep: {
        control: 'you',
        counter: 'plusOnePlusOne',
        count: 1,
        alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
      },
    },
  ],
});

describe('RTR #67 Grave Betrayal Forge export', () => {
  it('writes the installed opponent-death, delayed return, counter, and animation chain exactly', () => {
    const script = mustTranspile(GRAVE_BETRAYAL);
    expect(script).toContain(
      "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouDontCtrl | TriggerZones$ Battlefield | Execute$ DelTrig | TriggerDescription$ Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.",
    );
    expect(script).toContain(
      'SVar:DelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ GBReturn | RememberObjects$ TriggeredNewCardLKICopy | TriggerDescription$ Return creature to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. It is a black Zombie in addition to its other colors and types.',
    );
    expect(script).toContain(
      'SVar:GBReturn:DB$ ChangeZone | Defined$ DelayTriggerRememberedLKI | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | WithCountersType$ P1P1 | StaticEffect$ Animate',
    );
    expect(script).toContain(
      'SVar:Animate:Mode$ Continuous | Affected$ Card.IsRemembered | AddType$ Zombie | AddColor$ Black',
    );
  });
});
