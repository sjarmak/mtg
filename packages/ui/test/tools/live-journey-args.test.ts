import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readArgs } from '../../tools/live-journey-args';

const LIVE_JOURNEY_PATH = fileURLToPath(new URL('../../tools/live-journey.ts', import.meta.url));

describe('readArgs', () => {
  it('parses to maxUsd: null when --max-usd is not passed', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310']);
    expect(typeof args).not.toBe('string');
    expect((args as { maxUsd: number | null }).maxUsd).toBeNull();
  });

  it('arms maxUsd at the given positive number of dollars', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd', '5']);
    expect(typeof args).not.toBe('string');
    expect((args as { maxUsd: number | null }).maxUsd).toBe(5);
  });

  it('rejects --max-usd with no value', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd']);
    expect(typeof args).toBe('string');
    expect(args as string).toMatch(/--max-usd needs a value/);
  });

  it('rejects a non-positive --max-usd', () => {
    for (const bad of ['0', '-1', 'nope']) {
      const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd', bad]);
      expect(typeof args).toBe('string');
      expect(args as string).toMatch(/--max-usd must be a positive number/);
    }
  });

  it('has no env file unless one is named: there is no default and no search', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd', '5']);
    expect((args as { envFile: string | null }).envFile).toBeNull();
  });

  it('resolves a named --env-file against the working directory', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd', '5', '--env-file', 'made-up.env']);
    expect(typeof args).not.toBe('string');
    expect((args as { envFile: string | null }).envFile).toBe(resolve(process.cwd(), 'made-up.env'));
  });

  it('rejects --env-file with no value', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--max-usd', '5', '--env-file']);
    expect(typeof args).toBe('string');
    expect(args as string).toMatch(/--env-file needs a value/);
  });

  it('refuses --env-file without --max-usd, since only the Stagehand path reads it', () => {
    const args = readArgs(['--url', 'http://127.0.0.1:5310', '--env-file', 'made-up.env']);
    expect(typeof args).toBe('string');
    expect(args as string).toMatch(/--env-file only feeds the Stagehand path/);
  });
});

describe("live-journey.ts's armed branch refuses before discovery and before Chrome", () => {
  it('reads the key and resolves the provider ahead of the first discover() and launchChrome()', () => {
    const source = readFileSync(LIVE_JOURNEY_PATH, 'utf8');
    const main = source.slice(source.indexOf('async function main('));
    const at = (needle: string): number => {
      const index = main.indexOf(needle);
      expect(index, `${needle} is in main()`).toBeGreaterThan(-1);
      return index;
    };
    const key = at('requireStagehandKey(');
    const provider = at('resolveStagehandProvider(');
    // The awaited calls, not the names: main()'s own comment mentions discover().
    for (const later of ['await launchChrome(', 'await discover(', "await import('./stagehand-runner')"]) {
      expect(key).toBeLessThan(at(later));
      expect(provider).toBeLessThan(at(later));
    }
  });
});
