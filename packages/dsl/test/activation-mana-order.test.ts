/** Hand-authored activation costs may retain a source's noncanonical fixed-pip order. */
import { describe, expect, it } from 'vitest';
import {
  ActivationCostSchema,
  MechanicModelActivationCostSchema,
  ModelActivationCostSchema,
} from '../src/ability-shape';
import { parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

function guildmageCost(cost: unknown): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-vitu-ghazi-guildmage-order',
    name: 'Vitu-Ghazi Guildmage',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 207 },
    colors: ['G', 'W'],
    manaCost: { G: 1, W: 1 },
    subtypes: ['Dryad', 'Shaman'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'activated',
        cost,
        effects: [{ kind: 'populate' }],
      },
    ],
  } as CardInput;
}

describe('activation mana pip presentation order', () => {
  it('retains a validated noncanonical permutation while payment stays structured', () => {
    const cost = ActivationCostSchema.parse({
      mana: { generic: 2, G: 1, W: 1 },
      printedManaPips: ['G', 'W'],
    });
    expect(cost.mana).toEqual(expect.objectContaining({ generic: 2, G: 1, W: 1, U: 0, B: 0, R: 0 }));
    expect(cost.printedManaPips).toEqual(['G', 'W']);
    expect(renderOracleText(parseCard(guildmageCost(cost)))).toBe('{2}{G}{W}: Populate.');
  });

  it('keeps X and generic first while ordering fixed colored and hybrid pips', () => {
    const card = parseCard({
      ...guildmageCost({
        mana: { generic: 1, hasX: true, G: 1, hybrid: { 'W/U': 1 } },
        printedManaPips: ['W/U', 'G'],
      }),
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1, hasX: true, G: 1, hybrid: { 'W/U': 1 } },
            printedManaPips: ['W/U', 'G'],
          },
          effects: [{ kind: 'gainLife', amount: { kind: 'chosenX' }, target: { kind: 'noTarget' } }],
        },
      ],
    } as CardInput);

    expect(renderOracleText(card)).toBe('{X}{1}{W/U}{G}: You gain life equal to the value chosen for X.');
  });

  it('leaves the default parsed shape and canonical rendering unchanged when no override is present', () => {
    const cost = ActivationCostSchema.parse({ mana: { generic: 2, G: 1, W: 1 } });
    expect(cost).not.toHaveProperty('printedManaPips');
    expect(renderOracleText(parseCard(guildmageCost(cost)))).toBe('{2}{W}{G}: Populate.');
  });

  it('refuses missing, extra, duplicate, and redundant canonical pip orders', () => {
    for (const printedManaPips of [['G'], ['G', 'W', 'U'], ['G', 'G'], ['W', 'G']]) {
      const result = safeParseCard(guildmageCost({ mana: { generic: 2, G: 1, W: 1 }, printedManaPips }));
      expect(result.ok, printedManaPips.join('')).toBe(false);
      if (result.ok) throw new Error('invalid printed mana order unexpectedly parsed');
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: 'ABILITY_COST_INVALID',
          path: 'abilities[0].cost.printedManaPips',
        }),
      );
    }
  });

  it('refuses hostile pip counts without expanding them into presentation arrays', () => {
    const result = safeParseCard(
      guildmageCost({
        mana: { generic: 2, G: 1_000_000_000, W: 1 },
        printedManaPips: ['G', 'W'],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unbounded activation cost unexpectedly parsed');
    expect(result.violations.map((violation) => violation.path)).toContain(
      'abilities[0].cost.printedManaPips',
    );
  });

  it('keeps the presentation override outside both generator-facing cost schemas', () => {
    const cost = { mana: { generic: 2, G: 1, W: 1 }, printedManaPips: ['G', 'W'] };
    expect(ModelActivationCostSchema.safeParse(cost).success).toBe(false);
    expect(MechanicModelActivationCostSchema.safeParse(cost).success).toBe(false);
  });
});
