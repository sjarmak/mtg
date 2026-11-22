/** Forge 2.0.14 parity for Mark of Mutiny's retained-creature chain. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'sorcery',
  id: 'm13-141',
  name: 'Mark of Mutiny',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 141 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  effects: [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      target: { kind: 'thatCreature' },
    },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
  ],
});

function followed(lines: readonly string[], line: string): string {
  const name = /SubAbility\$ ([^ |]+)/.exec(line)?.[1];
  if (name === undefined) throw new Error(`Forge line has no follow-up: ${line}`);
  return lines.find((candidate) => candidate.startsWith(`SVar:${name}:`)) ?? '';
}

describe('Mark of Mutiny Forge parity', () => {
  it('preserves Forge 2.0.14 control, counter, untap, and haste semantics', () => {
    // forge-2.0.14/a37a865 carries GainControl with LoseControl EOT, Untap,
    // AddKWs Haste, then DBPutCounter P1P1. The native DSL keeps the four
    // instructions independently reusable and chains them over Targeted.
    const lines = mustTranspile(CARD).split('\n');
    const control = lines.find((line) => line.startsWith('A:')) ?? '';
    const counter = followed(lines, control);
    const untap = followed(lines, counter);
    const haste = followed(lines, untap);

    expect(control).toContain('SP$ GainControl');
    expect(control).toContain('ValidTgts$ Creature');
    expect(control).toContain('LoseControl$ EOT');
    expect(counter).toContain('DB$ PutCounter');
    expect(counter).toContain('Defined$ Targeted');
    expect(counter).toContain('CounterType$ P1P1');
    expect(counter).toContain('CounterNum$ 1');
    expect(untap).toContain('DB$ Untap');
    expect(untap).toContain('Defined$ Targeted');
    expect(haste).toContain('DB$ Pump');
    expect(haste).toContain('Defined$ Targeted');
    expect(haste).toContain('KW$ Haste');
  });
});
