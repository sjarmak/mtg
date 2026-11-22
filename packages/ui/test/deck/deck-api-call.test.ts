import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NO_SERVER_NOTE, deckApiCall } from '../../src/routes/deck/workbench/client';
import { helperAbsentBody } from '../../src/net/helper-absent';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answering(status: number, body: string, type: string): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
  );
}

const Sets = z.object({ sets: z.array(z.string()) });
const ABSENT = { kind: 'unreachable', message: NO_SERVER_NOTE };

describe('a lab with no deck server behind the page', () => {
  it('reads the page answered in place of the route as no server', async () => {
    answering(200, '<!doctype html><title>frozen ui</title>', 'text/html; charset=utf-8');
    expect(await deckApiCall('/sets', Sets)).toEqual(ABSENT);
  });

  it('reads the absent-helper answer as no server rather than as a refusal', async () => {
    answering(404, JSON.stringify(helperAbsentBody('deck')), 'application/json; charset=utf-8');
    expect(await deckApiCall('/sets', Sets)).toEqual(ABSENT);
  });
});

describe('a deck server that answered', () => {
  it('repeats its own refusal', async () => {
    answering(404, JSON.stringify({ refused: 'no route /deck-api/nowhere' }), 'application/json');
    expect(await deckApiCall('/nowhere', Sets)).toEqual({
      kind: 'refused',
      message: 'no route /deck-api/nowhere',
    });
  });

  it('reads a body of the wrong shape as something it cannot read', async () => {
    answering(200, JSON.stringify({ sets: 'every one' }), 'application/json');
    const answer = await deckApiCall('/sets', Sets);
    expect(answer.kind).toBe('refused');
  });

  it('reads a body of the right shape', async () => {
    answering(200, JSON.stringify({ sets: ['XMP'] }), 'application/json');
    expect(await deckApiCall('/sets', Sets)).toEqual({ kind: 'ok', value: { sets: ['XMP'] } });
  });
});
