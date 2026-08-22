/** Post-hoc scry replay: omniscient action identities and count-based narration. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { BASIC_LANDS, parseCard } from '@mtg/dsl';
import type { AgentView, DeckList, PlayerAgent } from '@mtg/kernel';
import { functionAgent } from '@mtg/kernel';
import { describeAction, namesFor } from '../../src/routes/replay/narrate';
import { EVENT_LOG_SCHEMA_VERSION } from '../../src/routes/replay/log-schema';
import { readEventLog } from '../../src/routes/replay/read-log';
import { recordGame, writeEventLog } from '../../tools/record-replay';

function basicIsland(): Card {
  const found = BASIC_LANDS.find((card) => card.name === 'Island');
  if (found === undefined) throw new Error('the DSL ships no Island');
  return found;
}

const ISLAND = basicIsland();

const PREORDAIN = parseCard({
  kind: 'sorcery',
  id: 'replay-preordain',
  name: 'Preordain',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { U: 1 },
  colors: ['U'],
  effects: [
    { kind: 'scry', count: 2 },
    { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
  ],
});

function deck(name: string): DeckList {
  return {
    name,
    cards: [...Array.from({ length: 20 }, () => PREORDAIN), ...Array.from({ length: 20 }, () => ISLAND)],
  };
}

function optionFor(view: AgentView) {
  const decision = view.decision;
  if (decision.kind === 'mulligan') {
    return decision.options.find((action) => action.type === 'keepHand');
  }
  if (decision.kind === 'scry') {
    return decision.options.find(
      (action) => action.type === 'scry' && action.top.length === 1 && action.bottom.length === 1,
    );
  }
  if (decision.kind === 'priority') {
    const land = decision.options.find((action) => action.type === 'playLand');
    if (land !== undefined) return land;
    const spell = decision.options.find(
      (action) => action.type === 'castSpell' && view.state.objects[action.oid]?.card.name === 'Preordain',
    );
    if (spell !== undefined) return spell;
  }
  return decision.options.find((action) =>
    action.type === 'declareAttackers'
      ? action.attackers.length === 0
      : action.type === 'declareBlockers'
        ? action.blocks.length === 0
        : true,
  );
}

function agent(name: string): PlayerAgent {
  return functionAgent(name, (view) => {
    const option = optionFor(view);
    if (option === undefined) throw new Error(`${name}: no option for ${view.decision.kind}`);
    return option;
  });
}

describe('scry in a post-hoc replay', () => {
  it('records raw chosen OIDs, reads them back unchanged, and narrates the ordered partition by counts', () => {
    const recorded = recordGame({
      index: 0,
      seed: 'replay/scry/v0',
      decks: [deck('Blue one'), deck('Blue two')],
      agents: [agent('one'), agent('two')],
      startingPlayer: 0,
      maximumTurns: 4,
    });
    const writtenStep = recorded.steps.find((step) => step.action?.type === 'scry');
    if (writtenStep?.action?.type !== 'scry') throw new Error('the recorded game never scried');
    expect(writtenStep.action.top).toHaveLength(1);
    expect(writtenStep.action.bottom).toHaveLength(1);
    for (const oid of [...writtenStep.action.top, ...writtenStep.action.bottom]) {
      expect(recorded.game.objects[oid]).toBeDefined();
    }

    const written = writeEventLog('scry replay test', [recorded]);
    expect(JSON.parse(written.split('\n')[0] ?? '{}')).toMatchObject({
      record: 'header',
      schema: EVENT_LOG_SCHEMA_VERSION,
    });
    expect(EVENT_LOG_SCHEMA_VERSION).toBe('mtg-ui/event-log/8');
    const read = readEventLog(written);
    const game = read.games[0];
    if (game === undefined) throw new Error('the replay reader returned no game');
    const readStep = game.steps.find((step) => step.action?.type === 'scry');
    if (readStep?.action?.type !== 'scry') throw new Error('the replay reader lost the scry action');

    expect(readStep.action.top).toEqual(writtenStep.action.top);
    expect(readStep.action.bottom).toEqual(writtenStep.action.bottom);
    expect(describeAction(readStep.action, namesFor(game, readStep.seq))).toBe(
      'keep 1 on top and put 1 on the bottom',
    );
    expect(readStep.events.find((event) => event.type === 'cardsScried')).toEqual({
      type: 'cardsScried',
      player: readStep.action.player,
      count: 2,
      bottom: 1,
    });
  });
});
