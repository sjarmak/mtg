/**
 * Gate 1: one printed effect on several cards, at a cost the set never decided.
 *
 * The defect these tests pin is a real one from the 253-card flagship, which
 * printed "Destroy target creature." on nineteen cards from {1} to {7} and
 * passed every deterministic gate in the pipeline.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import {
  DEFAULT_REPRINT_POLICY,
  effectSignature,
  parseSetFile,
  reprintFindings,
  reprintGroups,
} from '@mtg/setgen';

const HERE = dirname(fileURLToPath(import.meta.url));

function committedSet(name: string): readonly Card[] {
  return parseSetFile(
    JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'sets', `${name}.set.json`), 'utf8')) as unknown,
  ).cards;
}

let serial = 0;

function removal(name: string, cost: Parameters<typeof mana>[0], extra: Record<string, unknown> = {}): Card {
  serial += 1;
  return parseCard({
    id: `tst-${serial}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: serial },
    colors: ['B'],
    kind: 'sorcery',
    manaCost: mana(cost),
    effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
    ...extra,
  });
}

describe('functional reprints', () => {
  it('passes a set that prints one effect twice at neighboring costs', () => {
    const cards = [removal('Kill One', { B: 1, generic: 1 }), removal('Kill Two', { B: 1, generic: 2 })];
    expect(reprintFindings(cards)).toStrictEqual([]);
  });

  it('fails a spread wider than the set allows, naming every card and its cost', () => {
    const cards = [removal('Cheap Murder', { B: 1 }), removal('Dear Murder', { B: 1, generic: 6 })];
    const found = reprintFindings(cards);
    expect(found.map((item) => item.code)).toStrictEqual(['FUNCTIONAL_REPRINT_SPREAD']);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.message).toBe(
      '"Destroy target creature." is printed on 2 cards spanning 6 mana (1 to 7), over the spread of 2 this set allows: Cheap Murder {B}, Dear Murder {6}{B}',
    );
  });

  it('warns when one effect is printed more often than the set allows', () => {
    const cards = ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      removal(`Murder ${letter}`, { B: 1, generic: 1 }),
    );
    const found = reprintFindings(cards);
    expect(found.map((item) => item.code)).toStrictEqual(['FUNCTIONAL_REPRINT_GLUT']);
    expect(found[0]?.severity).toBe('warning');
    expect(found[0]?.message).toBe(
      '"Destroy target creature." is printed on 5 cards, over the 4 this set allows: Murder A {1}{B}, Murder B {1}{B}, Murder C {1}{B}, Murder D {1}{B}, Murder E {1}{B}',
    );
  });

  it('takes the policy from its caller rather than the default', () => {
    const cards = [removal('Kill One', { B: 1, generic: 1 }), removal('Kill Two', { B: 1, generic: 2 })];
    expect(reprintFindings(cards, { ...DEFAULT_REPRINT_POLICY, maxCostSpread: 0 })).toHaveLength(1);
  });

  it('reads a rider as a different card', () => {
    const cards = [
      removal('Plain Murder', { B: 1 }),
      removal(
        'Murder Plus',
        {
          B: 1,
          generic: 6,
        },
        {
          effects: [
            { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
            { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
          ],
        },
      ),
    ];
    expect(reprintGroups(cards)).toStrictEqual([]);
    expect(reprintFindings(cards)).toStrictEqual([]);
  });

  it('keys the structured effects, not the rendered string', () => {
    const first = removal('Murder', { B: 1 });
    const second = removal('Murder Again', { B: 1, generic: 1 });
    expect(effectSignature(first)).toBe(effectSignature(second));
  });

  it('keys no permanent: a body is most of what a creature costs', () => {
    const creature = parseCard({
      id: 'tst-bear',
      name: 'Bear',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 900 },
      colors: ['G'],
      kind: 'creature',
      manaCost: mana({ G: 1, generic: 1 }),
      power: 2,
      toughness: 2,
      subtypes: ['Bear'],
    });
    expect(effectSignature(creature)).toBeNull();
  });
});

/**
 * What the gate says about the two committed sets, pinned so a set edit that
 * clears one of these — or adds one — is read here rather than counted.
 */
describe('the committed sets', () => {
  it("names the prototype's repeated effects, and fails only the one that spreads", () => {
    expect(
      reprintGroups(committedSet('tideglass-reach')).map(
        (group) => `${group.text} x${group.cards.length} ${group.minManaValue}-${group.maxManaValue}`,
      ),
    ).toStrictEqual([
      'Destroy target creature. x6 1-6',
      'Target creature gets +5/+5 until end of turn. x2 3-4',
      "Return target creature to its owner's hand. x3 2-4",
      'Draw two cards. x2 2-3',
      'Target creature gets +3/+1 until end of turn. x3 2-3',
      'Shatterglass Volley deals 2 damage to any target. x2 1-2',
    ]);
    // Six repeated effects, one finding: five of them repeat inside the spread
    // the policy allows, which is what a set repeating an effect on purpose
    // looks like and is the reason the rule is not "never twice".
    expect(reprintFindings(committedSet('tideglass-reach')).map((item) => item.code)).toStrictEqual([
      'FUNCTIONAL_REPRINT_SPREAD',
      'FUNCTIONAL_REPRINT_GLUT',
    ]);
  });
});
