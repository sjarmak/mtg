/**
 * What one seat may see, and the structural guard that keeps it off the replay
 * path.
 *
 * `seatState` produces a `GameState` that is deliberately not the game's state:
 * the cards it may not identify are gone and the generator is zeroed. That is a
 * value to draw and never one to reduce, and the last test in this file is what
 * makes the claim checkable rather than a promise in a docblock — it reads the
 * kernel's own sources and fails if a module that names the function can also
 * reach a reducer.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { DeckList, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  choose,
  concealedFrom,
  createGame,
  createSession,
  humanSeat,
  seatEvent,
  seatState,
  stateFingerprint,
} from '@mtg/kernel';
import { lands, MOUNTAIN } from './cards';

function deck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP = { seed: 'visibility/v0', decks: [deck('One'), deck('Two')] as const };

function opened(): GameState {
  return createGame(SETUP).state;
}

function named(state: GameState, oid: ObjectId): boolean {
  return state.objects[oid] !== undefined;
}

describe('what a seat may see', () => {
  it('keeps the cards in its own hand', () => {
    const state = opened();
    const view = seatState(state, 0, 'viewer');
    for (const oid of state.players[0].hand) expect(named(view, oid)).toBe(true);
  });

  it('drops the cards in the other seat hand and keeps the count', () => {
    const state = opened();
    const view = seatState(state, 0, 'viewer');
    for (const oid of state.players[1].hand) expect(named(view, oid)).toBe(false);
    expect(view.players[1].hand.length).toBe(state.players[1].hand.length);
  });

  it('drops both libraries, including the viewer own', () => {
    const state = opened();
    const view = seatState(state, 0, 'viewer');
    for (const player of [0, 1] as const) {
      for (const oid of state.players[player].library) expect(named(view, oid)).toBe(false);
      expect(view.players[player].library.length).toBe(state.players[player].library.length);
    }
  });

  it('clears the generator and the seed, which are oracles for everything else', () => {
    const view = seatState(opened(), 0, 'viewer');
    expect(view.rng).toEqual({ a: 0, b: 0, c: 0, d: 0 });
    expect(view.config.seed).toBe('');
  });

  it('names each seat a different set of objects', () => {
    const state = opened();
    const mine = concealedFrom(state, 0);
    const theirs = concealedFrom(state, 1);
    expect(mine).not.toEqual(theirs);
    for (const oid of state.players[0].hand) {
      expect(mine.has(oid)).toBe(false);
      expect(theirs.has(oid)).toBe(true);
    }
  });

  it('keeps every public zone, so a permanent still has a card', () => {
    // Six choices in is enough to have kept two hands and started a turn; the
    // battlefield is where a land played from hand ends up, and a graveyard and
    // a stack are the same rule with a different list.
    let session = createSession(SETUP, [humanSeat('One'), humanSeat('Two')]);
    for (let step = 0; step < 12 && session.pending !== null; step += 1) {
      session = choose(session, session.pending.options.length - 1);
    }
    const view = seatState(session.state, 0, 'viewer');
    for (const oid of session.state.battlefield) expect(named(view, oid)).toBe(true);
    for (const player of [0, 1] as const) {
      for (const oid of session.state.players[player].graveyard) expect(named(view, oid)).toBe(true);
    }
    for (const entry of session.state.exile) expect(named(view, entry)).toBe(true);
  });

  it('is a different position from the one the game is in', () => {
    const state = opened();
    expect(stateFingerprint(seatState(state, 0, 'viewer-0'))).not.toBe(stateFingerprint(state));
    expect(stateFingerprint(seatState(state, 0, 'viewer-0'))).not.toBe(
      stateFingerprint(seatState(state, 1, 'viewer-1')),
    );
  });

  it('leaves the state it was given alone', () => {
    const state = opened();
    const before = stateFingerprint(state);
    seatState(state, 0, 'viewer-0');
    seatState(state, 1, 'viewer-1');
    expect(stateFingerprint(state)).toBe(before);
  });

  it('replaces every concealed-zone id with a key-local placeholder', () => {
    const state = opened();
    const first = seatState(state, 0, 'first-view');
    const second = seatState(state, 0, 'second-view');
    const firstHidden = new Set([
      ...first.players[0].library,
      ...first.players[1].library,
      ...first.players[1].hand,
    ]);
    const secondHidden = new Set([
      ...second.players[0].library,
      ...second.players[1].library,
      ...second.players[1].hand,
    ]);
    for (const oid of [...state.players[0].library, ...state.players[1].library, ...state.players[1].hand]) {
      expect(firstHidden.has(oid)).toBe(false);
      expect(secondHidden.has(oid)).toBe(false);
    }
    for (const oid of firstHidden) {
      expect(secondHidden.has(oid)).toBe(false);
      expect(first.objects[oid]).toBeUndefined();
    }
    expect(first.players[0].hand).toEqual(state.players[0].hand);
  });
});

describe('concealed event identifiers', () => {
  it('uses event-local placeholders for a non-owner and raw ids for the owner or a reveal', () => {
    const draw = { type: 'cardDrawn', player: 1, oid: 'o9' } as const;
    const first = seatEvent(draw, 0, 'first-view', 3);
    const second = seatEvent(draw, 0, 'second-view', 3);
    expect(first).not.toEqual(draw);
    expect(second).not.toEqual(draw);
    expect(first).not.toEqual(second);
    expect(seatEvent(draw, 1, 'owner-view', 3)).toEqual(draw);

    const returned = { type: 'zoneChanged', oid: 'o9', from: 'battlefield', to: 'hand', owner: 1 } as const;
    expect(seatEvent(returned, 0, 'first-view', 4)).not.toEqual(returned);
    const milled = { type: 'zoneChanged', oid: 'o9', from: 'library', to: 'graveyard', owner: 1 } as const;
    expect(seatEvent(milled, 0, 'first-view', 5)).toEqual(milled);

    const kept = { type: 'handKept', player: 1, mulligans: 2, bottomed: ['o9', 'o10'] } as const;
    const projected = seatEvent(kept, 0, 'first-view', 6);
    if (projected.type !== 'handKept') throw new Error('handKept changed event type');
    expect(projected.bottomed).toHaveLength(2);
    expect(projected.bottomed).not.toContain('o9');
    expect(projected.bottomed).not.toContain('o10');

    const reveal = { type: 'handRevealed', player: 1, oids: ['o9', 'o10'] } as const;
    expect(seatEvent(reveal, 0, 'first-view', 7)).toEqual(reveal);
  });
});

/**
 * The structural half. Determinism rests on `reduce`, `fork`, `stateFingerprint`
 * and `replaySession` never seeing a concealed position, and the cheapest way to
 * hold that is to keep the function out of reach of them rather than to audit
 * each of them.
 *
 * The rule used to be that no kernel source but `visibility.ts` and the barrel
 * could so much as name `seatState`, which held while nothing in the kernel had
 * a reason to conceal a position. `backend-projection.ts` has one — the neutral
 * contract's per-seat projection is exactly this function's output, handed to a
 * surface that may be on another machine — so the ledger names it and the rule
 * behind the ledger is checked directly: a module that conceals a position must
 * not be able to reduce one. `backend.ts` calls `choose` and `replaySession`, so
 * it is precisely the file that may not hold concealment, and it does not.
 */
