/**
 * The narration seam: one renderer, two event streams.
 *
 * `test/replay/narrate.test.ts` already guards the sentences exhaustively, over
 * the committed replay fixture. This file guards the thing that made the
 * renderer shared in the first place (`mtg-bz2` phase 0): that a *live*
 * `GameEvent`, straight off a kernel session, narrates through the same
 * functions the replay route uses, so `mtg-bz2.12`'s game log has nothing to
 * fork and no adapter to keep level.
 *
 * The structural half matters as much as the sentences. The replay route is
 * walled off from the engine by `test/replay/record.test.ts` — a view that
 * cannot reach the engine cannot accidentally re-run it — and moving the
 * renderer under a module that names `@mtg/kernel` would have quietly reopened
 * that door had the import not been type-only. That is asserted here rather than
 * left to inspection, because a runtime import added to this file tomorrow would
 * break a property whose test lives in another directory.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Action, GameEvent, GameSession } from '@mtg/kernel';
import { botSeat, choose, createSession, humanSeat, simpleAgent } from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import {
  describeAction,
  describeDecision,
  describeEvent,
  describeResult,
  optionLabels,
  stepWords,
} from '../../src/log/narrate';
import type { LogNames } from '../../src/log/narrate';

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'log');

const NAMES: LogNames = {
  player: (id) => (id === 0 ? 'You' : 'Bot'),
  card: (oid) => `card ${oid}`,
  // The target slot said as its controller's, which is what a live surface
  // supplies (`routes/play/naming.ts`'s `ownedName`). A book of its own here so
  // a sentence that takes the wrong slot is visible in the expected string.
  target: (oid) => `their card ${oid}`,
};

/** A real game, played to its end, so the events are the reducer's own. */
function playedGame(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  let session = createSession(game.config.setup, [humanSeat('You'), botSeat(simpleAgent('bot'))]);
  for (let step = 0; step < 10_000 && session.pending !== null; step += 1) {
    session = choose(session, 0);
  }
  return session;
}

describe('a live kernel game narrates through the shared renderer', () => {
  const session = playedGame();

  it('reaches a result over a game long enough to be worth reading', () => {
    expect(session.result).not.toBeNull();
    expect(session.events.length).toBeGreaterThan(500);
  });

  it('finishes a sentence for every event the kernel emitted', () => {
    const lines = session.events.map((event: GameEvent) => describeEvent(event, NAMES));
    expect(lines.length).toBe(session.events.length);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line.endsWith('.')).toBe(true);
      // The failure this guards is a template that interpolated a missing
      // member, which reads as a finished sentence with a hole in it.
      expect(line).not.toMatch(/undefined|\[object Object\]/);
    }
  });

  it('covers more than a handful of the event union, so the pass is not trivial', () => {
    const kinds = new Set(session.events.map((event: GameEvent) => event.type));
    expect(kinds.size).toBeGreaterThan(15);
    expect(kinds).toContain('spellCast');
    expect(kinds).toContain('damageDealt');
  });

  it('narrates a live decision, its options and the result', () => {
    const opening = createSession(
      dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' }).config.setup,
      [humanSeat('You'), botSeat(simpleAgent('bot'))],
    );
    const decision = opening.pending;
    if (decision === null) throw new Error('the opening position asks nothing');

    expect(describeDecision(decision, NAMES)).toBe('You decides whether to keep their opening hand.');
    const labels = optionLabels(decision.options, NAMES);
    expect(labels.length).toBe(decision.options.length);
    for (const [index, option] of decision.options.entries()) {
      expect(labels[index]).toContain(describeAction(option, NAMES).slice(0, 4));
    }

    const result = session.result;
    if (result === null) throw new Error('the played game has no result');
    expect(describeResult(result, NAMES)).toMatch(/(wins|Draw) on turn \d+:/);
  });

  it('names every step the kernel can be in', () => {
    expect(stepWords('declareBlockers')).toBe('declare blockers');
    expect(stepWords('cleanup')).toBe('cleanup');
  });

  it('states chosen X in both the action and its cast/copy events', () => {
    const action: Extract<Action, { type: 'castSpell' }> = {
      type: 'castSpell',
      player: 0,
      oid: 'o1',
      targets: [{ kind: 'player', player: 1 }],
      x: 3,
    };
    expect(describeAction(action, NAMES)).toBe('cast card o1 for X=3 targeting Bot');
    expect(
      describeEvent({ type: 'spellCast', player: 0, oid: 'o1', targets: action.targets, chosenX: 3 }, NAMES),
    ).toBe('You cast card o1 for X=3 targeting Bot.');
    expect(
      describeEvent(
        {
          type: 'spellCopied',
          player: 0,
          oid: 'cp1',
          copiedFrom: 'o1',
          targets: action.targets,
          chosenX: 3,
        },
        NAMES,
      ),
    ).toBe('You copy card o1 for X=3 targeting Bot.');
  });
});

describe('the renderer stays a type-only consumer of the kernel', () => {
  /**
   * `test/replay/record.test.ts` asserts that nothing under `src/routes/replay/`
   * imports `@mtg/kernel` or `@mtg/sim`. That route now imports `narrate.ts`, so
   * the wall holds only while that import erases at compile time.
   *
   * Widened from the one file to the whole directory by `mtg-bz2.12`, which added
   * three modules beside it. None of them is on the replay route's import path
   * today, and that is exactly the kind of fact that changes without anybody
   * noticing: the wall was reopened once already by moving a file, and a rule that
   * covers the directory cannot be walked around by adding one to it. Nothing here
   * needs a kernel value — the narration reads state and never advances it — so
   * the rule costs the lane nothing it was going to spend.
   */
  const sources = readdirSync(LOG_DIR).filter((name) => name.endsWith('.ts'));

  it('finds the log modules', () => {
    expect(sources).toContain('narrate.ts');
    expect(sources.length).toBeGreaterThan(1);
  });

  it('imports the kernel as types and never as values, in every one of them', () => {
    const offenders: string[] = [];
    let typeImports = 0;
    for (const name of sources) {
      const source = readFileSync(join(LOG_DIR, name), 'utf8');
      for (const found of source.matchAll(/^import (type )?[^;]*from '@mtg\/kernel';$/gm)) {
        if (found[1] === 'type ') typeImports += 1;
        else offenders.push(`${name}: ${found[0]}`);
      }
      if (/from '@mtg\/sim'/.test(source)) offenders.push(`${name}: imports @mtg/sim`);
    }
    expect(offenders).toEqual([]);
    expect(typeImports).toBeGreaterThan(1);
  });
});
