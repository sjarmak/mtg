/**
 * What a `putCounters` of more than one exports as, and why the two counter
 * keys do not take the same answer.
 *
 * Forge 2.0.14's `res/cardsfolder` is the whole of the evidence, and it is
 * lopsided. `CounterType$ X | CounterNum$ 3` appears in one form or another
 * 3,884 times and plainly means three of X. `CounterTypes$` appears on 19
 * lines, not the 20 an earlier draft of this paragraph counted: the twentieth
 * grep hit is `AllCounterTypes$`, a different key. Two of the 19 are
 * `CounterTypes$ EachType_…`, a rule rather than a list. Of the 17 that name
 * kinds, 2 name one and 15 name several; of those 15, eight carry
 * `CounterNum$ 1`, one splits a total with `CounterNum$ X | SplitAmount$ True`,
 * and six carry no `CounterNum$` at all. So the earlier claim that every use
 * takes one of three forms was wrong twice, and what the corpus actually rules
 * out is narrower and is the thing that matters: no multi-kind list anywhere in
 * 2.0.14 carries a `CounterNum$` above 1. Scavenged Brawler, the one card that
 * wanted four of one kind alongside four others, repeats `P1P1` four times and
 * writes no `CounterNum$` at all.
 *
 * So the transpiler repeats the list rather than raising `CounterNum$` beside
 * it. The two forms are the same card if `CounterNum$` is per named counter and
 * a very different one if it is not, and only one of them is a form Forge has
 * been seen to write.
 *
 * `../src/effect-script.ts` carries the same count beside the code that acts on
 * it. Both were wrong in the same way and were corrected separately, which is
 * the argument for reading a claim in every file that repeats it rather than
 * only in the one the diff touched.
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile, slugId } from './helpers';

function chest(name: string, effect: EffectInput): Card {
  return parseCard({
    kind: 'artifact',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 41 },
    manaCost: { generic: 2 },
    abilities: [
      { kind: 'activated', cost: { mana: { generic: 1 }, sacrificeSelf: true }, effects: [effect] },
    ],
  });
}

function abilityLine(card: Card): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error('no A: line');
  return line;
}

describe('a putCounters of more than one', () => {
  it('raises CounterNum$ when the kind decomposes into a single Forge counter', () => {
    const line = abilityLine(
      chest('Growth Shard', {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: 3,
        target: { kind: 'targetCreature' },
      }),
    );
    expect(line).toContain('CounterType$ P1P1 | CounterNum$ 3');
  });

  it('repeats the list when the kind decomposes into several, and never raises CounterNum$', () => {
    const line = abilityLine(
      chest('Triple Horn', {
        kind: 'putCounters',
        counter: 'horn',
        count: 3,
        target: { kind: 'targetCreature' },
      }),
    );
    expect(line).toContain(
      'CounterTypes$ P1P1,First Strike,P1P1,First Strike,P1P1,First Strike | CounterNum$ 1',
    );
    expect(line).not.toContain('CounterNum$ 3');
  });

  it('writes exactly what it wrote before when the count is one', () => {
    const line = abilityLine(
      chest('Single Horn', {
        kind: 'putCounters',
        counter: 'horn',
        count: 1,
        target: { kind: 'targetCreature' },
      }),
    );
    expect(line).toContain('CounterTypes$ P1P1,First Strike | CounterNum$ 1');
  });
});
