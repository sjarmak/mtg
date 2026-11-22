/**
 * The set designer's server, driven over its own socket.
 *
 * `mtg-yddw.1`. The point of driving it over HTTP rather than calling the three
 * functions directly is that the page has nothing else: a designer's editor sees
 * status codes and JSON bodies, so the refusals are asserted in the shape they
 * arrive in. The functions have their own tests beside this one.
 *
 * Bound to 127.0.0.1 on port 0, which is the operating system picking a free
 * one. Nothing here listens on a network interface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODEL_ABILITY_KINDS } from '@mtg/dsl';
import type { RunningDesignServer } from '@mtg/setgen';
import { serveDesign } from '@mtg/setgen';
import { briefFromFile } from './helpers';

/** A brief that is already legal, used as the draft every case starts from. */
function draft() {
  return briefFromFile('tideglass-reach.json');
}

let running: RunningDesignServer | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

async function start(options: { readonly withRunner?: boolean } = {}): Promise<string> {
  running = await serveDesign({
    port: 0,
    host: '127.0.0.1',
    ...(options.withRunner === true
      ? { runner: async () => ({ ok: false, reason: 'a stand-in runner', unrecorded: true }) }
      : {}),
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

/**
 * Whatever the server answered, read the way the page reads it: untyped JSON.
 *
 * One `any` behind one name, because the subject of these tests is a wire and a
 * reader that trusted the sender's types would be checking nothing. Narrowing
 * each answer here would be re-declaring the server's own schemas in the file
 * that exists to find out whether the server honors them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(response: Response): Promise<Json> {
  return response.json();
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await json(response) };
}

describe('the vocabulary route', () => {
  it('serves the closed lists an editor offers, so the page carries no copy', async () => {
    const base = await start();
    const response = await fetch(`${base}/design-api/vocabulary`);
    expect(response.status).toBe(200);
    const vocabulary = await json(response);
    // Spot-checked against the vocabularies rather than counted: a count would
    // fail the day a keyword is added, which is the day this route is right.
    expect(vocabulary.keywords).toContain('flying');
    expect(vocabulary.abilityKinds).toEqual(MODEL_ABILITY_KINDS);
    expect(vocabulary.requiredPools).toContain('colorless');
    expect(vocabulary.sliceRarities).toEqual(['common', 'uncommon', 'rare']);
    expect(vocabulary.targetSize.min).toBeLessThan(vocabulary.targetSize.default);
    expect(vocabulary.setCodePattern).toBe('^[A-Z0-9]{3,5}$');
  });

  it('is read with GET, and says so to a POST', async () => {
    const base = await start();
    const { status, body } = await post(base, '/design-api/vocabulary', {});
    expect(status).toBe(405);
    expect(body.refused).toContain('GET');
  });
});

describe('the validate route', () => {
  it('parses a real brief and reports the budget the run will use', async () => {
    const base = await start();
    const brief = draft();
    const { status, body } = await post(base, '/design-api/brief/validate', brief);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.brief.setCode).toBe(brief.setCode);
    // Stated by no brief in this tree, so the number a designer sees is derived
    // and this is the assertion that it is reported rather than left blank.
    expect(body.derived.tertiaryBudget).toBe(Math.ceil(brief.targetSize * 0.1));
  });

  it('returns every issue keyed to the field that earned it, not the first one', async () => {
    const base = await start();
    const brief = { ...draft(), setCode: 'lowercase', setName: '' };
    const { body } = await post(base, '/design-api/brief/validate', brief);
    expect(body.ok).toBe(false);
    const pointers = body.issues.map((issue: { pointer: string }) => issue.pointer);
    expect(pointers).toContain('setCode');
    expect(pointers).toContain('setName');
  });

  it('addresses an issue inside a list by index, which is what a field marker needs', async () => {
    const base = await start();
    const brief = draft();
    const broken = {
      ...brief,
      mechanics: brief.mechanics.map((mechanic, index) =>
        index === 1 ? { ...mechanic, name: '' } : mechanic,
      ),
    };
    const { body } = await post(base, '/design-api/brief/validate', broken);
    expect(body.ok).toBe(false);
    expect(body.issues.some((issue: { pointer: string }) => issue.pointer === 'mechanics.1.name')).toBe(true);
  });

  it('tells a body that is not JSON apart from a body that is not a brief', async () => {
    const base = await start();
    const response = await fetch(`${base}/design-api/brief/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
    expect((await json(response)).refused).toContain('not JSON');
  });
});

describe('the plan route', () => {
  it('allocates the brief and censuses it without calling any provider', async () => {
    const base = await start();
    const brief = draft();
    const { status, body } = await post(base, '/design-api/brief/plan', brief);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.plan.slots).toBe(brief.targetSize);
    expect(body.plan.pools).toHaveLength(6);
    expect(body.plan.pools.reduce((sum: number, pool: { total: number }) => sum + pool.total, 0)).toBe(
      brief.targetSize,
    );
    // Every mechanic the brief states has to reach the common tier, which is the
    // failure this census exists to make visible before a run pays for it.
    for (const mechanic of body.plan.mechanics) expect(mechanic.slots).toBeGreaterThan(0);
  });

  it('hands back the same issues the validate route does, rather than a second vocabulary', async () => {
    const base = await start();
    const { body } = await post(base, '/design-api/brief/plan', { ...draft(), targetSize: 3 });
    expect(body.ok).toBe(false);
    expect(body.invalid.some((issue: { pointer: string }) => issue.pointer === 'targetSize')).toBe(true);
  });
});

describe('the run route', () => {
  it('is absent on a server started for editing alone', async () => {
    const base = await start();
    const { status, body } = await post(base, '/design-api/run', draft());
    expect(status).toBe(404);
    expect(body.refused).toContain('runs nothing');
  });

  it('reaches the runner only with a brief that parsed', async () => {
    const base = await start({ withRunner: true });
    const invalid = await post(base, '/design-api/run', { ...draft(), setCode: 'lowercase' });
    expect(invalid.body.ok).toBe(false);
    expect(invalid.body.invalid).toBeDefined();
    const valid = await post(base, '/design-api/run', draft());
    expect(valid.body.reason).toBe('a stand-in runner');
  });
});

describe('the routes this server does not have', () => {
  it('refuses a path outside its own prefix, so it cannot be mistaken for the game server', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/table/whatever`);
    expect(response.status).toBe(404);
    expect((await json(response)).refused).toContain('/design-api');
  });
});
