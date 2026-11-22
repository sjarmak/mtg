import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_DESIGN_SERVER,
  fetchVocabulary,
  planDraft,
  runDraft,
  validateDraft,
} from '../../src/routes/design/client';
import { helperAbsentBody } from '../../src/net/helper-absent';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answering(status: number, body: string, type: string): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
  );
}

function answeringJson(status: number, body: unknown): void {
  answering(status, JSON.stringify(body), 'application/json; charset=utf-8');
}

const PAGE = '<!doctype html><title>frozen ui</title>';
const ABSENT = { kind: 'unreachable', reason: NO_DESIGN_SERVER };

describe('a lab with no design server behind the page', () => {
  it('reads the page answered in place of every route as one state', async () => {
    answering(200, PAGE, 'text/html; charset=utf-8');
    expect(await fetchVocabulary()).toEqual(ABSENT);
    expect(await validateDraft({})).toEqual(ABSENT);
    expect(await planDraft({})).toEqual(ABSENT);
    expect(await runDraft({})).toEqual(ABSENT);
  });

  it('reads the absent-helper answer the same way, on the run route too', async () => {
    answeringJson(404, helperAbsentBody('design'));
    expect(await fetchVocabulary()).toEqual(ABSENT);
    expect(await validateDraft({})).toEqual(ABSENT);
    expect(await planDraft({})).toEqual(ABSENT);
    expect(await runDraft({})).toEqual(ABSENT);
  });

  it('reads a proxy with nothing behind it the same way', async () => {
    answering(500, '', 'text/plain');
    expect(await validateDraft({})).toEqual(ABSENT);
  });

  it('says so in words a person can act on', () => {
    expect(NO_DESIGN_SERVER).toBe(
      'This lab is running without the design server, so a brief cannot be checked or run here',
    );
  });
});

describe('a design server that answered', () => {
  it('keeps the unrecognized-body sentence for JSON of the wrong shape', async () => {
    answeringJson(200, { verdict: 'fine' });
    expect(await validateDraft({})).toEqual({
      kind: 'unreachable',
      reason: 'the validate route answered 200 with a body this page does not recognize',
    });
    expect(await fetchVocabulary()).toEqual({
      kind: 'unreachable',
      reason: 'the vocabulary route answered 200 with a body this page does not recognize',
    });
  });

  it('still tells an editing-only server apart from an absent one', async () => {
    answeringJson(404, { refused: 'this server was started for editing only, so it runs nothing' });
    expect(await runDraft({})).toEqual({
      kind: 'unreachable',
      reason: 'this design server was started for editing only, so it runs nothing',
    });
  });

  it('reads a verdict', async () => {
    answeringJson(200, {
      ok: true,
      derived: { tertiaryBudget: 25, requiredCards: 1, authoredCards: 0, mechanics: 1 },
    });
    expect(await validateDraft({})).toEqual({
      kind: 'valid',
      derived: { tertiaryBudget: 25, requiredCards: 1, authoredCards: 0, mechanics: 1 },
    });
  });

  it('reports a refused connection as a server it could not reach', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
    expect(await validateDraft({})).toEqual({
      kind: 'unreachable',
      reason: 'could not reach the design server (connection refused)',
    });
  });
});
