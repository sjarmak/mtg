/**
 * The contract holds a shape, and the shape is checked against something that is
 * not our kernel.
 *
 * `@mtg/kernel`'s own `test/backend.test.ts` proves the kernel satisfies the
 * contract, which is the criterion the bead states. This file proves the other
 * half, which is the one a contract fails silently: that the contract is
 * inhabitable by a backend built from none of the kernel's assumptions, and that
 * the determinism split is a split rather than a comment.
 */
import { describe, expect, it } from 'vitest';
import type {
  EngineEvent,
  EngineSession,
  Finding,
  GameBackend,
  MoveId,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  PendingDecision,
  ProjectingSession,
  RecordedBackend,
  SeatId,
  SeatView,
  SessionSpec,
  SubmitResult,
  TableView,
} from '@mtg/engine';
import {
  PROJECTION_VERSION,
  SEAT_IDS,
  checkBackend,
  isRecorded,
  isRecordedSession,
  projectsPerSeat,
  scriptBackend,
} from '@mtg/engine';

const PRINTED: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'contract-test',
  maximumTurns: null,
};

/** Two people at one table, which is the case a per-seat projection is for. */
const SEATED: SessionSpec = {
  ...PRINTED,
  seats: [PRINTED.seats[0], { ...PRINTED.seats[1], controller: 'local' }],
};

const GENERATED: SessionSpec = { ...PRINTED, content: { kind: 'dsl-set', setCode: 'TDG' } };

describe('a backend that is not the kernel', () => {
  it('satisfies the conformance suite', async () => {
    expect(await checkBackend(scriptBackend(), PRINTED)).toEqual([]);
  });

  it('refuses content it does not play, by name', async () => {
    const refusals = await scriptBackend().supports(GENERATED);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('dsl-set');
  });

  it('reports a refusal as a value rather than a throw', async () => {
    const opened = await scriptBackend().open(GENERATED);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.kind).toBe('content-unresolved');
  });

  it('grows one transcript frame per move, and holds no record', async () => {
    const opened = await scriptBackend({ clock: 3 }).open(PRINTED);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let session = opened.session;
    expect(session.transcript).toHaveLength(1);
    const first = session.decision?.options[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const next = await session.submit(first.id);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    session = next.session;
    expect(session.transcript).toHaveLength(2);
    expect(session.transcript[1]?.move).toBe(first.id);
  });
});

/**
 * A truncated enumeration is a hole in the channel, and the channel already has
 * the tool that closes it.
 *
 * `decision.ts` argues this and `mtg-bc2.151.1` asked it. The subject below is a
 * combat toy rather than the kernel, for the same reason `scriptBackend` exists:
 * the claim is about the *contract*, so it must hold for a backend built from
 * none of the kernel's assumptions. It declares blocks the two ways a backend
 * can — one product listed flat under a cap, or one small question per blocker —
 * and the numbers are the kernel's measured ones on the board the bead names:
 * six blockers against two attackers is 729 declarations and a 512 cap.
 */
