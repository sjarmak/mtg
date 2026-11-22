import { describe, expect, it } from 'vitest';
import {
  deckWinRate,
  isLowSampleWinRate,
  parsePrintedDeckWinRates,
  rankOpponentsByCloseness,
  winRatesForDecks,
} from '../src/deck-win-rates';
import type { PrintedDeckWinRates } from '../src/deck-win-rates';

const SOURCE = {
  name: 'Example Tracker',
  url: 'https://example.test/precons',
  retrieved: '2026-10-10',
  sourceUpdated: '2026-10-10T16:02:00Z',
  pageSha256: 'a'.repeat(64),
  measure: 'win rate of the stock list in tracked four-player games',
  minimumSample: 'at least 20 tracked stock games',
  lowSampleBelowGames: 40,
};

function row(deckId: string, winRatePercent: number, games = 100) {
  return {
    name: `Deck ${deckId}`,
    product: 'Example Product',
    commander: `Commander of ${deckId}`,
    winRatePercent,
    games,
    setCode: 'EXA',
    deckId,
  };
}

function table(decks: readonly ReturnType<typeof row>[]): PrintedDeckWinRates {
  return parsePrintedDeckWinRates({
    schemaVersion: 1,
    kind: 'commander-precon-win-rates',
    source: SOURCE,
    decks,
  });
}

function deck(id: string, name = `Deck ${id}`) {
  return { id, name };
}

describe('a deck win-rate table', () => {
  it('reads a table and finds a deck by its id', () => {
    const rates = table([row('north', 27.76, 163), row('south', 21.19, 177)]);
    expect(deckWinRate(rates, 'south')?.winRatePercent).toBe(21.19);
    expect(deckWinRate(rates, 'east')).toBeUndefined();
  });

  it('keeps a row no list here carries, and never finds a deck through it', () => {
    const unlisted = {
      name: 'Deck west',
      product: 'Example Product',
      commander: 'Commander of west',
      winRatePercent: 24,
      games: 60,
    };
    const rates = parsePrintedDeckWinRates({
      schemaVersion: 1,
      kind: 'commander-precon-win-rates',
      source: SOURCE,
      decks: [row('north', 27.76), unlisted],
    });
    expect(rates.decks).toHaveLength(2);
    expect(deckWinRate(rates, 'west')).toBeUndefined();
  });

  it('marks a figure under the source threshold as a low sample', () => {
    const rates = table([row('north', 27.76, 39), row('south', 21.19, 40)]);
    expect(isLowSampleWinRate(rates, rates.decks[0]!)).toBe(true);
    expect(isLowSampleWinRate(rates, rates.decks[1]!)).toBe(false);
  });

  it('refuses a rate outside 0 to 100, a game count that is not a positive whole number, and an unknown field', () => {
    const base = { schemaVersion: 1, kind: 'commander-precon-win-rates', source: SOURCE };
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [row('north', 100.01)] })).toThrow();
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [row('north', -0.01)] })).toThrow();
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [row('north', 25, 0)] })).toThrow();
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [row('north', 25, 12.5)] })).toThrow();
    expect(() =>
      parsePrintedDeckWinRates({ ...base, decks: [{ ...row('north', 25), tier: 'A' }] }),
    ).toThrow();
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [] })).toThrow();
  });

  it('refuses two rows for one deck id, and two rows for one product and name', () => {
    const base = { schemaVersion: 1, kind: 'commander-precon-win-rates', source: SOURCE };
    expect(() =>
      parsePrintedDeckWinRates({
        ...base,
        decks: [row('north', 25), { ...row('north', 26), name: 'Another name' }],
      }),
    ).toThrow(/north/u);
    expect(() =>
      parsePrintedDeckWinRates({
        ...base,
        decks: [row('north', 25), { ...row('south', 26), name: 'Deck north' }],
      }),
    ).toThrow(/Deck north/u);
  });

  it('refuses a row that names a deck id without the set it was printed in, or the set without the id', () => {
    const base = { schemaVersion: 1, kind: 'commander-precon-win-rates', source: SOURCE };
    const { setCode: _setCode, ...idOnly } = row('north', 25);
    const { deckId: _deckId, ...setOnly } = row('north', 25);
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [idOnly] })).toThrow();
    expect(() => parsePrintedDeckWinRates({ ...base, decks: [setOnly] })).toThrow();
  });
});

describe('narrowing a table to the decks one format carries', () => {
  const unlisted = {
    name: 'Deck nowhere',
    product: 'Example Product',
    commander: 'Commander of nowhere',
    winRatePercent: 24,
    games: 60,
  };
  const rates = parsePrintedDeckWinRates({
    schemaVersion: 1,
    kind: 'commander-precon-win-rates',
    source: SOURCE,
    decks: [row('north', 27.76, 163), unlisted, row('south', 21.19, 177), row('east', 20.64, 129)],
  });

  it('keeps the rows for those decks in the table order, with the source they came from', () => {
    const narrowed = winRatesForDecks(rates, [deck('south'), deck('north'), deck('unmeasured')]);
    expect(narrowed?.decks.map((entry) => entry.deckId)).toEqual(['north', 'south']);
    expect(narrowed?.source).toEqual(rates.source);
    expect(parsePrintedDeckWinRates(narrowed)).toEqual(narrowed);
  });

  it('has nothing to say about a format none of whose decks were measured', () => {
    expect(winRatesForDecks(rates, [deck('unmeasured'), deck('nowhere')])).toBeUndefined();
    expect(winRatesForDecks(rates, [])).toBeUndefined();
  });
});

