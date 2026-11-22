/** Forge 2.0.14 parity for Rewind's targeted counter and non-targeted land choice. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PINNED_FORGE_REVISION = 'a37a865a53280dd8ad6fad3384d69611e8c5a42f';

const REWIND = parseCard({
  kind: 'instant',
  id: 'm13-65',
  name: 'Rewind',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 65 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'],
  effects: [{ kind: 'counterSpell' }, { kind: 'untapPermanents', upTo: 4, filter: { cardTypes: ['land'] } }],
});

describe('Rewind Forge parity', () => {
  it('pins the Forge source revision that attests the non-targeted DBUntap form', () => {
    expect(PINNED_FORGE_REVISION).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('exports the land choice as UntapUpTo rather than four target slots', () => {
    const lines = mustTranspile(REWIND).split('\n');
    const counter = lines.find((line) => line.startsWith('A:')) ?? '';
    const follow = /SubAbility\$ ([^ |]+)/u.exec(counter)?.[1] ?? '';
    const untap = lines.find((line) => line.startsWith(`SVar:${follow}:`)) ?? '';

    expect(counter).toContain('SP$ Counter');
    expect(counter).toContain('ValidTgts$ Card');
    expect(untap).toContain('DB$ Untap');
    expect(untap).toContain('UntapUpTo$ True');
    expect(untap).toContain('UntapType$ Land');
    expect(untap).toContain('Amount$ 4');
    expect(untap).not.toContain('ValidTgts$');
  });
});
