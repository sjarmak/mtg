/**
 * Whole-game match probes shared by every printed format: pregame choices,
 * mulligans and native priority, proven through public state only. A format
 * supplies its name, one audited creature and the seeds its receipts bind.
 */
import { expect, it } from 'vitest';
import type { DeckRef, MatchRules, ObservedSession, SeatId, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './snapshot-backend';

export interface PrintedMatchFixture {
  /** Printed format id, as the session spec and every receipt name it. */
  readonly format: string;
  /** Prefix of every test title, so probe configs can bind assertions by name. */
  readonly title: string;
  /** One basic land and one audited creature it casts, with the creature's mana value. */
  readonly land: string;
  readonly creature: string;
  readonly creatureManaValue: number;
  /**
   * The rules every probe table plays under; absent is the standard game.
   * A commander fixture also names each seat's commanders, in seat order,
   * because a commander table seats no deck without one.
   */
  readonly rules?: MatchRules;
  readonly commanders?: readonly [readonly string[], readonly string[]];
  readonly seeds: {
    /** Gives the engine seat the starting choice in the local pregame probe. */
    readonly engineStarts: string;
    /** Lets the local seat win the toss; also opens a land-light engine hand into a native mulligan. */
    readonly localToss: string;
    readonly nativePriority: string;
  };
}

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const TIMEOUT_MS = 180_000;

function deck(
  fixture: PrintedMatchFixture,
  seat: SeatId,
  name: string,
  land: [string, number],
  creature: [string, number],
): DeckRef {
  const commanders = fixture.commanders?.[seat];
  return {
    name,
    cards: [land, creature].flatMap(([card, count]) => (count > 0 ? [{ name: card, count }] : [])),
    ...(commanders === undefined ? {} : { commanders: commanders.map((card) => ({ name: card, count: 1 })) }),
  };
}

function rulesOf(fixture: PrintedMatchFixture): Pick<SessionSpec, 'rules'> {
  return fixture.rules === undefined ? {} : { rules: fixture.rules };
}

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

async function withSession(
  table: SessionSpec,
  check: (session: ObservedSession) => Promise<ObservedSession | undefined>,
): Promise<void> {
  const backend = await snapshotForgeBackend({ timeoutMs: TIMEOUT_MS });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  try {
    expect(await backend.supports(table)).toEqual([]);
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    session = await check(session);
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

/** Native starting choice is observed through pregame and the first public turn. */
export function engineStartingPlayerProbe(fixture: PrintedMatchFixture): void {
  forgeIt(
    `${fixture.title} engine-controlled starting choice reaches its first turn without a local starting move`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: fixture.format },
        ...rulesOf(fixture),
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: deck(fixture, 0, 'observer', [fixture.land, 60], [fixture.creature, 0]),
          },
          {
            name: 'Native pilot',
            controller: 'engine',
            deck: deck(fixture, 1, 'native opening', [fixture.land, 30], [fixture.creature, 30]),
          },
        ],
        seed: fixture.seeds.engineStarts,
        maximumTurns: 2,
      };
      await withSession(table, async (opened) => {
        let session = opened;
        expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
        expect(session.view.seats[0].hand).toHaveLength(7);
        expect(session.view.seats[1].hand).toBeNull();
        expect(session.decision?.options.some((move) => move.id.startsWith('pregame-start-'))).toBe(false);
        expect((await session.submit('pregame-start-seat-0')).ok).toBe(false);
        session = await submit(session, 'pregame-keep');
        expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
        expect(session.view.turn).toMatchObject({ active: 1, number: 1 });
        expect(session.view.priority).toBe(0);
        expect(session.view.stack).toHaveLength(0);
        expect(session.view.seats[1].hand).toBeNull();
        expect(session.view.seats[1].battlefield).toHaveLength(0);
        expect(session.view.seats[1].graveyard).toHaveLength(0);
        expect(session.view.seats[1].exile).toHaveLength(0);
        expect(session.view.seats[1].handSize + session.view.seats[1].librarySize).toBe(60);
        expect(session.view.seats[0].handSize).toBe(7);
        expect(session.view.seats[0].librarySize).toBe(53);
        return session;
      });
    },
    TIMEOUT_MS,
  );
}

