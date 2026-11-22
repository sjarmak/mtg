/** Source-pinned Forge parity for M13's conditional combat cluster. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function scriptFor(input: Parameters<typeof parseCard>[0]): string {
  const result = transpileCard(parseCard(input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.rejections.map((rejection) => rejection.message).join('\n'));
  return result.script.text;
}

describe('M13 conditional combat Forge parity', () => {
  it("matches War Falcon's shipped alternative subtype restriction", () => {
    const text = scriptFor({
      kind: 'creature',
      id: 'tst-war-falcon',
      name: 'War Falcon',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 38 },
      colors: ['W'],
      manaCost: { W: 1 },
      power: 2,
      toughness: 1,
      subtypes: ['Bird'],
      keywords: ['flying'],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          enabledWhile: {
            kind: 'controlsNoneOfSubtypes',
            subtypes: ['Knight', 'Soldier'],
          },
          modification: { kind: 'cantAttack' },
        },
      ],
    });

    expect(text).toContain(
      "S:Mode$ CantAttack | ValidCard$ Card.Self | IsPresent$ Knight.YouCtrl,Soldier.YouCtrl | PresentCompare$ EQ0 | Description$ CARDNAME can't attack unless you control a Knight or a Soldier.",
    );
  });

  it("matches Slumbering Dragon's combined restriction and attack trigger", () => {
    const text = scriptFor({
      kind: 'creature',
      id: 'tst-slumbering-dragon',
      name: 'Slumbering Dragon',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 148 },
      colors: ['R'],
      manaCost: { R: 1 },
      power: 3,
      toughness: 3,
      subtypes: ['Dragon'],
      keywords: ['flying'],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          enabledWhile: {
            kind: 'selfCounterCountBelow',
            counter: 'plusOnePlusOne',
            fewerThan: 5,
          },
          modification: { kind: 'cantAttackOrBlock' },
        },
        {
          kind: 'triggered',
          condition: 'creatureAttacksYouOrPlaneswalkerYouControl',
          effects: [
            {
              kind: 'putCounters',
              counter: 'plusOnePlusOne',
              count: 1,
              target: { kind: 'selfCreature' },
            },
          ],
        },
      ],
    });

    expect(text).toContain(
      "S:Mode$ CantAttack,CantBlock | ValidCard$ Card.Self | CheckSVar$ X | SVarCompare$ LT5 | Description$ CARDNAME can't attack or block unless it has five or more +1/+1 counters on it.",
    );
    expect(text).toContain(
      'T:Mode$ Attacks | ValidCard$ Creature.YouDontCtrl | Attacked$ You,Planeswalker.YouCtrl | TriggerZones$ Battlefield | Execute$ Trig2Effect1 | TriggerDescription$ Whenever a creature attacks you or a planeswalker you control, put a +1/+1 counter on CARDNAME.',
    );
    expect(text).toContain(
      'SVar:Trig2Effect1:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1',
    );
    expect(text).toContain('SVar:X:Count$CardCounters.P1P1');
  });

  it("matches Mogg Flunkies' shipped built-in restriction", () => {
    const text = scriptFor({
      kind: 'creature',
      id: 'tst-mogg-flunkies',
      name: 'Mogg Flunkies',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 143 },
      colors: ['R'],
      manaCost: { generic: 1, R: 1 },
      power: 3,
      toughness: 3,
      subtypes: ['Goblin'],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'cantAttackOrBlockAlone' },
        },
      ],
    });

    expect(text).toContain("K:CARDNAME can't attack or block alone.");
  });
});