describe('a decision a backend could not finish listing', () => {
  const BLOCKERS = 6;
  const ATTACKERS = 2;
  const CAP = 512;
  /** Every assignment of each blocker to an attacker or to nothing. */
  const TOTAL = (ATTACKERS + 1) ** BLOCKERS;

  interface Combat {
    /** How many blockers a whole declaration assigns. */
    readonly blockers: number;
    readonly attackers: number;
    /** How many it will list before giving up. Flat mode only. */
    readonly cap: number;
    /** Whether it asks one question per blocker instead of one for the product. */
    readonly decomposed: boolean;
  }

  /** Every tuple of length `blockers` over `0..attackers`, 0 meaning unblocked. */
  function assignments(spec: Combat): readonly (readonly number[])[] {
    let space: (readonly number[])[] = [[]];
    for (let slot = 0; slot < spec.blockers; slot += 1) {
      const grown: (readonly number[])[] = [];
      for (const prefix of space) {
        for (let pick = 0; pick <= spec.attackers; pick += 1) grown.push([...prefix, pick]);
      }
      space = grown;
    }
    return space;
  }

  function seatOf(id: SeatId, name: string): SeatView {
    return {
      id,
      name,
      life: 20,
      hand: null,
      handSize: 0,
      librarySize: 0,
      graveyard: [],
      battlefield: [],
    };
  }

  /**
   * What the submitted moves assigned, which is where the two modes differ.
   *
   * A flat move names the whole declaration and settles every blocker at once; a
   * decomposed move names one blocker's answer. The position is derived from the
   * moves either way, so `submitted` counts submits and never picks.
   */
  function picksFrom(spec: Combat, taken: readonly MoveId[]): readonly number[] {
    if (!spec.decomposed) {
      const last = taken[taken.length - 1];
      if (last === undefined) return [];
      return last
        .slice(last.indexOf(':') + 1)
        .split('-')
        .map(Number);
    }
    return taken.map((move) => Number(move.slice(move.indexOf(':') + 1)));
  }

  function decisionOf(spec: Combat, picks: readonly number[]): PendingDecision | null {
    if (picks.length === spec.blockers) return null;
    if (spec.decomposed) {
      return {
        seat: 1,
        kind: 'declareBlockers',
        prompt: `blocker ${String(picks.length)}: which attacker, if any`,
        options: Array.from({ length: spec.attackers + 1 }, (_unused, pick) => ({
          id: `pick:${String(pick)}`,
          text: pick === 0 ? 'block nothing' : `block attacker ${String(pick)}`,
          targets: [],
        })),
        complete: true,
      };
    }
    const whole = assignments(spec);
    return {
      seat: 1,
      kind: 'declareBlockers',
      prompt: 'declare blockers',
      options: whole.slice(0, spec.cap).map((one) => ({
        id: `whole:${one.join('-')}`,
        text: `block as ${one.join('-')}`,
        targets: [],
      })),
      complete: whole.length <= spec.cap,
    };
  }

  /**
   * A combat backend on the observed arm, with nothing of the kernel in it.
   *
   * Flat mode is the shape `blockerDecision` has today: the product, listed, cut
   * off at a cap. Decomposed mode asks the same product as a sequence, which is
   * the answer, and it uses no term this contract does not already carry.
   */
  function combatBackend(spec: Combat): ObservedBackend {
    const session = (table: SessionSpec, taken: readonly MoveId[], closed = false): ObservedSession => {
      const picks = picksFrom(spec, taken);
      const done = picks.length === spec.blockers;
      const decision = closed ? null : decisionOf(spec, picks);
      const view: TableView = {
        version: PROJECTION_VERSION,
        turn: { number: 1, active: 0, phase: 'combat', step: 'declareBlockers' },
        priority: null,
        stack: [],
        seats: [seatOf(0, 'North'), seatOf(1, 'South')],
      };
      const events: readonly EngineEvent[] = picks.map((pick, seq) => ({
        seq,
        type: 'blockerAssigned',
        text: `blocker ${String(seq)} was assigned to ${String(pick)}`,
        detail: { pick },
        // A blocker assignment is public by CR 400.2 and names nothing hidden,
        // so there is nothing here for a seat to newly identify.
        reveals: [],
      }));
      return {
        backend: 'combat-toy',
        determinism: 'observed',
        table,
        status: closed ? 'closed' : done ? 'finished' : 'awaiting',
        view,
        events,
        decision,
        result: done ? { winner: null, reason: 'blocks declared', endedOnTurn: 1 } : null,
        seats: null,
        submitted: taken.length,
        localSeats: [1],
        // One frame per position, which is one more than the moves that reached
        // it. Flat mode's whole declaration is one move and one frame however
        // many blockers it assigned, which is the difference between the two
        // modes stated in the transcript rather than argued.
        transcript: Array.from({ length: taken.length + 1 }, (_unused, seq) => ({
          seq,
          view,
          events: events.slice(0, picksFrom(spec, taken.slice(0, seq)).length),
          move: seq === 0 ? null : (taken[seq - 1] ?? null),
        })),
        submit: (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
          if (decision === null) {
            return Promise.resolve({
              ok: false,
              error: { kind: 'no-decision-pending', message: 'blocks are already declared' },
            });
          }
          if (!decision.options.some((option) => option.id === move)) {
            return Promise.resolve({
              ok: false,
              error: {
                kind: 'unknown-move',
                message: `"${move}" is not one of the moves offered`,
                offered: decision.options.length,
              },
            });
          }
          return Promise.resolve({ ok: true, session: session(table, [...taken, move]) });
        },
        close: (): Promise<void> => Promise.resolve(),
      };
    };
    return {
      id: 'combat-toy',
      determinism: 'observed',
      capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: false },
      supports: (): Promise<readonly string[]> => Promise.resolve([]),
      open: (table: SessionSpec): Promise<OpenResult<ObservedSession>> =>
        Promise.resolve({ ok: true, session: session(table, []) }),
    };
  }

  /**
   * Every whole declaration a surface can reach through `submit` alone.
   *
   * No constructed move, no backend-specific type, no id this backend did not
   * hand out: it takes each listed option in turn and reads the position it
   * lands in. That is the whole of what a neutral surface may do, so the size of
   * this set is exactly the size of the channel.
   */
  async function reachable(backend: ObservedBackend, table: SessionSpec): Promise<ReadonlySet<string>> {
    const found = new Set<string>();
    const walk = async (session: ObservedSession, taken: readonly string[]): Promise<void> => {
      const decision = session.decision;
      if (decision === null) {
        found.add(taken.join('/'));
        return;
      }
      for (const option of decision.options) {
        const result = await session.submit(option.id);
        if (!result.ok) throw new Error(`an offered move was refused: ${result.error.kind}`);
        await walk(result.session, [...taken, option.id]);
      }
    };
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error('the combat toy refused to open');
    await walk(opened.session, []);
    return found;
  }

  const FLAT: Combat = { blockers: BLOCKERS, attackers: ATTACKERS, cap: CAP, decomposed: false };
  const SEQUENCE: Combat = { ...FLAT, decomposed: true };

  it('is the board the bead names: 729 declarations against a cap of 512', () => {
    expect(TOTAL).toBe(729);
    const flat = decisionOf(FLAT, []);
    expect(flat?.options).toHaveLength(CAP);
    expect(flat?.complete).toBe(false);
  });

  it('leaves 217 legal declarations with no id, which no surface can reach', async () => {
    const found = await reachable(combatBackend(FLAT), PRINTED);
    expect(found.size).toBe(CAP);
    expect(TOTAL - found.size).toBe(217);
  });

  it('reaches every one of them once the same product is asked as a sequence', async () => {
    const found = await reachable(combatBackend(SEQUENCE), PRINTED);
    expect(found.size).toBe(TOTAL);
  });

  it('is reported as a finding, because the backend had the other option', async () => {
    const findings = await checkBackend(combatBackend(FLAT), PRINTED);
    // Exactly one finding, and it is this one: the toy is conformant in every
    // other respect, so nothing else is standing in for the truncation.
    expect(findings.map((one) => one.check)).toEqual(['enumeration']);
    const finding = findings[0];
    expect(finding?.detail).toContain('declareBlockers');
    expect(finding?.detail).toContain('512');
  });

  it('is not reported against the backend that decomposed it', async () => {
    expect(await checkBackend(combatBackend(SEQUENCE), PRINTED)).toEqual([]);
  });

  it('holds a backend that is not the kernel to it too', async () => {
    const findings = await checkBackend(scriptBackend({ clock: 3, truncate: true }), PRINTED);
    expect(findings.map((one) => one.check)).toEqual(['enumeration', 'enumeration', 'enumeration']);
  });
});

