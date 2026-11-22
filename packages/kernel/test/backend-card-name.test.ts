/** Generic text input and recorded replay through the neutral kernel backend. */
import { describe, expect, it } from 'vitest';
import type { ContentRef, DeckRef, SessionSpec } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import { parseCard, type Card } from '@mtg/dsl';
import type { ContentResolver, GameSession, GameSetup } from '@mtg/kernel';
import { choose, createSession, humanSeat, kernelBackend } from '@mtg/kernel';
import { moveIdOf } from '../src/backend';

const SPHINX: Card = parseCard({
  kind: 'creature',
  id: 'backend-conundrum-sphinx',
  name: 'Conundrum Sphinx',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: {},
  colors: [],
  subtypes: ['Sphinx'],
  keywords: ['flying'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'eachPlayerNamesCardThenRevealsTop' }],
    },
  ],
});

const SETUP: GameSetup = {
  seed: 'backend/card-name',
  decks: [
    { name: 'one', cards: Array.from({ length: 40 }, () => SPHINX) },
    { name: 'two', cards: Array.from({ length: 40 }, () => SPHINX) },
  ],
  maximumTurns: 6,
};

const CONTENT: ContentResolver = {
  resolve: (
    _content: ContentRef,
    _decks: readonly [DeckRef, DeckRef],
    _seed: string,
  ): { readonly ok: true; readonly setup: GameSetup } => ({ ok: true, setup: SETUP }),
};

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'TST' },
  seats: [
    { name: 'One', controller: 'local', deck: { name: 'one', cards: [] } },
    { name: 'Two', controller: 'local', deck: { name: 'two', cards: [] } },
  ],
  seed: SETUP.seed,
  maximumTurns: 6,
};

function pausedDirect(): GameSession {
  let session = createSession(SETUP, [humanSeat('One'), humanSeat('Two')]);
  const hasCreature = (player: 0 | 1): boolean =>
    session.state.battlefield.some((oid) => session.state.objects[oid]?.controller === player);
  for (let guard = 0; guard < 500; guard += 1) {
    const decision = session.pending;
    if (decision?.kind === 'cardName') return session;
    if (decision === null) throw new Error('direct game ended before card naming');
    let index = 0;
    if (decision.kind === 'mulligan') {
      index = decision.options.findIndex((action) => action.type === 'keepHand');
    } else if (decision.kind === 'priority') {
      index = hasCreature(decision.player)
        ? decision.options.findIndex((action) => action.type === 'passPriority')
        : decision.options.findIndex((action) => action.type === 'castSpell');
      if (index < 0) index = decision.options.findIndex((action) => action.type === 'passPriority');
    } else if (decision.kind === 'declareAttackers') {
      index = decision.options.findIndex(
        (action) => action.type === 'declareAttackers' && action.attackers.length > 0,
      );
      if (index < 0) index = 0;
    }
    if (index < 0) throw new Error(`no direct drive option for ${decision.kind}`);
    session = choose(session, index);
  }
  throw new Error('direct game never reached card naming');
}

describe('card naming through the neutral backend', () => {
  it('projects a generic input, records its answer, and reopens byte-identically', async () => {
    const direct = pausedDirect();
    const backend = kernelBackend({ content: CONTENT });
    const opened = await backend.reopen({
      backend: 'kernel',
      table: TABLE,
      seed: SETUP.seed,
      moves: direct.choices.map(moveIdOf),
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const input = opened.session.decision?.input;
    expect(input).toEqual(expect.objectContaining({ kind: 'text', label: 'Card name' }));
    if (input?.kind !== 'text') throw new Error('backend projected no text input');

    const answered = await opened.session.submit(textSubmission(input, 'A Name Outside This Game'));
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.session.record.moves.at(-1)).toBe(textSubmission(input, 'A Name Outside This Game'));

    const replayed = await backend.reopen(answered.session.record);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.session.fingerprint).toBe(answered.session.fingerprint);
  });
});
