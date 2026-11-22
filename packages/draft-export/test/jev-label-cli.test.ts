/**
 * The command line end to end, against a fake gateway.
 *
 * What is pinned is the contract a person relies on when they start a
 * thousand-call run and walk away: it resumes instead of repeating, it stops at
 * a rate limit and says so in the record and the exit code, the key reaches
 * neither the record nor the output, and a gap short enough to trip the limit
 * is refused before any call is made.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../tools/jev-label/cli';
import type { CliDeps } from '../tools/jev-label/cli';
import { JEV_DIRECT_REQUEST_UPPER_BOUND_USD } from '../tools/jev-label/runner';
import { answersOf, readRecords } from '../tools/jev-label/record';
import { answerBody, SET, decisionsOf, recordOf } from './jev-label-fixture';

const KEY = 'sk-test-DISTINCTIVE-cli-key';

describe('the jev-label command line', () => {
  let directory: string;
  let setFile: string;
  let out: string;
  let text: string[];
  let requests: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-jev-cli-'));
    setFile = join(directory, 'set.json');
    out = join(directory, 'runs', 'labels.jsonl');
    writeFileSync(setFile, JSON.stringify(SET));
    text = [];
    requests = 0;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function gateway(failAt?: { call: number; status: number }): typeof fetch {
    return (_input, init) => {
      requests += 1;
      if (failAt !== undefined && requests === failAt.call) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'limit reached' }), { status: failAt.status }),
        );
      }
      const body = JSON.parse(String(init?.body)) as {
        questions: { pick: { criteria: Record<string, string> } };
      };
      const ids = Object.keys(body.questions.pick.criteria);
      return Promise.resolve(new Response(JSON.stringify(answerBody(ids)), { status: 200 }));
    };
  }

  function direct(): typeof fetch {
    return (_input, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as {
        questions: { pick: { criteria: Record<string, string> } };
      };
      const ids = Object.keys(body.questions.pick.criteria);
      const answer = answerBody(ids) as { answers: unknown };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'jev-1.13.0',
            answers: answer.answers,
            usage: { input_tokens: 1200, output_tokens: 100 },
          }),
          { status: 200 },
        ),
      );
    };
  }

  function deps(overrides: Partial<CliDeps> = {}): CliDeps {
    let clock = 0;
    return {
      env: { AI_GATEWAY_API_KEY: KEY },
      fetchImpl: gateway(),
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      write: (chunk) => text.push(chunk),
      ...overrides,
    };
  }

  /** The label command's flags with the defaults below, any of which `overrides` replaces. */
  const label = (overrides: Readonly<Record<string, string>> = {}): string[] => {
    const flags: Record<string, string> = {
      '--set': setFile,
      '--seed-prefix': 'cli',
      '--out': out,
      '--decisions': '4',
      '--repeats': '2',
      '--gap-ms': '1000',
      ...overrides,
    };
    return ['label', ...Object.entries(flags).flat()];
  };

  it('labels the plan, records every answer and a closing stop record, and exits 0', async () => {
    expect(await main(label(), deps())).toBe(0);

    const records = readRecords(out);
    expect(answersOf(records)).toHaveLength(6);
    expect(answersOf(records).filter((record) => record.repeat === 1)).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ kind: 'stop', reason: 'done', requests: 6, recorded: 6 });
    expect(requests).toBe(6);
    expect(text.join('')).toContain('plan: 6 calls (4 labels, 2 repeats), 0 already recorded');
  });

  it('resumes from the record and makes no call for work it already holds', async () => {
    await main(label(), deps());
    requests = 0;

    expect(await main(label(), deps())).toBe(0);

    expect(requests).toBe(0);
    expect(answersOf(readRecords(out))).toHaveLength(6);
    expect(text.join('')).toContain('6 already recorded');
  });

  it('extends a stopped run: only the calls after the stop are made', async () => {
    expect(await main(label(), deps({ fetchImpl: gateway({ call: 3, status: 429 }) }))).toBe(1);
    expect(answersOf(readRecords(out))).toHaveLength(2);
    requests = 0;

    expect(await main(label(), deps())).toBe(0);
    expect(requests).toBe(4);
    expect(answersOf(readRecords(out))).toHaveLength(6);
  });

  it('exits 1 at a rate limit, records why, and keeps what it had', async () => {
    expect(await main(label(), deps({ fetchImpl: gateway({ call: 3, status: 429 }) }))).toBe(1);

    const records = readRecords(out);
    expect(answersOf(records)).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ kind: 'stop', reason: 'rate-limit', requests: 3, recorded: 2 });
    expect(text.join('')).toContain('stopped: rate-limit after 3 requests, 2 recorded');
    expect(requests).toBe(3);
  });

  it('exits 1 at the request cap', async () => {
    expect(await main(label({ '--max-requests': '2' }), deps())).toBe(1);
    expect(readRecords(out).at(-1)).toMatchObject({ kind: 'stop', reason: 'cap', requests: 2 });
  });

  it('puts the key in neither the record nor the output', async () => {
    await main(label(), deps({ fetchImpl: gateway({ call: 2, status: 401 }) }));
    expect(readFileSync(out, 'utf8')).not.toContain(KEY);
    expect(text.join('')).not.toContain(KEY);
  });

  it('refuses a gap short enough to trip the limit before it makes any call', async () => {
    await expect(main(label({ '--gap-ms': '500' }), deps())).rejects.toThrow(
      /--gap-ms must be an integer of at least 1000/,
    );
    expect(requests).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('deals the packs of a collation file, and refuses one that is not a recipe', async () => {
    const collation = join(directory, 'collation.json');
    writeFileSync(
      collation,
      JSON.stringify({
        recipe: [
          { rarity: 'common', count: 10 },
          { rarity: 'uncommon', count: 3 },
          { rarity: 'rare', count: 1 },
        ],
      }),
    );
    expect(await main(label({ '--collation': collation }), deps())).toBe(0);
    const [first] = answersOf(readRecords(out));
    expect(first?.packIds).toHaveLength(14);

    writeFileSync(collation, JSON.stringify({ recipe: [{ rarity: 'legendary', count: 1 }] }));
    requests = 0;
    await expect(
      main(label({ '--collation': collation, '--out': join(directory, 'other.jsonl') }), deps()),
    ).rejects.toThrow();
    expect(requests).toBe(0);
  });

  it('refuses to resume a record taken under another plan, before it makes any call', async () => {
    await main(label(), deps());
    const collation = join(directory, 'collation.json');
    writeFileSync(
      collation,
      JSON.stringify({
        recipe: [
          { rarity: 'common', count: 10 },
          { rarity: 'uncommon', count: 3 },
          { rarity: 'rare', count: 1 },
        ],
      }),
    );
    requests = 0;

    await expect(main(label({ '--collation': collation }), deps())).rejects.toThrow(
      /different pack than this plan deals/,
    );
    expect(requests).toBe(0);
  });

  it('refuses to run without a key, before any call', async () => {
    await expect(main(label(), deps({ env: {} }))).rejects.toThrow(/AI_GATEWAY_API_KEY/);
    expect(requests).toBe(0);
  });

  it('reads the key from an env file when the environment has none', async () => {
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `AI_GATEWAY_API_KEY=${KEY}\n`);
    expect(await main(label({ '--env-file': envFile }), deps({ env: {} }))).toBe(0);
    expect(requests).toBe(6);
  });

  it('refuses the paid direct API without --max-usd before reading a key or making a call', async () => {
    await expect(
      main(label({ '--provider': 'direct' }), deps({ env: {}, fetchImpl: direct() })),
    ).rejects.toThrow(/direct provider requires --max-usd/);
    expect(requests).toBe(0);
  });

  it('uses the direct key and refuses the first request when its upper-bound estimate would cross the ceiling', async () => {
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `TYPESAFE_API_KEY=${KEY}\n`);

    expect(
      await main(
        label({
          '--provider': 'direct',
          '--env-file': envFile,
          '--max-usd': String(JEV_DIRECT_REQUEST_UPPER_BOUND_USD / 2),
        }),
        deps({ env: {}, fetchImpl: direct() }),
      ),
    ).toBe(0);
    expect(requests).toBe(0);
    expect(readRecords(out).at(-1)).toMatchObject({ kind: 'stop', reason: 'budget', spentUsd: 0 });
    expect(text.join('')).toContain('upper-bound estimate');
  });

  it('carries the direct upper-bound estimate across a resumed run', async () => {
    const directDeps = deps({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: direct() });
    expect(
      await main(
        label({
          '--provider': 'direct',
          '--max-usd': String(JEV_DIRECT_REQUEST_UPPER_BOUND_USD * 2),
          '--max-requests': '1',
        }),
        directDeps,
      ),
    ).toBe(1);
    expect(requests).toBe(1);

    requests = 0;
    expect(
      await main(
        label({
          '--provider': 'direct',
          '--max-usd': String(JEV_DIRECT_REQUEST_UPPER_BOUND_USD * 1.5),
        }),
        directDeps,
      ),
    ).toBe(0);
    expect(requests).toBe(0);
    expect(readRecords(out).at(-1)).toMatchObject({
      kind: 'stop',
      reason: 'budget',
      spentUsd: JEV_DIRECT_REQUEST_UPPER_BOUND_USD,
    });
  });

  it('puts the direct key in neither the record nor output when TypeSafe echoes it in an error', async () => {
    const echoedKey: typeof fetch = () => {
      requests += 1;
      return Promise.resolve(new Response(JSON.stringify({ error: `bad key ${KEY}` }), { status: 401 }));
    };

    expect(
      await main(
        label({ '--provider': 'direct', '--max-usd': '1' }),
        deps({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: echoedKey }),
      ),
    ).toBe(1);
    expect(readFileSync(out, 'utf8')).not.toContain(KEY);
    expect(text.join('')).not.toContain(KEY);
  });

  it('refuses a flag it does not know, a flag given twice, and a flag with no value', async () => {
    await expect(main(label({ '--spend': '5' }), deps())).rejects.toThrow(/unknown argument --spend/);
    await expect(main([...label(), '--decisions', '9'], deps())).rejects.toThrow(/given twice/);
    await expect(main(['label', '--set'], deps())).rejects.toThrow(/needs a value/);
    expect(requests).toBe(0);
  });

  it('refuses an unknown command', async () => {
    await expect(main(['spend'], deps())).rejects.toThrow(/usage/);
  });

  it('scores a record against a strength file without a key or a call', async () => {
    const records = decisionsOf(6).flatMap((decision) => [
      recordOf(decision, 0, { favor: decision.botPickId }),
    ]);
    const held = join(directory, 'held.jsonl');
    writeFileSync(held, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const strength = join(directory, 'strength.json');
    writeFileSync(
      strength,
      JSON.stringify({
        cards: SET.map((card, index) => ({
          cardId: card.id,
          strength:
            index % 5 === 0
              ? { state: 'underSampled', estimate: null }
              : { state: 'estimated', estimate: index / 100 },
          extra: 'ignored',
        })),
      }),
    );

    const code = await main(
      ['score', '--set', setFile, '--records', held, '--strength', strength, '--min-appearances', '1'],
      deps({ env: {} }),
    );

    expect(code).toBe(0);
    expect(requests).toBe(0);
    const report = text.join('');
    expect(report).toContain('(a) does the per-option probability predict strength');
    expect(report).toContain('decisions labeled once or more: 6');
    expect(report).toContain('(b) agreement with human picks: not measured');
    expect(report).not.toContain('NaN');
  });

  it('refuses a strength file that is not a campaign artifact', async () => {
    const held = join(directory, 'held.jsonl');
    writeFileSync(held, '');
    const strength = join(directory, 'strength.json');
    writeFileSync(
      strength,
      JSON.stringify({ cards: [{ cardId: 'x', strength: { state: 'guess', estimate: 1 } }] }),
    );
    await expect(
      main(['score', '--set', setFile, '--records', held, '--strength', strength], deps({ env: {} })),
    ).rejects.toThrow();
  });
});
