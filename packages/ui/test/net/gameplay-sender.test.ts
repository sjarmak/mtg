/**
 * The browser half of `/api/games`: what the page sends, and what it makes of
 * every answer. `../../src/net/gameplay.ts` never throws, so each refusal is
 * pinned as the sentence a surface would show.
 */
import { describe, expect, it, vi } from 'vitest';
import { botSeat, humanSeat } from '@mtg/kernel';
import type { GameResult } from '@mtg/kernel';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import type { FinishedKernelGame } from '../../src/net/gameplay';
import { httpGameplaySender, wireOf } from '../../src/net/gameplay';
import { CLIENT_PROTOCOL } from '../../src/net/snapshot';

const RESULT: GameResult = { winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 7 };

const GAME: FinishedKernelGame = {
  config: {
    setup: {
      seed: 'ui/gameplay/sender',
      decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
      maximumTurns: 20,
      startingPlayer: 1,
    },
    seats: [humanSeat('kernel-name'), botSeat(greedyBot('agent-name'))],
    viewer: 0,
    names: ['You', 'Bot'],
  },
  choices: [0, 2, 0],
  result: RESULT,
  format: 'sealed',
};

type Fetch = typeof globalThis.fetch;

interface Seen {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

/** A fetch that answers each call from a list and remembers what it was asked. */
function answering(answers: readonly { readonly status: number; readonly body?: unknown }[]): {
  readonly fetch: Fetch;
  readonly seen: Seen[];
} {
  const seen: Seen[] = [];
  const queue = [...answers];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    seen.push({ url: String(input), method: init?.method, body });
    const next = queue.shift();
    if (next === undefined) throw new Error('no answer left');
    return Promise.resolve(
      new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status }),
    );
  });
  return { fetch: fetch as unknown as Fetch, seen };
}

describe('the wire form of a finished game', () => {
  it('carries the seed, the decks by card id, the seats by kind and shown name, the choices and the result', () => {
    const wire = wireOf(GAME);
    expect(wire).toEqual({
      protocol: CLIENT_PROTOCOL,
      format: 'sealed',
      setup: { seed: 'ui/gameplay/sender', maximumTurns: 20, startingPlayer: 1 },
      decks: [
        { name: 'RW Aggro', cardIds: FIXTURE_DECK_RW.cards.map((card) => card.id) },
        { name: 'UB Control', cardIds: FIXTURE_DECK_UB.cards.map((card) => card.id) },
      ],
      seats: [
        { kind: 'human', name: 'You' },
        { kind: 'bot', name: 'Bot' },
      ],
      choices: [0, 2, 0],
      result: RESULT,
    });
    expect(JSON.stringify(wire)).not.toContain('"cards"');
  });
});

describe('the http sender', () => {
  it('mints a token and then finishes under it, reading the id back', async () => {
    const lab = answering([
      { status: 201, body: { protocol: CLIENT_PROTOCOL, token: 'tok-1' } },
      { status: 201, body: { protocol: CLIENT_PROTOCOL, id: 'game-1' } },
    ]);
    const sender = httpGameplaySender('/api', lab.fetch);
    const opened = await sender.open();
    expect(opened).toEqual({ ok: true, token: 'tok-1' });
    if (!opened.ok) return;
    expect(await sender.finish(opened.token, GAME)).toEqual({ status: 'recorded', id: 'game-1' });
    expect(lab.seen.map((call) => [call.method, call.url])).toEqual([
      ['POST', '/api/games'],
      ['PUT', '/api/games/tok-1'],
    ]);
    expect(lab.seen[1]?.body).toEqual(JSON.parse(JSON.stringify(wireOf(GAME))));
  });

  it('says when the lab records nothing, and repeats the refusal the lab wrote', async () => {
    const lab = answering([
      { status: 404, body: { refused: 'this server records nothing' } },
      {
        status: 429,
        body: {
          refused: 'budget-spent',
          message: 'this lab has recorded 64 games; restart it to record more',
        },
      },
      { status: 500 },
    ]);
    const sender = httpGameplaySender('/api', lab.fetch);
    expect(await sender.open()).toEqual({ ok: false, reason: 'this lab is not recording games' });
    expect(await sender.open()).toEqual({
      ok: false,
      reason: 'this lab has recorded 64 games; restart it to record more',
    });
    expect(await sender.open()).toEqual({ ok: false, reason: 'the lab answered 500' });
  });

  it('refuses a token it cannot read and a protocol it does not speak', async () => {
    const lab = answering([
      { status: 201, body: { protocol: CLIENT_PROTOCOL } },
      { status: 201, body: { protocol: CLIENT_PROTOCOL + 1, token: 'tok' } },
    ]);
    const sender = httpGameplaySender('/api', lab.fetch);
    expect(await sender.open()).toEqual({ ok: false, reason: 'the lab answered without a token' });
    expect(await sender.open()).toEqual({
      ok: false,
      reason: 'the lab speaks a protocol this page does not',
    });
  });

  it('carries a finish refusal by its message, and refuses a 2xx that names no id', async () => {
    const lab = answering([
      {
        status: 422,
        body: {
          refused: 'not-reproduced',
          message: 'the claimed result is not what the seed and the choices produce',
        },
      },
      { status: 201, body: { protocol: CLIENT_PROTOCOL } },
    ]);
    const sender = httpGameplaySender('/api', lab.fetch);
    expect(await sender.finish('tok', GAME)).toEqual({
      status: 'refused',
      reason: 'the claimed result is not what the seed and the choices produce',
    });
    expect(await sender.finish('tok', GAME)).toEqual({
      status: 'refused',
      reason: 'the lab recorded the game and named no id',
    });
  });

  it('never throws when there is no lab to reach, and names the launcher that provides one', async () => {
    const down: Fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const sender = httpGameplaySender('/api', down);
    const opened = await sender.open();
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toContain('Failed to fetch');
    expect(opened.reason).toContain('npm run play');
    expect(await sender.finish('tok', GAME)).toMatchObject({ status: 'refused' });
  });
});
