/**
 * The kernel satisfies `@mtg/engine`'s contract, and playing through it is the
 * same game as playing through the kernel's own API.
 *
 * Two claims, and the second is the load-bearing one. Conformance says the seam
 * is shaped right. Equivalence says the adapter adds nothing: the same table
 * driven through `createSession`/`choose` and through the neutral contract lands
 * on the same `stateFingerprint`, which is the only assertion that can catch an
 * adapter quietly playing a different game.
 */
import { describe, expect, it } from 'vitest';
import type { ContentRef, DeckRef, MoveId, PendingDecision, SessionSpec } from '@mtg/engine';
import { checkBackend } from '@mtg/engine';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { ContentResolver, DeckList, GameSession, GameSetup } from '@mtg/kernel';
import {
  asksInSteps,
  botSeat,
  DEFAULT_ENUMERATION_CAP,
  choose,
  chooseAction,
  createSession,
  humanSeat,
  KERNEL_BACKEND_ID,
  kernelBackend,
  opponentOf,
  pendingDecision,
  scenario,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import { creature, lands, MOUNTAIN } from './cards';
import { moveIdOf } from '../src/backend';

function deck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

/**
 * A resolver that builds one deck for any name it is handed.
 *
 * The point of the seam is that the kernel does not know where a set lives, so
 * a test supplies the knowledge the way a launcher would. It also refuses a
 * named deck, so the `content-unresolved` path is a path and not a comment.
 */
const content: ContentResolver = {
  resolve: (
    ref: ContentRef,
    decks: readonly [DeckRef, DeckRef],
    seed: string,
  ):
    | { readonly ok: true; readonly setup: GameSetup }
    | { readonly ok: false; readonly unresolved: readonly string[] } => {
    if (ref.kind !== 'dsl-set') return { ok: false, unresolved: [ref.format] };
    const missing = decks.filter((entry) => entry.name === 'nothing-here').map((entry) => entry.name);
    if (missing.length > 0) return { ok: false, unresolved: missing };
    return {
      ok: true,
      setup: { seed, decks: [deck(decks[0].name), deck(decks[1].name)], maximumTurns: 40 },
    };
  },
};

function table(seed: string, first: 'local' | 'engine' = 'local'): SessionSpec {
  return {
    content: { kind: 'dsl-set', setCode: 'SLC' },
    seats: [
      { name: 'North', controller: first, deck: { name: 'north', cards: [] } },
      { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
    ],
    seed,
    maximumTurns: 40,
  };
}

describe('the kernel behind the neutral contract', () => {
  it('satisfies the conformance suite', async () => {
    expect(await checkBackend(kernelBackend({ content }), table('backend/conformance'))).toEqual([]);
  });

  it('plays the same game the kernel API plays', async () => {
    const seed = 'backend/equivalence';
    const spec = table(seed);

    const opened = await kernelBackend({ content }).open(spec);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let neutral = opened.session;
    const taken: number[] = [];
    for (let step = 0; step < 400 && neutral.status === 'awaiting'; step += 1) {
      const move = neutral.decision?.options[0];
      if (move === undefined) break;
      taken.push(Number.parseInt(move.id, 10));
      const next = await neutral.submit(move.id);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      neutral = next.session;
    }

    const resolved = content.resolve(spec.content, [spec.seats[0].deck, spec.seats[1].deck], seed);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    let direct = createSession(resolved.setup, [humanSeat('North'), botSeat(simpleAgent('South'))]);
    for (const index of taken) direct = choose(direct, index);

    expect(neutral.fingerprint).toBe(stateFingerprint(direct.state));
    expect(neutral.submitted).toBe(direct.choices.length);
    expect(neutral.events).toHaveLength(direct.events.length);
  });

  it('reopens a record and lands where the game stood', async () => {
    const backend = kernelBackend({ content });
    const opened = await backend.open(table('backend/reopen'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let session = opened.session;
    const marks: string[] = [];
    for (let step = 0; step < 12 && session.status === 'awaiting'; step += 1) {
      const move = session.decision?.options[0];
      if (move === undefined) break;
      const next = await session.submit(move.id);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      session = next.session;
      marks.push(session.fingerprint);
    }
    expect(marks.length).toBeGreaterThan(3);

    const whole = await backend.reopen(session.record);
    expect(whole.ok).toBe(true);
    if (!whole.ok) return;
    expect(whole.session.fingerprint).toBe(session.fingerprint);

    const half = 3;
    const prefix = await backend.reopen({
      ...session.record,
      moves: session.record.moves.slice(0, half),
    });
    expect(prefix.ok).toBe(true);
    if (!prefix.ok) return;
    expect(prefix.session.fingerprint).toBe(marks[half - 1]);
  });

  it('refuses a record another backend wrote', async () => {
    const backend = kernelBackend({ content });
    const opened = await backend.open(table('backend/foreign'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const reopened = await backend.reopen({ ...opened.session.record, backend: 'forge' });
    expect(reopened.ok).toBe(false);
    if (reopened.ok) return;
    expect(reopened.error.kind).toBe('backend-failure');
    expect(reopened.error.message).toContain('forge');
  });

  it('refuses printed content by name rather than by boolean', async () => {
    const refusals = await kernelBackend({ content }).supports({
      ...table('backend/printed'),
      content: { kind: 'printed', format: 'legacy' },
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('DSL cards');
  });

  it('names what it could not resolve', async () => {
    const spec = table('backend/unresolved');
    const opened = await kernelBackend({ content }).open({
      ...spec,
      seats: [{ ...spec.seats[0], deck: { name: 'nothing-here', cards: [] } }, spec.seats[1]],
    });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.kind).toBe('content-unresolved');
    if (opened.error.kind !== 'content-unresolved') return;
    expect(opened.error.unresolved).toEqual(['nothing-here']);
  });

  it('declares the capabilities it actually has', () => {
    const backend = kernelBackend({ content });
    expect(backend.id).toBe(KERNEL_BACKEND_ID);
    expect(backend.determinism).toBe('recorded');
    expect(backend.capabilities.fork).toBe(true);
    expect(backend.capabilities.undo).toBe(true);
    // Declared true because `backend-projection.ts` runs the position through
    // `seatState` before projecting it. The declaration is not what makes it
    // true: `checkBackend` above searches both seats' payloads at every position
    // of a whole game and refuses a backend that declares this without doing it.
    expect(backend.capabilities.perSeatProjection).toBe(true);
  });

  it('projects a board a surface can draw without knowing the engine', async () => {
    const opened = await kernelBackend({ content }).open(table('backend/projection'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const view = opened.session.view;
    expect(view.seats[0].life).toBe(20);
    expect(view.seats[0].handSize).toBeGreaterThan(0);
    // The local seat sees its own hand; the engine seat's is removed rather
    // than merely omitted, which is the difference a null carries.
    expect(view.seats[0].hand).not.toBeNull();
    expect(view.seats[1].hand).toBeNull();
    expect(view.seats[1].handSize).toBeGreaterThan(0);
  });

  /**
   * The per-seat projection, checked where the table view cannot be.
   *
   * Both seats are people here, which is the case the table view is honest
   * about and a wire is not: `view` names both hands because one screen is
   * holding both, and `seats.view(0)` is what may be sent to one of them.
   * `checkBackend` already searches these payloads over a whole game; this is
   * the shape of one of them, and the assertion that the two are different
   * values at all.
   */
  it('removes a seat’s hidden information from what the other seat is sent', async () => {
    const spec: SessionSpec = {
      ...table('backend/per-seat'),
      seats: [
        { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
        { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
      ],
    };
    const opened = await kernelBackend({ content }).open(spec);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const session = opened.session;
    const seats = session.seats;
    expect(seats, 'the kernel declares per-seat projection, so every session carries one').not.toBeNull();
    if (seats === null) return;

    // The table's own view holds both hands, because a hot-seat surface is
    // entitled to them and hides them at the viewer.
    expect(session.view.seats[0].hand).not.toBeNull();
    expect(session.view.seats[1].hand).not.toBeNull();

    const mine = seats.view(0);
    expect(mine.seats[0].hand).not.toBeNull();
    expect(mine.seats[1].hand).toBeNull();
    expect(mine.seats[1].handSize).toBe(session.view.seats[1].handSize);

    // Not one id of the other hand survives anywhere in the payload, which is
    // the check `@mtg/netplay` wrote against its own wire.
    const held = session.view.seats[1].hand ?? [];
    expect(held.length).toBeGreaterThan(0);
    const wire = JSON.stringify({ view: mine, events: seats.events(0), decision: seats.decision(0) });
    for (const card of held) expect(wire.includes(JSON.stringify(card.oid))).toBe(false);
    // The seed reproduces every shuffle in the game, so the log carries it to
    // nobody. `seatEvents` is where that is closed.
    expect(wire.includes(JSON.stringify(spec.seed))).toBe(false);

    // The question goes to the seat that owes it and to no other seat.
    const owed = session.decision?.seat;
    expect(owed).toBeDefined();
    if (owed === undefined) return;
    expect(seats.decision(owed)).not.toBeNull();
    expect(seats.decision(owed === 0 ? 1 : 0)).toBeNull();
  });
});

/**
 * `moveIdOf` is the write side of a recorded move (`indexOf` is the read
 * side), and it is not reachable from `kernelBackend`'s own contract today:
 * `submit` only ever resolves a `MoveId` to an index and hands that index to
 * `choose` (never `chooseAction`), so nothing in this file can drive a
 * `RecordedSession` into recording a constructed action. What is checked here
 * is the function `wrap` calls, fed a choice built the way `chooseAction`
 * itself builds one when the enumeration truncates — the same technique
 * `attack-enumeration.test.ts` uses to force that — so the case this guards
 * against is real kernel output, not a hand-rolled stand-in for it (mtg-2guj).
 */
describe('moveIdOf, the write side of a recorded move', () => {
  it('renders an index as its digit string', () => {
    expect(moveIdOf(0)).toBe('0');
    expect(moveIdOf(41)).toBe('41');
  });

  /**
   * `declareAttackers` is asked one creature at a time past nine eligible
   * attackers (`attack-enumeration.test.ts` measures where), so a dozen forces
   * `chooseAction`'s fallback to fire: a whole declaration is a legal answer to
   * a stepwise question and no option names it.
   */
  function attackingState(count: number) {
    const creatures: readonly Card[] = Array.from({ length: count }, (_, index) =>
      creature(`Hillside Bruiser ${String(index)}`, 3, 3),
    );
    return scenario({
      seed: 'kernel/backend-move-id',
      battlefield: creatures.map((card) => ({ card, controller: 0 as const })),
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
  }

  it('refuses to render a choice no option names, because the neutral contract has no move id for it', () => {
    const state = attackingState(12);
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'declareAttackers') {
      throw new Error('the board is not asking for attackers');
    }
    expect(asksInSteps(decision)).toBe(true);

    // Half the board, taken from both ends, so the declaration is the answer to
    // twelve questions at once rather than the answer to the one being asked.
    const chosen = decision.eligible.filter((_, index) => index % 2 === 0);
    const wanted = {
      type: 'declareAttackers' as const,
      player: decision.player,
      attackers: chosen.map((oid) => ({ oid, defender: opponentOf(decision.player) })),
    };

    const session: GameSession = {
      seats: [humanSeat('you'), humanSeat('them')],
      state,
      events: [],
      result: null,
      pending: decision,
      choices: [],
      decisions: 0,
      beat: null,
      committed: null,
    };
    const applied = chooseAction(session, wanted);
    const recorded = applied.choices[0];
    if (recorded === undefined) throw new Error('chooseAction recorded nothing');
    expect(typeof recorded).not.toBe('number');

    expect(() => moveIdOf(recorded)).toThrow(
      /this session cannot be recorded: a "declareAttackers" declaration the option list does not name has no index/,
    );
  });
});

/**
 * The half of `mtg-cs8t`'s acceptance criterion the default conformance run
 * cannot reach.
 *
 * `checkEnumeration` is the contract's judgment on a truncated decision, and the
 * kernel passes it — but the suite above proves nothing about that, because
 * `checkBackend`'s default policy takes `options[0]` and `options[0]` at a
 * priority decision is "Pass". A seat that always passes never plays a land,
 * never casts a creature and therefore never has anything to block with.
 * Measured on this checkout: forty seeds of the table above reach `priority`,
 * `mulligan` and `discard`, and reach `declareBlockers` exactly zero times. The
 * enumeration check was green because nothing ever asked it a question.
 *
 * So this drives the same backend with a policy that prefers a move with
 * substance, over a deck built to crowd a board — 24 Mountains and 36 bears, on
 * both sides. That reaches real combat, and it reaches the sequenced path: on
 * `backend/wide-combat` turn 8 the defender is asked about blocks twice, which
 * only happens when the whole product did not fit under the cap (`legal.ts`
 * lists it whole when it fits and asks one creature at a time when it does not).
 *
 * Two assertions, and the second is what keeps the first from going quietly
 * vacuous the way the default run did. No findings at all, and a positive
 * control that a combat really was asked as a sequence.
 */
describe('the kernel behind the contract, on a board wide enough to truncate', () => {
  const BEAR = creature('Grizzled Skirmisher', 2, 2);

  function wideDeck(name: string): DeckList {
    return { name, cards: [...lands(MOUNTAIN, 24), ...lands(BEAR, 36)] };
  }

  const wideContent: ContentResolver = {
    resolve: (ref: ContentRef, decks: readonly [DeckRef, DeckRef], seed: string) => {
      if (ref.kind !== 'dsl-set') return { ok: false, unresolved: [ref.format] };
      return {
        ok: true,
        setup: {
          seed,
          decks: [wideDeck(decks[0].name), wideDeck(decks[1].name)],
          maximumTurns: 40,
        },
      };
    },
  };

  function wideTable(seed: string): SessionSpec {
    return {
      content: { kind: 'dsl-set', setCode: 'SLC' },
      seats: [
        { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
        { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
      ],
      seed,
      maximumTurns: 40,
    };
  }

  /**
   * Anything but passing, and the first such move.
   *
   * Pure in the decision it is handed, which is what `ConformanceOptions.pick`
   * requires: the same position always yields the same move, so the walk
   * `checkReproduction` replays is the walk that was played.
   */
  function eager(decision: PendingDecision): MoveId {
    const active = decision.options.find((option) => option.text !== 'Pass');
    const move = active ?? decision.options[0];
    if (move === undefined) throw new Error('the decision offered nothing to take');
    return move.id;
  }

  const SEED = 'backend/wide-combat';

  it('reports no enumeration finding on a combat it had to ask as a sequence', async () => {
    const findings = await checkBackend(kernelBackend({ content: wideContent }), wideTable(SEED), {
      pick: eager,
    });
    expect(findings).toEqual([]);
  });

  it('really did reach a combat the whole product would not have listed', async () => {
    const opened = await kernelBackend({ content: wideContent }).open(wideTable(SEED));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let session = opened.session;
    // Blocker questions per combat, keyed by the turn they were asked on. One
    // combat phase per turn, so a second question on the same turn is the
    // declaration being asked one creature at a time.
    const asked = new Map<string, number>();
    let widest = 0;
    let incomplete = 0;
    for (let step = 0; step < 4_000 && session.status === 'awaiting'; step += 1) {
      const decision = session.decision;
      if (decision === null) break;
      if (!decision.complete) incomplete += 1;
      if (decision.kind === 'declareBlockers') {
        const turn = session.view.turn;
        const key = `${String(turn.number)}/${String(turn.active)}`;
        asked.set(key, (asked.get(key) ?? 0) + 1);
        widest = Math.max(widest, decision.options.length);
      }
      const next = await session.submit(eager(decision));
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      session = next.session;
    }

    expect(session.status).toBe('finished');
    // The claim the bead filed, on a game played through the neutral contract.
    expect(incomplete).toBe(0);
    // Combat happened at all, which is the thing the default policy never got to.
    expect(asked.size).toBeGreaterThan(0);
    // And at least one of those combats did not fit, so the sequenced path is
    // what this game exercised rather than the whole-product path alone.
    expect(Math.max(...asked.values())).toBeGreaterThan(1);
    // Every list the defender was actually shown stays small, which is the other
    // half of not truncating.
    //
    // The literal stays a literal (`mtg-4nkq`), and it is one of the two numbers
    // in these suites that should. Writing `DEFAULT_ENUMERATION_CAP` here reads
    // like the sharper claim and is a false one: the cap bounds the *product*
    // enumerations, and the sequenced fallback this game exercises is linear in
    // the board rather than exponential, so it is under no obligation to fit.
    // Measured by lowering the cap to 4 on this checkout, the widest list this
    // seeded game shows is 7 — complete, untruncated, and three times the cap.
    // What 512 asserts is a bound on the lists this table produces at the
    // shipped configuration, which is a fact about the board and the fallback.
    expect(widest).toBeLessThanOrEqual(512);
  });
});

/**
 * The other half of `mtg-ylcf`: a trigger aimed at a board too wide to list.
 *
 * The combat suite above proves the sequenced shape for a blocker declaration.
 * A trigger's targets truncate for a different reason and had a different fix, so
 * they need their own subject. Measured on this checkout before the fix, cap 512:
 * a two-slot `selfEnters` trigger over a battlefield of 23 creatures is 529
 * aimings, of which 512 were listed and 17 had no id — legal ways to aim a
 * printed trigger that no surface could submit.
 *
 * The table is 24 Mountains and 36 heralds on both sides. Every herald that
 * resolves asks its controller where to point two slots, and the product is the
 * square of the creature count, so the question outgrows the cap by the time a
 * board holds two dozen creatures. That is not a contrived board for a set that
 * prints seventy-nine token-making effects.
 *
 * The herald is a 0/4 rather than a bear, and the reason is the eager policy: it
 * attacks with whatever it is offered, so a board of 2/2s trades itself down
 * every turn and never reaches two dozen. Nothing dies in a fight between 0/4s,
 * so the board grows for the whole game and the trigger's product grows with it.
 * Two effects, because `@mtg/dsl` caps a triggered ability at two — the product
 * is a square and nothing wider is expressible, which is why this needs a wide
 * board rather than a wide ability.
 *
 * Same two assertions as the combat suite, for the same reason: no findings, and
 * a positive control that a trigger really was asked as a sequence rather than
 * listed whole.
 *
 * The budget is its own, because a board that never trades is a long game: sixty
 * turns of a growing board is about eight seconds of conformance walk on this
 * machine, and the suite's default five is a fact about a short game rather than
 * about this one.
 */
describe(
  'the kernel behind the contract, aiming a trigger at a board too wide to list',
  { timeout: 60_000 },
  () => {
    const HERALD = creature('Twinned Herald', 0, 4, {
      cost: { generic: 1 },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            { kind: 'pumpUntilEndOfTurn', target: { kind: 'targetCreature' }, power: 1, toughness: 1 },
            { kind: 'dealDamage', target: { kind: 'targetCreature' }, amount: 1 },
          ],
        },
      ],
    });

    function heraldDeck(name: string): DeckList {
      return { name, cards: [...lands(MOUNTAIN, 24), ...lands(HERALD, 36)] };
    }

    const heraldContent: ContentResolver = {
      resolve: (ref: ContentRef, decks: readonly [DeckRef, DeckRef], seed: string) => {
        if (ref.kind !== 'dsl-set') return { ok: false, unresolved: [ref.format] };
        return {
          ok: true,
          setup: {
            seed,
            decks: [heraldDeck(decks[0].name), heraldDeck(decks[1].name)],
            maximumTurns: 60,
          },
        };
      },
    };

    function heraldTable(seed: string): SessionSpec {
      return {
        content: { kind: 'dsl-set', setCode: 'SLC' },
        seats: [
          { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
          { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
        ],
        seed,
        maximumTurns: 60,
      };
    }

    /** `eager` again, and pure for the same reason `ConformanceOptions.pick` is. */
    function eager(decision: PendingDecision): MoveId {
      const active = decision.options.find((option) => option.text !== 'Pass');
      const move = active ?? decision.options[0];
      if (move === undefined) throw new Error('the decision offered nothing to take');
      return move.id;
    }

    const SEED = 'backend/wide-trigger';

    it('reports no enumeration finding on a trigger it had to ask as a sequence', async () => {
      const findings = await checkBackend(kernelBackend({ content: heraldContent }), heraldTable(SEED), {
        pick: eager,
      });
      expect(findings).toEqual([]);
    });

    it('really did aim a trigger the whole product would not have listed', async () => {
      const opened = await kernelBackend({ content: heraldContent }).open(heraldTable(SEED));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      let session = opened.session;
      // The whole product a question *would* have listed, measured off the
      // projection rather than assumed: both slots aim at any creature, so it is
      // the square of the creature count at the moment the trigger is aimed.
      // `PendingDecision` carries no object id, so counting repeats per trigger the
      // way the combat suite counts blocker questions is not available here; the
      // product is the better control anyway, because it says the whole list did
      // not fit rather than that something was asked twice.
      let asked = 0;
      let widestProduct = 0;
      let widest = 0;
      let incomplete = 0;
      for (let step = 0; step < 8_000 && session.status === 'awaiting'; step += 1) {
        const decision = session.decision;
        if (decision === null) break;
        if (!decision.complete) incomplete += 1;
        if (decision.kind === 'triggerTargets') {
          const creatures = session.view.seats.reduce(
            (total, seat) => total + seat.battlefield.filter((object) => object.power !== null).length,
            0,
          );
          asked += 1;
          widestProduct = Math.max(widestProduct, creatures * creatures);
          widest = Math.max(widest, decision.options.length);
        }
        const next = await session.submit(eager(decision));
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        session = next.session;
      }

      expect(session.status).toBe('finished');
      // The claim the bead filed, on a game played through the neutral contract.
      expect(incomplete).toBe(0);
      // Triggers were aimed at all, which is what makes the first assertion mean
      // something.
      expect(asked).toBeGreaterThan(0);
      // And at least one aiming genuinely did not fit, so the sequenced path is
      // what this game exercised rather than the whole-product path alone. The
      // cap is named rather than written out, and here the consequence is the
      // sharp one: against a literal 512, raising the cap past this table's 529
      // aimings would leave the assertion passing while the sequenced path it
      // describes had stopped being taken.
      expect(widestProduct).toBeGreaterThan(DEFAULT_ENUMERATION_CAP);
      // Every list a controller was actually shown stays small, which is the
      // other half of not truncating. The second of the two literals that stay
      // literal, for the reason spelled out on the combat suite above: the
      // sequenced aiming is linear in the board, so it does not answer to the
      // cap. At cap 4 the widest list here measures 35.
      expect(widest).toBeLessThanOrEqual(512);
    });
  },
);
