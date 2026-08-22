/**
 * A recorded game with a modal spell (CR 700.2) paused on the stack, written
 * and read back.
 *
 * `mtg-7si0`: `StackEntrySchema` carried no `mode` field, so a modal spell's
 * chosen mode never reached the log at all — the committed fixture
 * (`fixture-games.ts`) plays two bot decks with no modal card in them, so
 * nothing had ever put a chosen mode through this file. `equip.test.ts` is the
 * template: a scripted agent rather than a bot, because the point is a log
 * that certainly contains the thing under test.
 *
 * The spell casts with no target (`{ kind: 'noTarget' }` on both modes), so
 * the scripted agent needs no targeting sub-decisions to steer — it only has
 * to prefer the `mode: 1` cast option over `mode: 0` once both are offered,
 * which is what proves the log records the *chosen* mode rather than always
 * defaulting to the first one enumerated.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Mode } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, AgentView, DeckList, PlayerAgent } from '@mtg/kernel';
import { functionAgent } from '@mtg/kernel';
import { boardFrame } from '../../src/routes/replay/frame';
import { namesFor } from '../../src/routes/replay/narrate';
import { readEventLog } from '../../src/routes/replay/read-log';
import type { ReplayGameLog, ReplayStep } from '../../src/routes/replay/read-log';
import { recordGame, writeEventLog } from '../../tools/record-replay';

const MODES: readonly Mode[] = [
  { effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }] },
  { effects: [{ kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } }] },
];

const FORK: Card = parseCard({
  kind: 'sorcery',
  id: 'xmp-fork-in-the-path',
  name: 'Fork in the Path',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 42 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: [],
  supertypes: [],
  keywords: [],
  abilities: [],
  effects: [],
  modes: MODES,
});

const ISLAND = basicLand('Island', 'XMP', 251);

function repeat(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

const FORK_DECK: DeckList = {
  name: 'Fork Deck',
  cards: [...repeat(ISLAND, 15), ...repeat(FORK, 15)],
};

/**
 * Land first, then the mode-1 cast (gain life) over mode 0 (draw cards) once
 * both are offered, then whatever else is castable, then pass. Deterministic
 * and dull on purpose, the same reason `equip.test.ts`'s `scripted` is: the
 * recorder is seeded, so one order of preferences over the enumerated options
 * is one reproducible game.
 */
function scripted(name: string): PlayerAgent {
  return functionAgent(name, (view: AgentView): Action => {
    const land = view.decision.options.find((option) => option.type === 'playLand');
    if (land !== undefined) return land;
    const modeOne = view.decision.options.find((option) => option.type === 'castSpell' && option.mode === 1);
    if (modeOne !== undefined) return modeOne;
    const anyCast = view.decision.options.find((option) => option.type === 'castSpell');
    if (anyCast !== undefined) return anyCast;
    const first = view.decision.options[0];
    if (first === undefined) throw new Error('a decision with no options');
    return first;
  });
}

function recordedLog(): string {
  const recorded = recordGame({
    index: 0,
    seed: 'replay/modal-spell/1',
    decks: [FORK_DECK, FORK_DECK],
    agents: [scripted('scripted-a'), scripted('scripted-b')],
    startingPlayer: 0,
    maximumTurns: 6,
  });
  return writeEventLog('packages/ui/test/replay/modal-spell-replay.test.ts', [recorded]);
}

/** The first step whose stack carries a chosen mode. */
function firstMode(game: ReplayGameLog): ReplayStep {
  const found = game.steps.find((step) => step.state.stack.some((entry) => entry.mode !== null));
  if (found === undefined) throw new Error('the recorded game never cast a modal spell');
  return found;
}

function gameOf(text: string): ReplayGameLog {
  const [game] = readEventLog(text).games;
  if (game === undefined) throw new Error('the log carries no game');
  return game;
}

describe('a replay log carrying a modal spell on the stack', () => {
  it('records the chosen mode on the stack entry', () => {
    const game = gameOf(recordedLog());
    const step = firstMode(game);
    const entry = step.state.stack.find((candidate) => candidate.mode !== null);
    if (entry === undefined) throw new Error('no modal stack entry recorded');
    // Mode 1, not mode 0: the scripted agent prefers it whenever both are
    // offered, so a log that read back mode 0 would mean the chosen mode was
    // lost on the way in, not merely defaulted.
    expect(entry.mode).toBe(1);
  });

  it("draws the chosen mode's own text on the replay board, not its bare index", () => {
    const game = gameOf(recordedLog());
    const step = firstMode(game);
    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, step.seq));
    const entry = frame.stack.entries.find((candidate) => candidate.card.id === FORK.id);
    if (entry === undefined) throw new Error('the frame drew no modal spell on the stack');
    // The chosen mode is index 1 (gain life), rendered through the same
    // `renderEffectList` a spell's own oracle paragraph is built from.
    expect(entry.targetLabel).toBe('You gain 5 life.');
    expect(entry.targetLabel).not.toMatch(/^mode \d+$/);
  });

  it('is reproducible from the seed alone', () => {
    expect(recordedLog()).toBe(recordedLog());
  });
});
