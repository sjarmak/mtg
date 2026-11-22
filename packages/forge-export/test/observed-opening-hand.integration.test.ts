/** The local seat is asked the opening-hand reveal, and both answers reach Forge. */
import { expect, it, onTestFinished } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeDiagnosticBackend } from '../src/observed/installed';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const DROSS = 'Chancellor of the Dross';
const TANGLE = 'Chancellor of the Tangle';

interface Copies {
  readonly name: string;
  readonly count: number;
}

function table(seed: string, deck: readonly Copies[]): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Human', controller: 'local', deck: { name: 'chancellors', cards: [...deck] } },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 6,
  };
}

function backend(names: readonly string[]): ObservedBackend {
  const found = installedForgeDiagnosticBackend(new Set([...names, 'Mountain']), {
    timeoutMs: 180_000,
  });
  if (found === null) throw new Error('Required installed Forge is absent');
  onTestFinished(async () => found.shutdown?.());
  return found;
}

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

interface FirstTurn {
  /** How many times the opening-hand question was put to the local seat. */
  readonly asked: number;
  /** Option texts of the first ask, without the closing none/done option. */
  readonly offered: readonly string[];
  readonly life: readonly [number, number];
  /** The most green the local seat's pool held at a first-main decision. */
  readonly greenAtFirstMain: number;
}

const isStop = (option: { readonly text: string }): boolean =>
  option.text === 'Choose none' || option.text === 'Done choosing';

/**
 * Plays the local seat's first turn. `reveal` names the options (by substring of
 * their text) to pick, in order; anything it does not name is declined.
 */
async function playFirstTurn(
  seed: string,
  deck: readonly Copies[],
  reveal: readonly string[],
): Promise<FirstTurn> {
  const found = backend(deck.map((copies) => copies.name));
  const opened = await found.open(table(seed, deck));
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let asked = 0;
  let offered: readonly string[] = [];
  let picked = 0;
  let greenAtFirstMain = 0;
  let trace: readonly string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 200; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing Forge decision');
      trace = [...trace.slice(-12), JSON.stringify({ decision, turn: session.view.turn })];
      let move: string | undefined;
      if (decision.kind === 'opening-hand-action') {
        // Choose-many is repeated choose-one, closed by the option that says none or done.
        const stop = decision.options.find(isStop);
        const wanted = reveal[picked];
        const pick =
          wanted === undefined
            ? undefined
            : decision.options.find((option) => !isStop(option) && option.text.includes(wanted));
        if (picked === 0 && asked === 0) {
          asked += 1;
          offered = decision.options.filter((option) => !isStop(option)).map((option) => option.text);
        }
        if (pick !== undefined) picked += 1;
        move = (pick ?? stop)?.id;
      } else if (decision.kind === 'mulligan' || decision.kind === 'starting-player') {
        move = decision.options.find(
          (option) => option.text === 'Keep this hand' || option.text === 'Play first',
        )?.id;
      } else {
        // Whoever goes first is the coin's to say, so stop at the local seat's own first combat:
        // its upkeep and first main phase, where these effects land, are behind it by then.
        const ownTurn = session.view.turn.active === 0;
        if (ownTurn && session.play?.turnStep === 'beginCombat') break;
        if (ownTurn && session.play?.turnStep === 'precombatMain') {
          greenAtFirstMain = Math.max(greenAtFirstMain, session.play.manaPools?.[0]?.G ?? 0);
        }
        move = decision.options.find((option) => option.text === 'Pass priority')?.id;
      }
      if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
      session = await submit(session, move);
    }
    const [local, engine] = session.view.seats;
    return { asked, offered, life: [local.life, engine.life], greenAtFirstMain };
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
  } finally {
    await session.close();
  }
}

forgeIt(
  'asks the local seat which Chancellors to reveal and applies the answer at the first upkeep',
  async () => {
    const deck = [{ name: DROSS, count: 60 }];
    const revealed = await playFirstTurn('opening-hand-reveal-v1', deck, [DROSS]);
    expect(revealed.asked).toBe(1);
    expect(revealed.offered.length).toBeGreaterThan(0);
    expect(revealed.life).toEqual([23, 17]);

    const declined = await playFirstTurn('opening-hand-reveal-v1', deck, []);
    expect(declined.asked).toBe(1);
    expect(declined.life).toEqual([20, 20]);
  },
  420_000,
);

forgeIt(
  'a revealed Chancellor of the Tangle has its mana in the pool on the first main phase',
  async () => {
    const deck = [{ name: TANGLE, count: 60 }];
    const revealed = await playFirstTurn('opening-hand-tangle-v1', deck, [TANGLE]);
    expect(revealed.asked).toBe(1);
    expect(revealed.greenAtFirstMain).toBe(1);

    const declined = await playFirstTurn('opening-hand-tangle-v1', deck, []);
    expect(declined.greenAtFirstMain).toBe(0);
  },
  420_000,
);

function engineTable(seed: string, deck: readonly Copies[]): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Human',
        controller: 'local',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
      { name: 'Forge AI', controller: 'engine', deck: { name: 'chancellors', cards: [...deck] } },
    ],
    seed,
    maximumTurns: 6,
  };
}

forgeIt(
  "lets Forge's own AI answer an engine-seat Chancellor of the Dross without exposing the choice to us (mtg-t5ma0)",
  async () => {
    const found = backend(['Mountain', DROSS]);
    const opened = await found.open(
      engineTable('opening-hand-engine-reveal-v1', [{ name: DROSS, count: 60 }]),
    );
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let sawOpeningHandAction = false;
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        let move: string | undefined;
        if (decision.kind === 'opening-hand-action') {
          sawOpeningHandAction = true;
          move = decision.options.find(isStop)?.id;
        } else if (decision.kind === 'mulligan' || decision.kind === 'starting-player') {
          move = decision.options.find(
            (option) => option.text === 'Keep this hand' || option.text === 'Play first',
          )?.id;
        } else {
          if (session.view.turn.active === 1 && session.play?.turnStep === 'beginCombat') break;
          move = decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        session = await submit(session, move);
      }
      expect(sawOpeningHandAction).toBe(false);
      const [local, engine] = session.view.seats;
      // A 60-of-one deck guarantees all seven opening-hand cards are Chancellor of the Dross;
      // Forge's own AI revealed every one of them (7 x 3 life each way) without asking us.
      expect([local.life, engine.life]).toEqual([-1, 41]);
    } finally {
      await session.close();
    }
  },
  420_000,
);

forgeIt(
  'offers two different Chancellors together; the one revealed applies and the one declined does not',
  async () => {
    const deck = [
      { name: DROSS, count: 30 },
      { name: TANGLE, count: 30 },
    ];
    // A seed whose seven cards hold both is found by trying: the first ask names what was dealt.
    for (const seed of ['opening-hand-pair-a', 'opening-hand-pair-b', 'opening-hand-pair-c']) {
      const probe = await playFirstTurn(seed, deck, []);
      const both =
        probe.offered.some((text) => text.includes(DROSS)) &&
        probe.offered.some((text) => text.includes(TANGLE));
      if (!both) continue;
      const droppedTangle = await playFirstTurn(seed, deck, [DROSS]);
      expect(droppedTangle.life).toEqual([23, 17]);
      expect(droppedTangle.greenAtFirstMain).toBe(0);
      const droppedDross = await playFirstTurn(seed, deck, [TANGLE]);
      expect(droppedDross.life).toEqual([20, 20]);
      expect(droppedDross.greenAtFirstMain).toBe(1);
      return;
    }
    throw new Error('No tried seed dealt both Chancellors in the opening hand');
  },
  900_000,
);