/**
 * Which move the suite takes is the caller's, because the default is not neutral.
 *
 * `options[0]` is the cheapest move on most backends and the cheapest move is
 * usually "do nothing", so a suite that only ever takes it walks the emptiest
 * game the backend can play. That is a fine default for reproducibility and a
 * poor one for `checkEnumeration`, which has nothing to judge until a position
 * gets wide. `mtg-cs8t` found the kernel's own conformance run reaching combat
 * zero times for exactly that reason.
 */
describe('the policy the suite walks a game with', () => {
  /** Runs the toy under one policy and reports how far the walk got. */
  async function walkUnder(take: 'first' | 'last'): Promise<{ seen: number; findings: number }> {
    let seen = 0;
    const findings = await checkBackend(scriptBackend(), PRINTED, {
      pick: (decision) => {
        seen += 1;
        const move = take === 'first' ? decision.options[0] : decision.options[decision.options.length - 1];
        if (move === undefined) throw new Error('the decision offered nothing to take');
        return move.id;
      },
    });
    return { seen, findings: findings.length };
  }

  it('is asked at every position, and steers the game it walks', async () => {
    const advancing = await walkUnder('first');
    const conceding = await walkUnder('last');

    // Consulted once per position rather than once per run.
    expect(advancing.seen).toBeGreaterThan(1);
    // The toy's last option concedes, so the same table under the other policy
    // is a shorter game. Two different walks is what says the policy is read
    // rather than merely accepted.
    expect(conceding.seen).toBeLessThan(advancing.seen);
    // Both are conformant: steering the walk is not a way to fail the suite.
    expect(advancing.findings).toBe(0);
    expect(conceding.findings).toBe(0);
  });

  it('raises rather than reports when the policy names a move that is not offered', async () => {
    // A finding would blame the backend for the harness's bug, and a silent
    // fallback to `options[0]` would report on a game nobody asked for.
    await expect(checkBackend(scriptBackend(), PRINTED, { pick: () => 'no-such-move' })).rejects.toThrow(
      /the pick policy asked for "no-such-move"/,
    );
  });
});

