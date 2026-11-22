/**
 * `cardWinRatesWhenDrawnFromRows` / `createCardWinRateAccumulator` over
 * hand-authored `WinRateGameRow`s — the shape a parsed 17lands GAME CSV row
 * reduces to (`packages/metrics/tools/ingest-17lands-ktk.ts`). No network, no
 * real card names: these rows model the reduction, not a specific printing.
 */
import { describe, expect, it } from 'vitest';
import { cardWinRatesWhenDrawnFromRows, createCardWinRateAccumulator, metricsConfig } from '@mtg/metrics';
import type { WinRateGameRow } from '@mtg/metrics';

const config = metricsConfig({ floors: { card: 4 } });

function row(
  won: boolean,
  fingerprint: string,
  cardName: string,
  hand: number,
  drawn: number,
): WinRateGameRow {
  return { won, fingerprint, cards: { [cardName]: { opening_hand: hand, drawn } } };
}

describe('cardWinRatesWhenDrawnFromRows', () => {
  it('credits a win or a loss to every row a card was seen in', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_v, i) => row(true, `w${String(i)}`, 'Fen Scout', 1, 0)),
      ...Array.from({ length: 3 }, (_v, i) => row(false, `l${String(i)}`, 'Fen Scout', 1, 0)),
    ];
    const [scout] = cardWinRatesWhenDrawnFromRows(rows, config);
    expect(scout?.cardName).toBe('Fen Scout');
    expect(scout?.wins).toBe(5);
    expect(scout?.losses).toBe(3);
    expect(scout?.gamesInHand).toBe(8);
    expect(scout?.winRate.value).toBe(0.625);
  });

  it('sums opening-hand and later-drawn sightings into gamesInHand', () => {
    const rows = [
      row(true, 'a', 'Reef Warden', 1, 0),
      row(true, 'b', 'Reef Warden', 1, 0),
      row(true, 'c', 'Reef Warden', 0, 1),
      row(true, 'd', 'Reef Warden', 0, 1),
    ];
    const [warden] = cardWinRatesWhenDrawnFromRows(rows, config);
    expect(warden?.gamesInHand).toBe(4);
    expect(warden?.wins).toBe(4);
  });

  it('only counts a row toward a card that row actually saw', () => {
    const rows = [
      row(true, 'a', 'Reef Warden', 0, 1),
      row(false, 'b', 'Reef Warden', 0, 1),
      { won: true, fingerprint: 'c', cards: {} },
      { won: false, fingerprint: 'd', cards: {} },
    ];
    const [warden] = cardWinRatesWhenDrawnFromRows(rows, config);
    expect(warden?.gamesInHand).toBe(2);
  });

  it('withholds a win rate for a card below its sample floor', () => {
    const rows = [
      row(true, 'a', 'Reef Warden', 0, 1),
      row(true, 'b', 'Reef Warden', 0, 1),
      row(false, 'c', 'Reef Warden', 0, 1),
    ];
    const [warden] = cardWinRatesWhenDrawnFromRows(rows, config);
    expect(warden?.winRate.value).toBeNull();
    expect(warden?.winRate.underSampled).toBe(true);
  });

  it('counts distinct fingerprints, so a repeated fingerprint does not clear the floor', () => {
    const rows = Array.from({ length: 500 }, () => row(true, 'same-fingerprint', 'Reef Warden', 0, 1));
    const [warden] = cardWinRatesWhenDrawnFromRows(rows, config);
    expect(warden?.gamesInHand).toBe(500);
    expect(warden?.winRate.distinctSamples).toBe(1);
    expect(warden?.winRate.value).toBeNull();
  });

  it('sorts records by card name', () => {
    const rows = [
      row(true, 'a', 'Zephyr Scout', 0, 1),
      row(true, 'b', 'Zephyr Scout', 0, 1),
      row(true, 'c', 'Zephyr Scout', 0, 1),
      row(true, 'd', 'Zephyr Scout', 0, 1),
      row(true, 'e', 'Ashfall Recruit', 0, 1),
      row(true, 'f', 'Ashfall Recruit', 0, 1),
      row(true, 'g', 'Ashfall Recruit', 0, 1),
      row(true, 'h', 'Ashfall Recruit', 0, 1),
    ];
    const names = cardWinRatesWhenDrawnFromRows(rows, config).map((entry) => entry.cardName);
    expect(names).toEqual(['Ashfall Recruit', 'Zephyr Scout']);
  });

  it('the streaming accumulator produces the same result as the array-based function', () => {
    const rows = [
      row(true, 'a', 'Fen Scout', 1, 0),
      row(true, 'b', 'Fen Scout', 1, 0),
      row(false, 'c', 'Fen Scout', 1, 0),
      row(false, 'd', 'Fen Scout', 1, 0),
    ];
    const accumulator = createCardWinRateAccumulator();
    for (const r of rows) accumulator.add(r);
    expect(accumulator.finish(config)).toEqual(cardWinRatesWhenDrawnFromRows(rows, config));
  });
});