/** Public native mulligan events and zone counts, not hidden-card selection quality. */
export function engineMulliganProbe(fixture: PrintedMatchFixture): void {
  forgeIt(
    `${fixture.title} native mulligans emit public evidence and conserve the hidden opening deck`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: fixture.format },
        ...rulesOf(fixture),
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: deck(fixture, 0, 'observer', [fixture.land, 60], [fixture.creature, 0]),
          },
          {
            name: 'Native pilot',
            controller: 'engine',
            deck: deck(fixture, 1, 'land-light opening', [fixture.land, 12], [fixture.creature, 48]),
          },
        ],
        seed: fixture.seeds.localToss,
        maximumTurns: 2,
      };
      await withSession(table, async (opened) => {
        let session = opened;
        expect(session.decision).toMatchObject({ kind: 'starting-player', seat: 0 });
        for (const move of ['pregame-start-seat-0', 'pregame-keep']) session = await submit(session, move);
        expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
        expect(session.view.turn.active).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        expect(bot.handSize).toBeGreaterThan(0);
        expect(bot.handSize).toBeLessThan(7);
        expect(bot.handSize + bot.librarySize).toBe(60);
        expect(bot.battlefield).toHaveLength(0);
        expect(bot.graveyard).toHaveLength(0);
        expect(bot.exile).toHaveLength(0);
        const logs = session.events.filter((event) => event.type === 'Mulligan');
        const native = logs.filter((event) => event.text.startsWith('Native pilot has mulliganed'));
        expect(native.length, JSON.stringify(session.events)).toBeGreaterThan(0);
        const counts = native.map((event) => {
          expect(event.reveals).toHaveLength(0);
          const match = /^Native pilot has mulliganed down to (\d+) cards\.$/u.exec(event.text);
          expect(match).not.toBeNull();
          return Number(match![1]);
        });
        expect(Math.min(...counts)).toBe(bot.handSize);
        expect(logs.some((event) => event.text.startsWith('Observer has mulliganed'))).toBe(false);
        return session;
      });
    },
    TIMEOUT_MS,
  );
}

/** Format-qualified public pregame outcomes; no claims about the hidden bot policy. */
export function localPregameProbes(fixture: PrintedMatchFixture): void {
  const table: SessionSpec = {
    content: { kind: 'printed', format: fixture.format },
    ...rulesOf(fixture),
    seats: [
      {
        name: 'Local pilot',
        controller: 'local',
        deck: deck(fixture, 0, 'local opening', [fixture.land, 30], [fixture.creature, 30]),
      },
      {
        name: 'Native pilot',
        controller: 'engine',
        deck: deck(fixture, 1, 'native opening', [fixture.land, 30], [fixture.creature, 30]),
      },
    ],
    seed: fixture.seeds.localToss,
    maximumTurns: 4,
  };

  for (const first of [0, 1] as const) {
    forgeIt(
      `${fixture.title} local starting choice honors seat ${first} and reaches legal priority`,
      async () => {
        await withSession(table, async (initial) => {
          expect(initial.decision).toMatchObject({ kind: 'starting-player', seat: 0, complete: true });
          expect(initial.decision?.options.map((option) => option.id).sort()).toEqual([
            'pregame-start-seat-0',
            'pregame-start-seat-1',
          ]);
          expect(initial.view.seats[1].hand).toBeNull();
          expect((await initial.submit('pregame-start-seat-2')).ok).toBe(false);
          let session = await submit(initial, `pregame-start-seat-${first}`);
          expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
          expect(session.view.seats[0].hand).toHaveLength(7);
          session = await submit(session, 'pregame-keep');
          expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
          expect(session.view.turn.active).toBe(first);
          expect(session.view.priority).toBe(0);
          expect(session.view.seats[1].hand).toBeNull();
          const pass = session.decision?.options.find((option) => option.text === 'Pass priority');
          expect(pass).toBeDefined();
          expect((await session.submit(`pregame-start-seat-${first}`)).ok).toBe(false);
          const next = await submit(session, pass!.id);
          expect(next.status).toBe('awaiting');
          expect(next.view.turn.active).toBe(first);
          expect(next.view.seats[1].hand).toBeNull();
          return next;
        });
      },
      TIMEOUT_MS,
    );
  }

  forgeIt(
    `${fixture.title} local London mulligans bottom exact visible cards and preserve library counts`,
    async () => {
      await withSession(table, async (initial) => {
        let session = await submit(initial, 'pregame-start-seat-0');
        for (const count of [1, 2]) {
          session = await submit(session, 'pregame-mulligan');
          expect(session.decision).toMatchObject({ kind: 'mulligan-bottom', seat: 0, complete: true });
          expect(session.view.seats[0].hand).toHaveLength(7);
          expect(session.view.seats[0].librarySize).toBe(53);
          expect(session.decision?.options).toHaveLength(count === 1 ? 7 : 21);
          const choice = session.decision!.options.at(-1)!;
          const bottomed = [...choice.text.matchAll(/\[(forge-card-\d+)\]/gu)].map((match) => match[1]!);
          expect(bottomed).toHaveLength(count);
          const before = session.view.seats[0].hand!.map((card) => card.oid);
          expect(bottomed.every((id) => before.includes(id))).toBe(true);
          session = await submit(session, choice.id);
          expect(session.decision).toMatchObject({ kind: 'mulligan', seat: 0, complete: true });
          expect(session.view.seats[0].hand!.map((card) => card.oid).sort()).toEqual(
            before.filter((id) => !bottomed.includes(id)).sort(),
          );
          expect(session.view.seats[0].handSize).toBe(7 - count);
          expect(session.view.seats[0].librarySize).toBe(53 + count);
          expect(session.view.seats[0].graveyard).toHaveLength(0);
          expect(session.view.seats[0].exile).toHaveLength(0);
          expect(session.view.seats[1].hand).toBeNull();
          expect((await session.submit(choice.id)).ok).toBe(false);
        }
        session = await submit(session, 'pregame-keep');
        expect(session.decision).toMatchObject({ kind: 'priority', seat: 0, complete: true });
        expect(session.view.seats[0].handSize).toBe(5);
        expect(session.view.seats[0].librarySize).toBe(55);
        return session;
      });
    },
    TIMEOUT_MS,
  );
}

