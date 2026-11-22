import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { evaluatePrintedCard, printedPickValue } from '../src/limited-evaluation/printed';

const catalogs = ['akh', 'hou', 'mp2'].map(
  (code) =>
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`, 'utf8')) as {
      cards: PrintedCardCatalogEntry[];
    },
);
const printing = (name: string) => catalogs.flatMap((c) => c.cards).find((c) => c.correctedName === name)!;
const evaluation = (name: string) => evaluatePrintedCard(printing(name), name);

describe('pinned printed Limited judgments', () => {
  it('covers every position and rejects unknown or changed card text', () => {
    for (const catalog of catalogs)
      for (const card of catalog.cards)
        expect(() => evaluatePrintedCard(card, card.physicalId), card.correctedName).not.toThrow();
    const card = printing('Moaning Wall');
    expect(() => evaluatePrintedCard({ ...card, oracleText: 'Changed rules' }, 'copy')).toThrow(
      /profile.*stale/,
    );
    expect(() => evaluatePrintedCard({ ...card, correctedName: 'Unknown card' }, 'copy')).toThrow(/profile/);
  });

  it('drafts The Scarab God above Moaning Wall without any picked cards', () => {
    expect(printedPickValue(evaluation('The Scarab God'), [])).toBeGreaterThan(
      printedPickValue(evaluation('Moaning Wall'), []),
    );
  });

  it('keeps source accounting separate from payoff tags', () => {
    expect(evaluation('Moaning Wall').tags).toContain('cycling');
    expect(evaluation('Ruthless Sniper').tags).not.toContain('cycling');
    expect(evaluation('Ruthless Sniper').payoffs.some((p) => p.tag === 'cycling')).toBe(true);
    expect(evaluation('Sand Strangler').tags).not.toContain('desert');
    expect(evaluation('Desert of the Fervent').tags).toContain('desert');
  });

  it('requires delayed pact payments and useful X values in its mana plan', () => {
    expect(evaluation('Pact of Negation').pips).toEqual({ U: 2 });
    expect(evaluation('Slaughter Pact').pips).toEqual({ B: 1 });
    expect(evaluation('Pull from Tomorrow').manaValue).toBe(5);
    expect(evaluation('Pride Sovereign').pips).toEqual({ G: 1, W: 1 });
  });

  it('does not treat mana filters as unconditional colored sources', () => {
    for (const name of [
      'Cascading Cataracts',
      'Painted Bluffs',
      "Survivors' Encampment",
      'Crypt of the Eternals',
    ])
      expect(evaluation(name).sources).toEqual([]);
    expect(evaluation('Evolving Wilds').sources).toHaveLength(5);
  });

  it('reads only the first castable face for the mana plan of aftermath spells', () => {
    const card = evaluation('Dusk // Dawn');
    expect(card.manaValue).toBe(4);
    expect(card.pips).toEqual({ W: 2 });
  });
});
