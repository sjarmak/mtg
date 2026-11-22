import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_CURATION_SERVER, readRemoteState, writePreference } from '../src/curate/client';
import { helperAbsentBody } from '../src/net/helper-absent';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answering(status: number, body: string, type: string): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
  );
}

const ABSENT = { ok: false, reason: NO_CURATION_SERVER };

describe('a lab with no curation server behind the page', () => {
  it('says a pick was not recorded when the page is answered in place of the route', async () => {
    answering(200, '<!doctype html><title>frozen ui</title>', 'text/html; charset=utf-8');
    expect(await writePreference('xmp-001', ['a'])).toEqual(ABSENT);
  });

  it('says the same for the absent-helper answer', async () => {
    answering(404, JSON.stringify(helperAbsentBody('curation')), 'application/json; charset=utf-8');
    expect(await writePreference('xmp-001', ['a'])).toEqual(ABSENT);
    expect(await readRemoteState()).toBeNull();
  });

  it('names the command that starts one', () => {
    expect(NO_CURATION_SERVER).toBe(
      'this lab runs without the curation server, so nothing was recorded. Start one with npm run curate',
    );
  });
});

describe('a curation server that answered', () => {
  it('accepts a recorded pick', async () => {
    answering(200, JSON.stringify({ ok: true }), 'application/json');
    expect(await writePreference('xmp-001', ['a'])).toEqual({ ok: true });
  });

  it('repeats its own refusal', async () => {
    answering(400, JSON.stringify({ ok: false, reason: 'no such card' }), 'application/json');
    expect(await writePreference('xmp-999', ['a'])).toEqual({ ok: false, reason: 'no such card' });
  });

  it('keeps the unrecognized-body sentence for JSON of the wrong shape', async () => {
    answering(200, JSON.stringify({ recorded: 'yes' }), 'application/json');
    expect(await writePreference('xmp-001', ['a'])).toEqual({
      ok: false,
      reason: 'the curation server answered 200 with a body this page does not recognize',
    });
  });
});