/**
 * The declaration is checked against the bytes, in both directions and on a
 * backend built to fail.
 *
 * A conformance suite that only ever runs against things that pass is a suite
 * nobody knows the strength of. Each backend below is the stub with one thing
 * wrong, and each names the finding it must produce.
 */
describe('a backend cannot declare per-seat projection without passing it', () => {
  /** The stub, with its sessions rewritten on the way out. */
  function broken(
    declares: boolean,
    rewrite: (session: ObservedSession) => ObservedSession,
    clock = 3,
  ): ObservedBackend {
    const inner = scriptBackend({ clock });
    const wrap = (session: ObservedSession): ObservedSession => ({
      ...rewrite(session),
      submit: async (move) => {
        const result = await session.submit(move);
        return result.ok ? { ok: true, session: wrap(result.session) } : result;
      },
    });
    return {
      ...inner,
      capabilities: { ...inner.capabilities, perSeatProjection: declares },
      open: async (table: SessionSpec) => {
        const opened = await inner.open(table);
        return opened.ok ? { ok: true, session: wrap(opened.session) } : opened;
      },
    };
  }

  const checks = (findings: readonly Finding[]): readonly string[] => findings.map((one) => one.check);

  /**
   * A log with one reveal spliced in at a fixed position and left there, the way
   * a real cumulative log keeps a real reveal: present in every later call once
   * the underlying log reaches `after` entries, at the same point relative to
   * the real events either side of it.
   *
   * `type` is a caller's choice on purpose. The license comes from the `reveals`
   * delta and from nothing else, so a backend that shows a hand under its own
   * word for it gets the same relief our kernel does — which is the thing the
   * duck-typed version could not do and the reason it was deleted.
   *
   * `seats` is a caller's choice for the opposite reason: a reveal that names
   * one seat must license one seat. Our kernel only ever emits reveals to the
   * whole table, so nothing on that side can tell a fold that honors the seat
   * list from one that licenses everybody.
   */
  function withReveal(
    log: readonly EngineEvent[],
    after: number,
    type: string,
    oids: readonly string[],
    seats: readonly SeatId[] = SEAT_IDS,
  ): readonly EngineEvent[] {
    if (log.length < after) return log;
    return [
      ...log.slice(0, after),
      {
        seq: after,
        type,
        text: 'cards were shown',
        detail: null,
        reveals: oids.map((oid) => ({ oid, seats })),
      },
      ...log.slice(after),
    ];
  }

  it('passes the toy, which projects both seats and hides each hand from the other', async () => {
    expect(await checkBackend(scriptBackend(), SEATED)).toEqual([]);
    const opened = await scriptBackend().open(SEATED);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const seats = opened.session.seats;
    expect(seats).not.toBeNull();
    if (seats === null) return;
    expect(seats.view(0).seats[0].hand).not.toBeNull();
    expect(seats.view(0).seats[1].hand).toBeNull();
    expect(seats.view(1).seats[1].hand).not.toBeNull();
  });

  it('carries a reveal delta on every event it emits, to the table and to each seat', async () => {
    // The field is required, so this cannot fail by being forgotten at a
    // construction site — that is a compile error. What it can fail by is a
    // backend building events through a widening cast, which is how an optional
    // field would have failed silently everywhere instead.
    const start = await scriptBackend({ clock: 3 }).open(SEATED);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let played = start.session;
    for (let move = 0; move < 3; move += 1) {
      const next = played.decision?.options[0]?.id;
      if (next === undefined) break;
      const result = await played.submit(next);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      played = result.session;
    }
    const logs: readonly (readonly EngineEvent[])[] = [
      played.events,
      ...SEAT_IDS.map((seat) => played.seats?.events(seat) ?? []),
    ];
    // A positive control: a suite that read no events would satisfy every
    // assertion below on an empty log.
    expect(played.events.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.length).toBe(played.events.length);
      for (const event of log) {
        expect(Array.isArray(event.reveals)).toBe(true);
        for (const reveal of event.reveals) {
          expect(reveal.oid.length).toBeGreaterThan(0);
          expect(reveal.seats.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('passes a backend that declares nothing and hands out nothing', async () => {
    const quiet = scriptBackend({ clock: 6, perSeat: false });
    expect(quiet.capabilities.perSeatProjection).toBe(false);
    expect(await checkBackend(quiet, SEATED)).toEqual([]);
  });

  it('refuses a declaration with no projector behind it', async () => {
    const findings = await checkBackend(
      broken(true, (session) => ({ ...session, seats: null })),
      SEATED,
    );
    expect(checks(findings)).toContain('per-seat-projection');
  });

  it('refuses a projector the backend never declared, since nobody can select it', async () => {
    const findings = await checkBackend(
      broken(false, (session) => session),
      SEATED,
    );
    expect(checks(findings)).toContain('per-seat-projection');
  });

  it('refuses a projector that sends a seat the other seat’s hand', async () => {
    // The whole table, handed to both seats: the shape a surface produces when
    // it conceals at the viewer and somebody puts a socket in front of it.
    const findings = await checkBackend(
      broken(true, (session) => ({
        ...session,
        seats: {
          view: () => session.view,
          events: () => session.events,
          decision: () => session.decision,
        },
      })),
      SEATED,
    );
    expect(checks(findings)).toContain('hidden-information');
    expect(findings.map((one) => one.detail).join('\n')).toContain('hand-1-0');
  });

  it('refuses a projector that conceals everything, including a seat’s own hand', async () => {
    // The other failure a payload search alone would pass: nothing leaks because
    // nothing is there, and neither player can play.
    const findings = await checkBackend(
      broken(true, (session) => {
        const seats = session.seats;
        if (seats === null) return session;
        return {
          ...session,
          seats: {
            ...seats,
            view: (seat) => {
              const view = seats.view(seat);
              return {
                ...view,
                seats: [
                  { ...view.seats[0], hand: null },
                  { ...view.seats[1], hand: null },
                ],
              };
            },
          },
        };
      }),
      SEATED,
    );
    expect(findings.map((one) => one.detail).join('\n')).toContain('its own hand');
  });

  it('draws from a library, so the library check has a subject that is not the kernel', async () => {
    const opened = await scriptBackend({ clock: 3 }).open(SEATED);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = opened.session.view.seats[0];
    const first = opened.session.decision?.options[0];
    expect(first?.id).toBe('advance');
    if (first === undefined) return;
    const next = await opened.session.submit(first.id);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const after = next.session.view.seats[0];
    // One card out of the library and into the hand, which is the whole of what
    // makes a library checkable: the card that arrived was in there a move ago.
    expect(after.librarySize).toBe(before.librarySize - 1);
    expect(after.handSize).toBe(before.handSize + 1);
    expect(after.hand?.map((card) => card.oid)).toContain(`hand-0-${String(before.handSize)}`);
  });

  it('refuses a projector that names a card while it is still in a library', async () => {
    // The bead's failure, built: a backend that projected the position and left
    // the libraries in it, so both seats are sent every card neither may
    // identify. It names only cards not yet drawn, so the hand search above has
    // nothing to say about it and the finding can only have come from the
    // library check. `handSize` is public, and the toy's ids follow from it, so
    // the wrapper can write down the next card without reaching into the toy.
    const findings = await checkBackend(
      broken(true, (session) => {
        const seats = session.seats;
        if (seats === null) return session;
        return {
          ...session,
          seats: {
            ...seats,
            events: (seat) => {
              const log = seats.events(seat);
              const view = seats.view(seat);
              const undrawn = view.seats.map((one) => `hand-${String(one.id)}-${String(one.handSize)}`);
              return [
                ...log,
                {
                  seq: log.length,
                  type: 'libraries',
                  text: 'the libraries',
                  detail: { undrawn },
                  // Declaring nothing, which is the point: a leak that licensed
                  // itself would be a backend granted relief for the bytes it
                  // just leaked, and the check would go quiet on exactly the
                  // failure it exists for.
                  reveals: [],
                },
              ];
            },
          },
        };
      }),
      SEATED,
    );
    expect(checks(findings)).toContain('hidden-information');
    const detail = findings.map((one) => one.detail).join('\n');
    expect(detail).toContain("came out of seat 0's library");
    expect(detail).toContain('one move earlier');
    // Not the hand search wearing a new message: no card the toy leaks here was
    // in anybody's hand at the position it was leaked in.
    expect(detail).not.toContain("is in seat 0's hand");
  });

  it('refuses the same leak written into a public zone instead of into the log', async () => {
    // The same bytes, moved. This one parks each seat's undrawn card in the
    // *other* seat's view of that seat's graveyard, which is a public zone and
    // therefore says nothing to the hand search. It is also the shape that
    // switched the library check off when arrivals were derived from what either
    // seat could identify: the leaked id was in the union, so the card was not an
    // arrival, the count came up short and the position was skipped as
    // ambiguous. Arrivals are scoped to the owner's own view now, so the leak no
    // longer hides behind the guard that was meant to make the check honest.
    const findings = await checkBackend(
      broken(true, (session) => {
        const seats = session.seats;
        if (seats === null) return session;
        return {
          ...session,
          seats: {
            ...seats,
            view: (seat) => {
              const view = seats.view(seat);
              const plant = (one: SeatView): SeatView =>
                one.id === seat
                  ? one
                  : {
                      ...one,
                      graveyard: [
                        ...one.graveyard,
                        {
                          oid: `hand-${String(one.id)}-${String(one.handSize)}`,
                          name: `held-${String(one.id)}-${String(one.handSize)}`,
                          // Lowercase for the reason `stub.ts` names its cards
                          // lowercase: a title-cased word in a public test is a
                          // card name to the census, and this is not a card.
                          typeLine: 'token',
                          power: null,
                          toughness: null,
                          tapped: false,
                          damage: 0,
                          controller: one.id,
                          counters: {},
                        },
                      ],
                    };
              return { ...view, seats: [plant(view.seats[0]), plant(view.seats[1])] };
            },
          },
        };
      }),
      SEATED,
    );
    const detail = findings.map((one) => one.detail).join('\n');
    expect(detail).toContain("came out of seat 0's library");
    expect(detail).toContain('one move earlier');
    // It also disagrees with the table about the public position, which is
    // unavoidable: a leak that hides in a zone list is a leak that changes one.
    // The library finding is the one this test is for, and the assertion above
    // is the one that fails if arrivals go back to being union-scoped.
    expect(checks(findings)).toContain('hidden-information');
  });

  it('does not accuse a backend whose payloads simply never name an undrawn card', async () => {
    // The honest half of the pair above. The two backends differ by one appended
    // event and nothing else, so the toy passing is the evidence that the check
    // ran on it and found nothing, rather than never having run.
    expect(await checkBackend(scriptBackend({ clock: 3 }), SEATED)).toEqual([]);
  });

  it('refuses a projector that writes the seed into a seat’s log', async () => {
    // The leak no card search finds: the seed with the two decklists reproduces
    // every shuffle in the match, and no object in the payload carries it. It
    // rides in a sentence here rather than in a field of its own, which is the
    // shape a friendly log line takes and the reason the seed is searched as a
    // bare substring.
    const findings = await checkBackend(
      broken(true, (session) => {
        const seats = session.seats;
        if (seats === null) return session;
        return {
          ...session,
          seats: {
            ...seats,
            events: (seat) => {
              const log = seats.events(seat);
              return [
                ...log,
                {
                  seq: log.length,
                  type: 'dealt',
                  text: `dealt from ${session.table.seed ?? ''}`,
                  detail: null,
                  reveals: [],
                },
              ];
            },
          },
        };
      }),
      SEATED,
    );
    expect(checks(findings)).toContain('hidden-information');
    expect(findings.map((one) => one.detail).join('\n')).toContain('the seed the match was dealt from');
  });

  it('does not accuse a backend that replays a legitimate hand reveal at every later position', async () => {
    // `mtg-0nu1`, built: `revealHand` is a live effect and the event it emits
    // carries real object ids, let through unredacted on purpose (CR 701.16a).
    // The log is cumulative, so the same reveal sits in every later position's
    // payload, naming cards that are still — correctly — sitting in the hand
    // the rest of the check treats as hidden. `hand-1-0` and `hand-1-1` are
    // seat 1's opening hand; the toy never plays a card out of a hand, so they
    // are still there at the end of a long game and the reveal is the only
    // reason seat 0's payload ever names them.
    const findings = await checkBackend(
      broken(
        true,
        (session) => {
          const seats = session.seats;
          if (seats === null) return session;
          return {
            ...session,
            seats: {
              ...seats,
              events: (seat) => withReveal(seats.events(seat), 1, 'handRevealed', ['hand-1-0', 'hand-1-1']),
            },
          };
        },
        20,
      ),
      SEATED,
    );
    expect(findings).toEqual([]);
  });

  it('licenses the same reveal under a name no engine here has ever used', async () => {
    // The whole gain over the duck-typed version this replaced, made a subject:
    // the delta is identical and only the backend's word for the event differs.
    // The old check matched the literal `handRevealed`, so this backend got no
    // license at all and hit one finding per named card per position for the
    // rest of the game.
    const findings = await checkBackend(
      broken(
        true,
        (session) => {
          const seats = session.seats;
          if (seats === null) return session;
          return {
            ...session,
            seats: {
              ...seats,
              events: (seat) => withReveal(seats.events(seat), 1, 'cards-shown', ['hand-1-0', 'hand-1-1']),
            },
          };
        },
        20,
      ),
      SEATED,
    );
    expect(findings).toEqual([]);
  });

  it('still catches a leak the same backend’s hand reveal did not license', async () => {
    // The adversary the license has to survive: a genuine reveal of one card
    // beside a leak of a different one from the same hand. A wrong fix that
    // mutes the check wherever any reveal exists in the log would miss the
    // second card entirely; a per-object license does not, because `hand-1-1`
    // was never named by the delta at position 1 — only `hand-1-0` was.
    const findings = await checkBackend(
      broken(
        true,
        (session) => {
          const seats = session.seats;
          if (seats === null) return session;
          return {
            ...session,
            seats: {
              ...seats,
              events: (seat) => {
                const revealed = withReveal(seats.events(seat), 1, 'handRevealed', ['hand-1-0']);
                if (seat !== 0) return revealed;
                return [
                  ...revealed,
                  {
                    seq: revealed.length,
                    type: 'leaked',
                    text: 'a stray leak',
                    detail: { held: 'hand-1-1' },
                    reveals: [],
                  },
                ];
              },
            },
          };
        },
        20,
      ),
      SEATED,
    );
    expect(checks(findings)).toContain('hidden-information');
    const detail = findings.map((one) => one.detail).join('\n');
    expect(detail).toContain('hand-1-1');
    expect(detail).not.toContain('object hand-1-0 ');
  });

  it('gives no license to a seat the reveal did not name', async () => {
    // The seat list is load-bearing, and only a backend that reveals to fewer
    // than every seat can show it. This one shows seat 1 its own hand — which
    // it could always see — and delivers the delta to seat 0 as well. The
    // bytes seat 0 receives therefore name two cards it may not identify, and a
    // fold that dropped the seat filter would call that licensed and go quiet.
    const findings = await checkBackend(
      broken(
        true,
        (session) => {
          const seats = session.seats;
          if (seats === null) return session;
          return {
            ...session,
            seats: {
              ...seats,
              events: (seat) =>
                withReveal(seats.events(seat), 1, 'handRevealed', ['hand-1-0', 'hand-1-1'], [1]),
            },
          };
        },
        20,
      ),
      SEATED,
    );
    expect(checks(findings)).toContain('hidden-information');
    const detail = findings.map((one) => one.detail).join('\n');
    expect(detail).toContain('object hand-1-0 is in seat 1');
    expect(detail).toContain("in seat 0's payload");
  });

  it('will not pass a session that may not project where one that does is required', async () => {
    function server(session: ProjectingSession): string {
      return JSON.stringify(session.seats.view(0));
    }
    const opened = await scriptBackend().open(SEATED);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const session: EngineSession = opened.session;
    // @ts-expect-error a session whose `seats` may be null cannot serve a wire,
    // and the narrowing is where a caller has to say what it does instead.
    expect(() => server(session)).toBeTypeOf('function');
    expect(projectsPerSeat(session)).toBe(true);
    if (!projectsPerSeat(session)) return;
    expect(server(session)).toContain('hand-0-0');
  });
});

describe('the determinism split', () => {
  it('narrows a backend to the arm that can reproduce', () => {
    // Widened through a function, because assigning the stub directly narrows it
    // back to the observed arm and there would be nothing left to narrow. This
    // is what a caller holding a backend chosen at run time actually has.
    const chosen = (): GameBackend => scriptBackend();
    const backend = chosen();
    expect(isRecorded(backend)).toBe(false);
    // `reopen` is nameable only inside the narrowing, which is the whole design:
    // a surface cannot reach a reproduction without first asking whether there
    // is one to reach.
    expect(isRecorded(backend) ? typeof backend.reopen : 'absent').toBe('absent');
  });

  it('keeps a session on its own arm through a submit', async () => {
    const opened = await scriptBackend().open(PRINTED);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const session: EngineSession = opened.session;
    expect(isRecordedSession(session)).toBe(false);
    const move = session.decision?.options[0]?.id;
    expect(move).toBeDefined();
    if (move === undefined) return;
    const next = await opened.session.submit(move);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    // Still the observed arm, without a cast, which is the property a surface
    // relies on when it decides once at the top of a match what it can offer.
    expect(next.session.transcript.length).toBeGreaterThan(0);
  });

  /**
   * The check the whole design is for: a caller that requires reproducibility
   * says so in its signature, and an observed backend fails to compile rather
   * than failing at run time in the middle of somebody's game.
   *
   * `@ts-expect-error` is the assertion. If the split ever collapses — replay
   * demoted to an optional method, determinism demoted to a boolean — this line
   * stops erroring and the test fails for having no error to expect.
   */
  it('will not pass an observed backend where a recorded one is required', () => {
    function massSimulation(backend: RecordedBackend): string {
      return backend.id;
    }
    const observed = scriptBackend();
    // @ts-expect-error an observed backend cannot reproduce a game and cannot be
    // a simulation substrate, so it is not assignable here.
    expect(() => massSimulation(observed)).toBeTypeOf('function');
  });
});