/** Native priority actions proven through public stack transitions, never hidden hands. */
export function enginePriorityProbe(fixture: PrintedMatchFixture): void {
  forgeIt(
    `${fixture.title} native priority casts ${fixture.creature} and yields before its exact resolution`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: fixture.format },
        ...rulesOf(fixture),
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: deck(fixture, 0, 'passive', [fixture.land, 60], [fixture.creature, 0]),
          },
          {
            name: 'Native pilot',
            controller: 'engine',
            deck: deck(fixture, 1, 'native priority', [fixture.land, 30], [fixture.creature, 30]),
          },
        ],
        seed: fixture.seeds.nativePriority,
        maximumTurns: 12,
      };
      await withSession(table, async (opened) => {
        let session = opened;
        let resolved = false;
        for (let index = 0; index < 600 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing local decision');
          expect(decision.seat).toBe(0);
          expect(session.view.seats[1].hand).toBeNull();
          const creature = session.view.stack.find((card) => card.name === fixture.creature);
          if (creature !== undefined) {
            expect(decision).toMatchObject({ kind: 'priority', complete: true });
            expect(session.view.priority).toBe(0);
            expect(session.view.turn.active).toBe(1);
            expect(session.view.seats[1].battlefield.filter((card) => card.tapped)).toHaveLength(
              fixture.creatureManaValue,
            );
            const handSize = session.view.seats[1].handSize;
            const pass = decision.options.find((option) => option.text === 'Pass priority');
            expect(pass).toBeDefined();
            session = await submit(session, pass!.id);
            expect(session.view.stack.some((card) => card.oid === creature.oid)).toBe(false);
            expect(session.view.seats[1].battlefield.find((card) => card.oid === creature.oid)).toMatchObject(
              {
                name: fixture.creature,
              },
            );
            expect(session.view.seats[1].handSize).toBe(handSize);
            expect(session.view.seats[1].hand).toBeNull();
            resolved = true;
            break;
          }
          const move =
            decision.options.find((option) => option.text === `Play ${fixture.land}`) ??
            decision.options.find((option) =>
              ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text),
            );
          if (move === undefined) throw new Error(`Unexpected local decision: ${decision.kind}`);
          session = await submit(session, move.id);
        }
        expect(resolved, 'Native pilot must cast and resolve a creature within the fixture').toBe(true);
        return session;
      });
    },
    TIMEOUT_MS,
  );
}