describe('concealment cannot reach a reducer', () => {
  const SRC = new URL('../src/', import.meta.url).pathname;
  /** Each entry is a file allowed to name `seatState`, with why it needs to. */
  const ALLOWED: readonly { readonly file: string; readonly why: string }[] = [
    { file: 'visibility.ts', why: 'defines it' },
    { file: 'index.ts', why: 'exports it' },
    {
      file: 'backend-projection.ts',
      why: "turns a concealed position into @mtg/engine's per-seat projection, and imports nothing that could reduce one",
    },
  ];
  /** A value from any of these is a way back into the game. */
  const REDUCERS = ['./reduce', './fork', './session', './legal'];

  function sources(): readonly string[] {
    return readdirSync(SRC).filter((name) => name.endsWith('.ts'));
  }

  function names(file: string): boolean {
    return readFileSync(join(SRC, file), 'utf8').includes('seatState');
  }

  /** Modules this file imports a value from, as opposed to a type. */
  function valueImports(file: string): readonly string[] {
    const source = readFileSync(join(SRC, file), 'utf8');
    const found: string[] = [];
    for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
      if (match[1] === undefined && match[2] !== undefined) found.push(match[2]);
    }
    return found;
  }

  it('is named only by the files the ledger names', () => {
    const callers = sources().filter((name) => !ALLOWED.some((entry) => entry.file === name) && names(name));
    expect(callers).toEqual([]);
  });

  it('keeps no ledger entry for a file that no longer names it', () => {
    expect(ALLOWED.filter((entry) => !names(entry.file)).map((entry) => entry.file)).toEqual([]);
  });

  it('reaches nothing: no file that conceals a position imports a reducer', () => {
    for (const entry of ALLOWED) {
      if (entry.file === 'index.ts') continue; // the barrel imports everything by definition.
      const imports = valueImports(entry.file);
      for (const forbidden of REDUCERS) {
        expect(imports, `${entry.file} imports a value from ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reads a value import apart from a type import, so the check above is not vacuous', () => {
    // `backend.ts` is the control: it is the file that may not conceal, and the
    // reason is that it imports `choose` and `replaySession` as values.
    expect(valueImports('backend.ts')).toContain('./session');
    expect(valueImports('backend-projection.ts')).toContain('./visibility');
    expect(valueImports('backend-projection.ts')).not.toContain('./legal');
  });
});

/**
 * The counts a seat is entitled to are the ones a status line prints, so
 * concealment must not change them for either player.
 */
describe('concealment preserves what both players can count', () => {
  it('keeps life, hand size, library size and graveyard size for both seats', () => {
    const state = opened();
    for (const viewer of [0, 1] as const) {
      const view = seatState(state, viewer, `viewer-${String(viewer)}`);
      for (const seat of [0, 1] as const) {
        const before = state.players[seat];
        const after = view.players[seat];
        expect(after.life).toBe(before.life);
        expect(after.hand.length).toBe(before.hand.length);
        expect(after.library.length).toBe(before.library.length);
        expect(after.graveyard.length).toBe(before.graveyard.length);
      }
    }
  });

  it('names the viewer by seat, not by relative position', () => {
    const state = opened();
    const viewers: readonly PlayerId[] = [0, 1];
    for (const viewer of viewers) {
      const view = seatState(state, viewer, `viewer-${String(viewer)}`);
      for (const oid of state.players[viewer].hand) expect(named(view, oid)).toBe(true);
    }
  });
});
