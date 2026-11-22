import { readFileSync } from 'node:fs';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { describe, expect, it } from 'vitest';
import {
  evaluateStructuralPrintedCard,
  planStructuralPrintedPool,
  structuralPrintedFacts,
  structuralPrintedPickValue,
  structuralPrintedScore,
  STRUCTURAL_PRINTED_EVALUATION_POLICY,
} from '../src/limited-evaluation/structural-printed';

const catalog = JSON.parse(
  readFileSync('packages/data/data/akh-hou/akh-printed-catalog-v1.json', 'utf8'),
) as { readonly cards: readonly PrintedCardCatalogEntry[] };
const template = catalog.cards[0]!;

function printing(
  name: string,
  colors: PrintedCardCatalogEntry['colors'],
  manaCost: string,
  typeLine = 'Creature — Test',
): PrintedCardCatalogEntry {
  return {
    ...template,
    correctedName: name,
    physicalId: `held-out:${name}`,
    colors,
    manaCost,
    manaValue: 2,
    typeLine,
    oracleText: '',
    faces: [{ ...template.faces[0]!, name, colors, manaCost, typeLine, oracleText: '' }],
  };
}

describe('general structural printed evaluation', () => {
  it('maps a held-out card without an authored set profile', () => {
    const card = printing('Unpublished Adept', ['R'], '{1}{R}');
    expect(evaluateStructuralPrintedCard(card, 'copy-1')).toMatchObject({
      id: 'copy-1',
      colors: ['R'],
      manaValue: 2,
      type: 'creature',
      pips: { R: 1 },
      roles: [],
      tags: [],
      payoffs: [],
    });
    expect(structuralPrintedFacts(card)).toMatchObject({
      name: 'Unpublished Adept',
      colors: ['R'],
      manaValue: 2,
      type: 'creature',
    });
    expect(STRUCTURAL_PRINTED_EVALUATION_POLICY).toMatch(/structural/);
  });

  it('projects flexible printed mana symbols without rejecting real cards', () => {
    const hybrid = printing('Hybrid Adept', ['R', 'W'], '{W}{R/W}{W/P}{2/U}');
    expect(evaluateStructuralPrintedCard(hybrid, 'hybrid-copy').pips).toEqual({
      W: 1,
    });
  });

  it('maps lands, spells, sources, and unsupported printed cost grammar explicitly', () => {
    const land = {
      ...printing('Test Dual', [], '', 'Land'),
      producedMana: ['U', 'R'],
    } satisfies PrintedCardCatalogEntry;
    expect(evaluateStructuralPrintedCard(land, 'land-copy')).toMatchObject({
      type: 'nonbasic-land',
      pips: {},
      sources: ['U', 'R'],
    });
    expect(structuralPrintedScore(land)).toBeGreaterThan(0);
    expect(structuralPrintedFacts(printing('Test Spell', ['B'], '{1}{B}', 'Sorcery')).type).toBe(
      'noncreature-spell',
    );
    expect(() => evaluateStructuralPrintedCard(printing('Broken', [], '{Q}'), 'broken')).toThrow(
      /mana symbol/,
    );
    expect(() => evaluateStructuralPrintedCard(printing('Broken', ['W'], '{W}junk'), 'broken')).toThrow(
      /mana cost/,
    );
  });

  it('builds a physical-id deck plan through the shared Limited model', () => {
    const cards = Array.from({ length: 23 }, (_, index) =>
      evaluateStructuralPrintedCard(
        printing(`Red ${String(index)}`, ['R'], '{1}{R}'),
        `red-${String(index)}`,
      ),
    );
    expect(planStructuralPrintedPool(cards).selectedIds).toHaveLength(23);
  });

  it('values a card by its marginal contribution to the observed pool', () => {
    const red = evaluateStructuralPrintedCard(printing('Red Two', ['R'], '{1}{R}'), 'red');
    const blue = evaluateStructuralPrintedCard(printing('Blue Two', ['U'], '{1}{U}'), 'blue');
    const picked = Array.from({ length: 8 }, (_, index) => ({ ...red, id: `picked-${String(index)}` }));
    expect(structuralPrintedPickValue(red, picked)).toBeGreaterThan(structuralPrintedPickValue(blue, picked));
  });
});
