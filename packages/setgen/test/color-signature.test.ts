/**
 * Gate 2: an effect printed in a color this set says does not print it.
 *
 * The policy is the brief's and the enforcement is the validator's, so these
 * tests state a signature in brief data and assert what the walk says about it.
 * Firing it on a set that actually declares one is the other half, and that test
 * lives beside the set it opens rather than here, because a test that names a
 * set by its path belongs with that set.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import { offSignatureSubjects, signatureFindings } from '@mtg/setgen';
import type { ColorSignature } from '@mtg/setgen';

let serial = 0;

function spell(name: string, colors: readonly string[], effects: readonly unknown[]): Card {
  serial += 1;
  const pips = Object.fromEntries(colors.map((color) => [color, 1]));
  return parseCard({
    id: `tst-${serial}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: serial },
    colors,
    kind: 'sorcery',
    manaCost: mana({ generic: 1, ...pips }),
    effects,
  });
}

const draw = [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }];

const signatures: readonly ColorSignature[] = [
  { color: 'R', absent: ['drawCards'] },
  { color: 'G', absent: ['drawCards'] },
];

describe('the set color signature', () => {
  it('passes a set that prints each effect only where its signature allows', () => {
    expect(
      signatureFindings([spell('Blue Draw', ['U'], draw), spell('Black Draw', ['B'], draw)], signatures),
    ).toStrictEqual([]);
  });

  it('states nothing when the brief states nothing', () => {
    expect(signatureFindings([spell('Red Draw', ['R'], draw)], [])).toStrictEqual([]);
  });

  it('fails a card printing a subject its color declares absent', () => {
    const found = signatureFindings([spell('Red Cantrip', ['R'], draw)], signatures);
    expect(found.map((item) => item.code)).toStrictEqual(['OFF_SIGNATURE']);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.message).toBe(
      '"Red Cantrip" is R and prints drawCards, which this set\'s color signature places absent from R',
    );
  });

  it('reads a keyword the same way it reads an effect', () => {
    const flier = parseCard({
      id: 'tst-flier',
      name: 'Red Flier',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 800 },
      colors: ['R'],
      kind: 'creature',
      manaCost: mana({ R: 1, generic: 1 }),
      power: 2,
      toughness: 2,
      keywords: ['flying'],
    });
    const found = signatureFindings([flier], [{ color: 'R', absent: ['flying'] }]);
    expect(found[0]?.message).toContain('prints flying');
  });

  it('lets a gold card stand on either of its colors', () => {
    expect(offSignatureSubjects([spell('Izzet Draw', ['R', 'U'], draw)], signatures)).toStrictEqual([]);
    expect(offSignatureSubjects([spell('Gruul Draw', ['R', 'G'], draw)], signatures)).toHaveLength(1);
  });

  it('rules on no colorless card: it names no color to be judged against', () => {
    expect(offSignatureSubjects([spell('Colorless Draw', [], draw)], signatures)).toStrictEqual([]);
  });
});
