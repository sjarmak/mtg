/**
 * The seam between this page and the server that holds its game.
 *
 * Two rules, and both of them fail silently if nobody looks.
 *
 * **1. `@mtg/ui`'s `src/` may name `@mtg/netplay` only in a type position.**
 * That package's barrel exports `serveTable`, which reaches `node:http`, and
 * everything under `src/` is bundled by Vite. A type-only import is erased
 * before the bundler ever resolves it; a value import from the same specifier
 * puts a Node built-in in a browser bundle and the failure is a blank page with
 * a console error. `@mtg/ui` already carries this arrangement for `@mtg/sim`
 * (`vite.config.ts` names it) and this is the second one, so it is checked
 * rather than remembered. `tools/` is exempt and imports the package outright,
 * because a launcher is Node.
 *
 * **2. The two ends of the wire agree.** They meet at a shape and a version
 * number rather than a shared import, which is the same bargain
 * `lab/deck-artifact.ts` strikes with `@mtg/decklab` and `lab/art-manifest.ts`
 * strikes with the art pipeline. So the check is the one that pipeline's own
 * manifest test makes: build a real payload with the producer, read it with this
 * side's reader, and fail when they have drifted.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat } from '@mtg/kernel';
import { createTable, MAX_NETPLAY_DECISIONS, NETPLAY_PROTOCOL, toWireAutoPass } from '@mtg/netplay';
import { CLIENT_PROTOCOL, MAX_SNAPSHOT_DECISIONS, readSnapshot, sessionViewOf } from '../../src/net/snapshot';

const SRC = new URL('../../src/', import.meta.url).pathname;

function sources(dir: string, into: string[] = []): readonly string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, into);
    else if (entry.name.endsWith('.ts')) into.push(path);
  }
  return into;
}

/** Lines that import from `@mtg/netplay` without `import type`. */
function valueImports(): readonly string[] {
  const offenders: string[] = [];
  for (const path of sources(SRC)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes("from '@mtg/netplay'")) continue;
      if (line.trimStart().startsWith('import type ')) continue;
      offenders.push(`${path}: ${line.trim()}`);
    }
  }
  return offenders;
}

/** A playable mirror out of the DSL fixtures; this file is about the seam, not the cards. */
function deck(name: string): DeckList {
  const cards: Card[] = [
    ...Array.from({ length: 17 }, () => exampleCard('slc-mountain')),
    ...Array.from({ length: 23 }, () => exampleCard('slc-emberflow-raider')),
  ];
  return { name, cards };
}

function table(): ReturnType<typeof createTable> {
  return createTable({
    id: 'seam',
    setup: { seed: 'ui/netplay/seam', decks: [deck('One'), deck('Two')], maximumTurns: 20 },
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: 'token-two' },
    ],
  });
}

describe('the browser half of netplay', () => {
  it('names the package only in a type position', () => {
    expect(valueImports()).toEqual([]);
  });

  it('imports it somewhere, so the check is measuring something', () => {
    const naming = sources(SRC).filter((path) => readFileSync(path, 'utf8').includes("from '@mtg/netplay'"));
    expect(naming.length).toBeGreaterThan(0);
  });
});

describe('the two ends of the wire', () => {
  it('agree about the protocol version', () => {
    expect(NETPLAY_PROTOCOL).toBe(3);
    expect(CLIENT_PROTOCOL).toBe(NETPLAY_PROTOCOL);
  });

  it('agrees on the bounded decision count without allocating dummy choices', () => {
    expect(MAX_SNAPSHOT_DECISIONS).toBe(MAX_NETPLAY_DECISIONS);
    const snapshot = {
      ...table().snapshotFor(0),
      decisions: MAX_NETPLAY_DECISIONS,
      choices: { length: MAX_NETPLAY_DECISIONS },
    };
    const parsed = readSnapshot(snapshot, 'the table');
    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true);
    if (!parsed.ok) return;
    const view = sessionViewOf(parsed.snapshot);
    expect(Array.isArray(view.choices)).toBe(false);
    expect(view.choices.length).toBe(MAX_NETPLAY_DECISIONS);
  });

  it('refuses oversized or uncorrelated counts without materializing them', () => {
    const base = table().snapshotFor(0);
    for (const snapshot of [
      { ...base, decisions: MAX_NETPLAY_DECISIONS + 1 },
      { ...base, decisions: 4_294_967_296, choices: { length: 4_294_967_296 } },
      { ...base, decisions: 10, choices: { length: 11 } },
    ]) {
      expect(() => readSnapshot(snapshot, 'the hostile table')).not.toThrow();
      expect(readSnapshot(snapshot, 'the hostile table').ok).toBe(false);
    }
  });

  it('reads a payload the server actually built, through JSON', () => {
    const snapshot = table().snapshotFor(0);
    // Through `JSON.parse(JSON.stringify(...))` rather than passed as an object,
    // because that round trip is the only place a `Set` or an `undefined` turns
    // into something else, and the stop set is a set.
    const wire: unknown = JSON.parse(JSON.stringify(snapshot));
    const parsed = readSnapshot(wire, 'the table');
    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.seat).toBe(0);
    expect(parsed.snapshot.names).toEqual(['One', 'Two']);
    expect(sessionViewOf(parsed.snapshot).state.players[0].hand.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.snapshot.choices)).toBe(false);
    expect(sessionViewOf(parsed.snapshot).choices.length).toBe(parsed.snapshot.choices.length);
  });

  it('refuses the former raw choice recording shape', () => {
    const snapshot = { ...table().snapshotFor(0), choices: [0, 1, 2] };
    const parsed = readSnapshot(snapshot, 'the table');
    expect(parsed).toEqual({ ok: false, message: 'the table sent no choice count' });
  });

  it('refuses a payload from a server speaking another protocol', () => {
    const snapshot = { ...table().snapshotFor(0), protocol: CLIENT_PROTOCOL + 1 };
    const parsed = readSnapshot(JSON.parse(JSON.stringify(snapshot)), 'the table');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('protocol');
  });

  it('refuses the version-1 player-only defender protocol', () => {
    const snapshot = { ...table().snapshotFor(0), protocol: 1 };
    const parsed = readSnapshot(JSON.parse(JSON.stringify(snapshot)), 'the stale table');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('protocol 1');
  });

  it('refuses a payload with a field missing rather than drawing a board out of it', () => {
    const full = table().snapshotFor(0) as unknown as Record<string, unknown>;
    for (const field of ['seat', 'names', 'state', 'events', 'choices', 'autoPass', 'awaiting']) {
      const { [field]: _dropped, ...rest } = full;
      const parsed = readSnapshot(JSON.parse(JSON.stringify(rest)), 'the table');
      expect(parsed.ok, `a payload with no ${field} was accepted`).toBe(false);
    }
  });

  it('carries a stop set across JSON, which a set does not survive on its own', () => {
    const wire = toWireAutoPass(DEFAULT_AUTO_PASS);
    const through: unknown = JSON.parse(JSON.stringify(wire));
    expect(through).toEqual(wire);
    expect(wire.stops.yourTurn.length).toBe(DEFAULT_AUTO_PASS.stops.yourTurn.size);
    expect(wire.stops.yourTurn.length).toBeGreaterThan(0);
  });
});
