/** Forge must refuse engine semantics it cannot yet spell, never approximate them. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function result(input: CardInput) {
  return transpileCardScript(parseCard(input));
}

describe('variable values at the Forge boundary', () => {
  it('writes a source-proven X cost and retained xPaid amount', () => {
    const found = result({
      kind: 'instant',
      id: 'tst-forge-x',
      name: 'Forge X',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { R: 1, hasX: true },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
    });
    expect(found.ok).toBe(true);
    const lines = found.ok ? found.value.lines : [];
    expect(lines).toContain('ManaCost:X R');
    expect(lines).toContain('SVar:X:Count$xPaid');
  });

  it('reuses xPaid for coordinated life gain and card draw', () => {
    const found = result({
      kind: 'instant',
      id: 'rtr-200',
      name: "Sphinx's Revelation",
      rarity: 'mythic',
      set: { code: 'RTR', collectorNumber: 200 },
      manaCost: { W: 2, U: 1, hasX: true },
      colors: ['W', 'U'],
      effects: [
        { kind: 'gainLife', amount: { kind: 'chosenX' }, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: { kind: 'chosenX' }, target: { kind: 'noTarget' } },
      ],
    });
    expect(found.ok).toBe(true);
    const script = found.ok ? found.value.lines.join('\n') : '';
    expect(script).toMatch(/SP\$ GainLife .*LifeAmount\$ X/u);
    expect(script).toMatch(/DB\$ Draw .*NumCards\$ X/u);
    expect(script.match(/SVar:X:Count\$xPaid/gu)).toHaveLength(1);
  });

  it('retains activation X in both its cost and damage amount', () => {
    const supported = result({
      kind: 'creature',
      id: 'tst-forge-x-activation',
      name: 'Forge X Activation',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 4, G: 2 },
      colors: ['G'],
      power: 2,
      toughness: 5,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { G: 2, hasX: true } },
          effects: [
            {
              kind: 'preventNextDamageToYouAndRetaliate',
              amount: { kind: 'chosenX' },
              target: { kind: 'targetPlayerOrPlaneswalker' },
            },
          ],
        },
      ],
    });
    expect(supported.ok).toBe(true);
    expect(supported.ok ? supported.value.lines.join('\n') : '').toContain('Cost$ X G G');

    const unsupported = result({
      kind: 'creature',
      id: 'tst-forge-unsupported-x-activation',
      name: 'Forge Unsupported X Activation',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 4 },
      manaCost: { generic: 4, G: 2 },
      colors: ['G'],
      power: 2,
      toughness: 5,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { G: 2, hasX: true } },
          effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    expect(unsupported.ok).toBe(true);
    const lines = unsupported.ok ? unsupported.value.lines : [];
    expect(lines.some((line) => line.includes('Cost$ X G G'))).toBe(true);
    expect(lines.some((line) => line.includes('NumDmg$ X'))).toBe(true);
    expect(lines).toContain('SVar:X:Count$xPaid');
  });

  it('writes Primordial Hydra with source-proven counter multiplication and threshold syntax', () => {
    const found = result({
      kind: 'creature',
      id: 'm13-primordial-hydra',
      name: 'Primordial Hydra',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 183 },
      manaCost: { hasX: true, G: 2 },
      colors: ['G'],
      subtypes: ['Hydra'],
      power: 0,
      toughness: 0,
      entryReplacement: {
        kind: 'entersWithCounters',
        counter: 'plusOnePlusOne',
        count: { kind: 'chosenX' },
      },
      abilities: [
        {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [{ kind: 'doubleSourceCounters', counter: 'plusOnePlusOne' }],
        },
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          enabledWhile: {
            kind: 'selfCounterCountAtLeast',
            counter: 'plusOnePlusOne',
            atLeast: 10,
          },
          modification: { kind: 'grantKeyword', keyword: 'trample' },
        },
      ],
    });

    expect(found.ok).toBe(true);
    const lines = found.ok ? found.value.lines : [];
    expect(lines).toContain('K:etbCounter:P1P1:X');
    expect(lines).toContain('SVar:Trig1Effect1:DB$ MultiplyCounter | Defined$ Self | CounterType$ P1P1');
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self+counters_GT9_P1P1 | AddKeyword$ Trample | Description$ CARDNAME has trample as long as it has ten or more +1/+1 counters on it.',
    );
    expect(lines).toContain('DeckHas:Ability$Counters');
  });

  it('refuses a CDA rather than emitting its canonical storage sentinel as printed P/T', () => {
    const found = result({
      kind: 'creature',
      id: 'tst-forge-cda',
      name: 'Forge CDA',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 3 },
      power: 0,
      toughness: 0,
      characteristicPowerToughness: { kind: 'creaturesYouControl' },
    });
    expect(found.ok).toBe(false);
    expect(found.ok ? [] : found.rejections.map((entry) => entry.code)).toContain(
      'UNMAPPED_CHARACTERISTIC_VALUE',
    );
  });
});
