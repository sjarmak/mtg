import { describe, expect, it } from 'vitest';
import type { Action, AgentView, DeckList, PlayerAgent } from '@mtg/kernel';
import {
  eventsOfType,
  functionAgent,
  lastDeclarationOption,
  playGame,
  playOut,
  reduceAll,
  scenario,
  serializeEvents,
  simpleAgent,
  validateAction,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { creature, lands, MOUNTAIN } from './cards';
import { oidOf } from './helpers';

/**
 * Plays the next scripted action whenever it is legal, and otherwise makes the
 * quiet default choice. A scripted game therefore only has to name the moves
 * that matter, while every pass, block and cleanup still goes through the real
 * decision machinery.
 */
function scriptedOrIdle(name: string, script: readonly Action[]): PlayerAgent {
  let index = 0;
  return functionAgent(name, (view: AgentView): Action => {
    const next = script[index];
    if (next !== undefined && next.player === view.player && validateAction(view.state, next) === null) {
      index += 1;
      return next;
    }
    switch (view.decision.kind) {
      case 'priority':
        return { type: 'passPriority', player: view.player };
      case 'declareAttackers':
        // Attack with everything. Under the enumeration cap the last option is
        // the whole declaration; past it the kernel asks one creature at a
        // time and this callback is invoked again for each one, so taking the
        // last option every call still converges on "everything attacks"
        // (`mtg-y16d`, `lastDeclarationOption`'s docblock).
        return lastDeclarationOption(view.decision);
      case 'declareBlockers':
        return { type: 'declareBlockers', player: view.player, blocks: [] };
      case 'orderBlockers':
      case 'discard':
      case 'mulligan':
      case 'triggerTargets':
      case 'optionalTrigger':
      case 'may':
      case 'unless':
      case 'legendRule':
      case 'scry':
      case 'searchLibrary':
      case 'graveyardChoice':
      case 'handDiscard':
      case 'permanentSacrifice': {
        // A trigger's targets, a "you may" (from a trigger or a spell), a
        // printed toll, an opening hand, a scry, a library search, a card
        // taken out of a graveyard, the legend rule and CR 701.17a's edict are
        // all answered by taking the kernel's first option,
        // which is the quiet default this driver is for: the first legal target
        // tuple, "yes" to an optional trigger or may, paying a toll (the
        // enumeration lists paying first), a keep of whatever was dealt (the
        // enumeration lists keeps before the mulligan), the first card the
        // search may find (the enumeration lists the finds before the
        // fail-to-find), the first card the graveyard choice may take (same
        // ordering, take-nothing last), the oldest of the same-named legends,
        // and whichever creature the enumeration lists first for the edict.
        // Tests that care script the action.
        const first = view.decision.options[0];
        if (first === undefined) throw new Error(`${name}: no option offered`);
        return first;
      }
    }
  });
}

describe('a scripted attack for exact lethal', () => {
  it('wins the game with a fixed five-action sequence', () => {
    const ogre = creature('Lethal Ogre', 3, 3);
    const start = scenario({
      battlefield: [{ card: ogre, controller: 0 }],
      life: [20, 3],
      step: 'declareAttackers',
    });
    const ogreOid = oidOf(start.state, 'Lethal Ogre');
    const script: Action[] = [
      { type: 'declareAttackers', player: 0, attackers: [{ oid: ogreOid, defender: 1 }] },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ];
    const done = reduceAll(start.state, script);
    expect(done.state.result).toEqual({ winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 2 });
    expect(eventsOfType(done.events, 'damageDealt')).toHaveLength(1);
  });
});

describe('a scripted multi-turn game', () => {
  it('runs to a win through real turns, priority and combat', () => {
    const raider = creature('Script Raider', 2, 1, { keywords: ['haste'], cost: { generic: 1, R: 1 } });
    const start = scenario({
      seed: 'scripted-game',
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [[MOUNTAIN, raider], []],
      libraries: [lands(MOUNTAIN, 20), lands(MOUNTAIN, 20)],
      life: [20, 6],
    });
    const landOid = start.state.players[0].hand[0] ?? '';
    const raiderOid = start.state.players[0].hand[1] ?? '';
    const script: Action[] = [
      { type: 'playLand', player: 0, oid: landOid },
      { type: 'castSpell', player: 0, oid: raiderOid, targets: [] },
    ];

    const run = playOut(start.state, [scriptedOrIdle('scripted', script), scriptedOrIdle('idle', [])]);
    expect(run.result?.winner).toBe(0);
    expect(run.result?.reason).toBe('lifeZero');
    // Two damage a turn from turn 2 onwards: 6 -> 4 -> 2 -> 0.
    expect(run.result?.endedOnTurn).toBe(6);

    const rerun = playOut(start.state, [scriptedOrIdle('scripted', script), scriptedOrIdle('idle', [])]);
    expect(serializeEvents(rerun.events)).toBe(serializeEvents(run.events));
  });
});

function sliceDeck(): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name: 'Slice Red', cards };
}

describe('a full bot game over @mtg/dsl example cards', () => {
  it('finishes with a winner and a coherent log', () => {
    const run = playGame({ seed: 'full-game', decks: [sliceDeck(), sliceDeck()], maximumTurns: 60 }, [
      simpleAgent('red-a'),
      simpleAgent('red-b'),
    ]);
    expect(run.result).not.toBeNull();
    expect(run.result?.reason).toBe('lifeZero');
    const winner = run.result?.winner;
    expect(winner === 0 || winner === 1).toBe(true);
    if (winner !== null && winner !== undefined) {
      expect(run.state.players[winner].life).toBeGreaterThan(0);
    }
    expect(eventsOfType(run.events, 'gameEnded')).toHaveLength(1);
    expect(eventsOfType(run.events, 'turnBegan').length).toBeGreaterThan(3);
    // Every card the log ever drew belongs to somebody's deck.
    for (const event of eventsOfType(run.events, 'cardDrawn')) {
      expect(run.state.objects[event.oid]?.owner).toBe(event.player);
    }
  });

  it('honors the turn limit instead of running forever', () => {
    const wall: Card = creature('Stone Wall', 0, 6);
    const stall: DeckList = {
      name: 'Stall',
      cards: [...lands(MOUNTAIN, 20), ...Array.from({ length: 20 }, () => wall)],
    };
    const run = playGame({ seed: 'stall', decks: [stall, stall], maximumTurns: 8 }, [
      simpleAgent('a'),
      simpleAgent('b'),
    ]);
    expect(run.result?.reason).toBe('turnLimit');
    expect(run.result?.winner).toBeNull();
  });
});