describe('ranking opponents by how close their win rate is', () => {
  const rates = table([
    row('north', 27.76, 163),
    row('south', 21.19, 177),
    row('east', 20.64, 129),
    row('west', 29.5, 90),
  ]);

  it('puts the nearest measured deck first and states each gap from the chosen deck', () => {
    const ranking = rankOpponentsByCloseness(
      deck('north'),
      [deck('east'), deck('south'), deck('west')],
      rates,
    );
    if (ranking.kind !== 'ranked') throw new Error('expected a ranking');
    expect(ranking.mine.deckId).toBe('north');
    expect(ranking.opponents.map((opponent) => opponent.deck.id)).toEqual(['west', 'south', 'east']);
    const gaps = ranking.opponents.map((opponent) => (opponent.measured ? opponent.gapPoints : null));
    expect(gaps[0]).toBeCloseTo(1.74, 10);
    expect(gaps[1]).toBeCloseTo(-6.57, 10);
    expect(gaps[2]).toBeCloseTo(-7.12, 10);
  });

  it('lists decks with no figure last, in name order, whatever order they arrived in', () => {
    const ranking = rankOpponentsByCloseness(
      deck('north'),
      [deck('zulu', 'Zulu'), deck('south'), deck('alpha', 'Alpha'), deck('mike', 'Mike')],
      rates,
    );
    if (ranking.kind !== 'ranked') throw new Error('expected a ranking');
    expect(ranking.opponents.map((opponent) => opponent.deck.id)).toEqual(['south', 'alpha', 'mike', 'zulu']);
    expect(ranking.opponents.map((opponent) => opponent.measured)).toEqual([true, false, false, false]);
  });

  it('keeps equally close decks in the order they arrived in', () => {
    const level = table([row('mid', 25), row('above', 27), row('below', 23), row('same', 25)]);
    const forward = rankOpponentsByCloseness(
      deck('mid'),
      [deck('above'), deck('below'), deck('same')],
      level,
    );
    const backward = rankOpponentsByCloseness(
      deck('mid'),
      [deck('below'), deck('above'), deck('same')],
      level,
    );
    if (forward.kind !== 'ranked' || backward.kind !== 'ranked') throw new Error('expected rankings');
    expect(forward.opponents.map((opponent) => opponent.deck.id)).toEqual(['same', 'above', 'below']);
    expect(backward.opponents.map((opponent) => opponent.deck.id)).toEqual(['same', 'below', 'above']);
  });

  it('answers that there is nothing to rank against when the chosen deck has no figure', () => {
    expect(rankOpponentsByCloseness(deck('unlisted'), [deck('north'), deck('south')], rates)).toEqual({
      kind: 'unmeasured',
    });
  });

  it('holds its ordering over generated tables and deck lists', () => {
    let state = 0x5eed1e55;
    const next = (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
    for (let round = 0; round < 400; round += 1) {
      const size = 2 + Math.floor(next() * 12);
      const ids = Array.from({ length: size }, (_, index) => `d${String(index)}`);
      const measuredIds = ids.filter(() => next() < 0.7);
      if (measuredIds.length === 0) measuredIds.push(ids[0]!);
      const generated = table(
        measuredIds.map((id) => row(id, Math.round(next() * 40 * 4) / 4 + 5, 20 + Math.floor(next() * 500))),
      );
      const mine = deck(ids[Math.floor(next() * size)]!);
      const opponents = ids
        .filter((id) => id !== mine.id)
        .map((id) => ({ id, name: `Name ${String(Math.floor(next() * 5))} ${id}`, order: next() }))
        .sort((left, right) => left.order - right.order)
        .map(({ id, name }) => deck(id, name));
      const ranking = rankOpponentsByCloseness(mine, opponents, generated);
      const mineRate = deckWinRate(generated, mine.id);
      if (mineRate === undefined) {
        expect(ranking).toEqual({ kind: 'unmeasured' });
        continue;
      }
      if (ranking.kind !== 'ranked') throw new Error('a measured deck must be ranked');
      const ranked = ranking.opponents;
      expect([...ranked.map((opponent) => opponent.deck.id)].sort()).toEqual(
        [...opponents.map((opponent) => opponent.id)].sort(),
      );
      const firstUnmeasured = ranked.findIndex((opponent) => !opponent.measured);
      const measured = firstUnmeasured === -1 ? ranked : ranked.slice(0, firstUnmeasured);
      const unmeasured = firstUnmeasured === -1 ? [] : ranked.slice(firstUnmeasured);
      expect(measured.every((opponent) => opponent.measured)).toBe(true);
      expect(unmeasured.every((opponent) => !opponent.measured)).toBe(true);
      for (const opponent of measured) {
        if (!opponent.measured) continue;
        expect(deckWinRate(generated, opponent.deck.id)).toBe(opponent.rate);
        expect(opponent.gapPoints).toBe(opponent.rate.winRatePercent - mineRate.winRatePercent);
      }
      for (let index = 1; index < measured.length; index += 1) {
        const before = measured[index - 1]!;
        const after = measured[index]!;
        if (!before.measured || !after.measured) continue;
        const nearer = Math.abs(before.gapPoints);
        const farther = Math.abs(after.gapPoints);
        expect(nearer).toBeLessThanOrEqual(farther);
        if (nearer === farther) {
          expect(opponents.indexOf(before.deck)).toBeLessThan(opponents.indexOf(after.deck));
        }
      }
      for (let index = 1; index < unmeasured.length; index += 1) {
        expect(
          unmeasured[index - 1]!.deck.name.localeCompare(unmeasured[index]!.deck.name, 'en'),
        ).toBeLessThanOrEqual(0);
      }
    }
  });
});
