/**
 * Mutilate, in Forge (`mtg-nhyv.16`).
 *
 * Forge folds a rate into the count rather than into the API that reads it.
 * `PumpAll` takes `NumAtt$`/`NumDef$` as a value, so the per-unit multiplier
 * goes inside the `Count$` expression — `Count$Valid Enchantment.Other/Times.2`
 * is Ancestral Mask's "+2/+2 for each other enchantment" upstream — and the
 * sign stays on the parameter, which is what `NumAtt$ -X` is doing on Forge's
 * own `mutilate.txt`. Both halves were read off 2.0.14's shipped
 * `res/cardsfolder`, where `Count$Valid Swamp.YouCtrl` appears 27 times and the
 * unqualified `Count$Valid Swamp` four more for the "on the battlefield"
 * reading.
 *
 * So this file asserts a script rather than a refusal. The refusals left are
 * the ones `board-count.ts` already refuses for every other count: a tally
 * naming two card types, and `countWithCounter`, whose part counters each
 * decompose into two Forge counter types so no `counters_GE1_` restriction
 * counts the permanents the card means. They refuse under `UNMAPPED_RATE_AMOUNT`
 * rather than the general code because what is missing is the group the rate is
 * charged per, and the general message enumerates the counts instead.
 */
import { describe, expect, it } from 'vitest';
import type { PermanentTally, RatePer } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';
import { transpileCard } from '../src/index';

const SWAMPS: PermanentTally = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' };

function perSwamp(rate: number): RatePer {
  return { kind: 'ratePer', rate, each: SWAMPS };
}

function mutilate(power: RatePer, toughness: RatePer): ReturnType<typeof spell> {
  return spell(
    'Mutilate',
    [
      {
        kind: 'pumpUntilEndOfTurn',
        power,
        toughness,
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
    { kind: 'sorcery', manaCost: { generic: 2, B: 2 }, colors: ['B'] },
  );
}

function pumpPerTally(name: string, each: PermanentTally, rate = -1): ReturnType<typeof spell> {
  return spell(
    name,
    [
      {
        kind: 'pumpUntilEndOfTurn',
        power: { kind: 'ratePer', rate, each },
        toughness: { kind: 'ratePer', rate, each },
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
    { kind: 'sorcery', manaCost: { generic: 2, B: 2 }, colors: ['B'] },
  );
}

function svarLine(script: string, name: string): string | undefined {
  return script.split('\n').find((line) => line.startsWith(`SVar:${name}:`));
}

describe('a mass stat change charged per Swamp', () => {
  const script = mustTranspile(mutilate(perSwamp(-1), perSwamp(-1)));

  it('writes the sweep with the SVar in both magnitude slots, sign and all', () => {
    expect(script).toContain('A:SP$ PumpAll | ValidCards$ Creature | NumAtt$ -Y | NumDef$ -Y');
  });

  it('binds the SVar to the Swamps its controller has, the line Forge ships for this card', () => {
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Swamp.YouCtrl');
  });

  it('prints the sentence the card prints', () => {
    expect(script).toContain('Oracle:All creatures get -1/-1 until end of turn for each Swamp you control.');
  });
});

describe('the rate itself', () => {
  it('rides inside the count as a multiplier, since Pump has no parameter for it', () => {
    const script = mustTranspile(mutilate(perSwamp(-2), perSwamp(-2)));

    expect(script).toContain('NumAtt$ -Y | NumDef$ -Y');
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Swamp.YouCtrl/Times.2');
  });

  it('counts every Swamp on the battlefield when the tally is not narrowed to you', () => {
    const script = mustTranspile(
      pumpPerTally('Marsh Tide', { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'each' }),
    );

    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Swamp');
  });

  it('counts a board filter through the spec every other count already uses', () => {
    const script = mustTranspile(
      pumpPerTally('Monster Tide', { kind: 'countMatching', filter: { subtypes: ['Monster'] } }),
    );

    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Monster.YouCtrl');
  });

  /**
   * Zero per permanent is zero whatever the board holds, so the half that
   * carries no rate is a literal and asks for no SVar. Writing `-Y` for it and
   * binding `Y` to `Times.0` would be a line that reads a count it multiplies
   * away.
   */
  it('writes a plain zero for a half whose rate is zero, and still binds one SVar', () => {
    const script = mustTranspile(mutilate(perSwamp(-1), perSwamp(0)));

    expect(script).toContain('NumAtt$ -Y | NumDef$ +0');
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Swamp.YouCtrl');
  });
});

describe('the tallies Forge cannot name', () => {
  it('refuses a rate charged per creature carrying a part counter', () => {
    const result = transpileCard(
      pumpPerTally('Horned Tide', {
        kind: 'countWithCounter',
        filter: { cardTypes: ['creature'] },
        counters: ['horn'],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toEqual(['UNMAPPED_RATE_AMOUNT']);
    expect(result.rejections.map((r) => r.message).join(' ')).toContain('countWithCounter');
  });

  it('refuses a rate charged per two card types, which Forge spells as an OR this file does not write', () => {
    const result = transpileCard(
      pumpPerTally('Wide Tide', {
        kind: 'countMatching',
        filter: { cardTypes: ['creature', 'artifact'] },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toEqual(['UNMAPPED_RATE_AMOUNT']);
  });

  it('points at the pump rather than at the card, so the note names the clause', () => {
    const result = transpileCard(
      pumpPerTally('Horned Tide', {
        kind: 'countWithCounter',
        filter: { cardTypes: ['creature'] },
        counters: ['horn'],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.path)).toEqual(['effects[0]']);
  });

  /**
   * The rate is taken whole when the chain is walked for its specs, so the
   * tally underneath it never offers a second one. Without that, Mutilate's own
   * `Swamp.YouCtrl/Times.2` would sit beside a bare `Swamp.YouCtrl` and a card
   * reading one number would be refused for reading two.
   */
  it('does not count the tally under a rate twice when the multiplier is more than one', () => {
    const result = transpileCard(mutilate(perSwamp(-2), perSwamp(-2)));

    expect(result.ok).toBe(true);
  });
});

describe('the same pump written with numerals', () => {
  it('still transpiles, so nothing above is the sweep or the sign', () => {
    const result = transpileCard(
      spell(
        'Flat Mutilate',
        [
          {
            kind: 'pumpUntilEndOfTurn',
            power: -1,
            toughness: -1,
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'] },
            target: { kind: 'noTarget' },
          },
        ],
        { kind: 'sorcery', manaCost: { generic: 2, B: 2 }, colors: ['B'] },
      ),
    );

    expect(result.ok).toBe(true);
  });
});
