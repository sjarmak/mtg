/** Source-attested Forge parity for RTR #109's retained control-and-pump chain. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'sorcery',
  id: 'rtr-109',
  name: 'Traitorous Instinct',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 109 },
  manaCost: { generic: 3, R: 1 },
  colors: ['R'],
  effects: [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    {
      kind: 'pumpUntilEndOfTurn',
      power: 2,
      toughness: 0,
      keyword: 'haste',
      target: { kind: 'thatCreature' },
    },
  ],
});

describe('RTR Traitorous Instinct Forge parity', () => {
  it('exports one chosen creature through temporary control, untap, and Targeted pump', () => {
    const lines = mustTranspile(CARD).split('\n');
    const gain = lines.find((line) => line.startsWith('A:')) ?? '';
    const untapName = /SubAbility\$ ([^ |]+)/.exec(gain)?.[1] ?? '';
    const untap = lines.find((line) => line.startsWith(`SVar:${untapName}:`)) ?? '';
    const pumpName = /SubAbility\$ ([^ |]+)/.exec(untap)?.[1] ?? '';
    const pump = lines.find((line) => line.startsWith(`SVar:${pumpName}:`)) ?? '';

    expect(gain).toContain('SP$ GainControl');
    expect(gain).toContain('ValidTgts$ Creature');
    expect(gain).toContain('LoseControl$ EOT');
    expect(untap).toContain('DB$ Untap');
    expect(untap).toContain('Defined$ Targeted');
    expect(pump).toContain('DB$ Pump');
    expect(pump).toContain('Defined$ Targeted');
    expect(pump).toContain('NumAtt$ +2');
    expect(pump).toContain('KW$ Haste');
  });
});
