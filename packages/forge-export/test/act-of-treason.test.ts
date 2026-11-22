/** Source-attested Forge parity for Act of Treason's three-effect chain. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'sorcery',
  id: 'm11-121',
  name: 'Act of Treason',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 121 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  effects: [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
  ],
});

describe('Act of Treason Forge parity', () => {
  it('exports GainControl, then Untap, then Haste over Forge Targeted referents', () => {
    // Forge 0c9f64a: LoseControl$ EOT, Untap$ True, AddKWs$ Haste.
    // XMage 8f409c4 composes the same three operations independently.
    const lines = mustTranspile(CARD).split('\n');
    const ability = lines.find((line) => line.startsWith('A:')) ?? '';
    const firstFollow = /SubAbility\$ ([^ |]+)/.exec(ability)?.[1] ?? '';
    const untap = lines.find((line) => line.startsWith(`SVar:${firstFollow}:`)) ?? '';
    const secondFollow = /SubAbility\$ ([^ |]+)/.exec(untap)?.[1] ?? '';
    const haste = lines.find((line) => line.startsWith(`SVar:${secondFollow}:`)) ?? '';

    expect(ability).toContain('SP$ GainControl');
    expect(ability).toContain('ValidTgts$ Creature');
    expect(ability).toContain('LoseControl$ EOT');
    expect(untap).toContain('DB$ Untap');
    expect(untap).toContain('Defined$ Targeted');
    expect(haste).toContain('DB$ Pump');
    expect(haste).toContain('Defined$ Targeted');
    expect(haste).toContain('KW$ Haste');
  });
});
