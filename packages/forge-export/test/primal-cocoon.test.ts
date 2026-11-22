/** Primal Cocoon against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PRIMAL_COCOON = parseCard({
  kind: 'enchantment',
  id: 'm11-primal-cocoon',
  name: 'Primal Cocoon',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 191 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'enchantedCreature' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'enchantedCreatureAttacksOrBlocks',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
    },
  ],
});

describe('Primal Cocoon in Forge', () => {
  const script = mustTranspile(PRIMAL_COCOON);

  it('writes the attached counter and the two combat modes from the shipped script', () => {
    expect(script).toContain(
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ PutCounter | Defined$ Enchanted | CounterType$ P1P1 | CounterNum$ 1',
    );
    expect(script).toContain('T:Mode$ Attacks | ValidCard$ Card.AttachedBy | Execute$ Trig2Effect1');
    expect(script).toContain(
      'T:Mode$ Blocks | ValidCard$ Card.AttachedBy | Execute$ Trig2Effect1 | Secondary$ True',
    );
    expect(script).toContain('SVar:Trig2Effect1:DB$ Sacrifice');
  });

  it('prints no continuous line for an Aura with no static modification', () => {
    expect(script.split('\n').some((line) => line.startsWith('S:'))).toBe(false);
    expect(script).toContain(
      'Oracle:Enchant creature\\nAt the beginning of your upkeep, put a +1/+1 counter on enchanted creature.\\nWhen enchanted creature attacks or blocks, sacrifice Primal Cocoon.',
    );
  });
});
