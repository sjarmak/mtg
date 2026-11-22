/**
 * The deckbench launcher's two decisions, taken apart from anything it starts.
 *
 * Both are pure functions on purpose: what a flag means and what to do about a
 * lab that is already running are the parts worth holding, and neither needs a
 * port bound or a child spawned to be checked.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECK_PORT,
  DEFAULT_VARIATION_DIR,
  planWeb,
  readDeckbenchArgs,
  SIZED_FOR_SPELLS,
  SUGGESTED_MAX_USD,
} from '../tools/deckbench';
import { defaultMaxSpendUsd, ROUND_COST_USD } from '../src/select';
import type { LauncherClaim } from '../../ui/tools/launcher-lock';

const HELD: LauncherClaim = {
  command: 'npm run play',
  pid: 4242,
  port: 5273,
  at: '2026-09-01T12:00:00.000Z',
};

describe('the ceiling this launcher tells somebody to type', () => {
  it('can pay for the deck it is advertised for', () => {
    // `mtg-yp33.6`. It said $0.50, and `select.ts` records two live rounds at
    // $0.4735 and $0.4980: the number in the note bought exactly one round of a
    // selection a 60-card deck is sized at twelve of, so every deck built under
    // it stopped part-way by construction. A suggestion that cannot finish is
    // not a suggestion.
    expect(SUGGESTED_MAX_USD).toBeGreaterThanOrEqual(defaultMaxSpendUsd(SIZED_FOR_SPELLS));
  });

  it('is worth more than one round, which is the shape of the bug it replaced', () => {
    expect(SUGGESTED_MAX_USD).toBeGreaterThan(ROUND_COST_USD);
  });
});

describe('the flags', () => {
  it('builds nothing unless a dollar ceiling was typed', () => {
    // The whole money rule: there is no default and no environment variable, so
    // the absence of a number is the absence of a builder.
    expect(readDeckbenchArgs([]).maxUsd).toBeUndefined();
    expect(readDeckbenchArgs(['--max-usd', '0.50']).maxUsd).toBe(0.5);
  });

  it('refuses a ceiling of zero rather than reading it as "no builds"', () => {
    // Somebody who typed a ceiling meant to arm the button. Silently disarming
    // it would be the confusing half of both behaviors.
    expect(() => readDeckbenchArgs(['--max-usd', '0'])).toThrow(/positive number of dollars/);
    expect(() => readDeckbenchArgs(['--max-usd', 'free'])).toThrow(/positive number of dollars/);
  });

  it('defaults the API to the port the page proxies to', () => {
    const args = readDeckbenchArgs([]);

    expect(args.apiPort).toBe(DEFAULT_DECK_PORT);
    expect(args.variationDir).toBe(DEFAULT_VARIATION_DIR);
  });

  it('names a flag it does not have rather than ignoring it', () => {
    expect(() => readDeckbenchArgs(['--budget', '5'])).toThrow(/no such flag: --budget/);
  });
});

describe('what to do about a lab that is already running', () => {
  it('starts its own page when nobody holds the staged directory', () => {
    expect(planWeb(null, DEFAULT_DECK_PORT)).toStrictEqual({ kind: 'start' });
  });

  it('serves the deck API alone rather than staging over a running lab', () => {
    // `mtg-yp33.3`. The staged directory collides and the API does not: the page
    // reaches it through a proxy whose target is only a port, so a lab that is
    // already up is a page that can be told, not a reason to refuse.
    const plan = planWeb(HELD, DEFAULT_DECK_PORT);

    expect(plan.kind).toBe('attach');
    expect(plan.kind === 'attach' ? plan.message : '').toContain('5273');
    expect(plan.kind === 'attach' ? plan.message : '').toContain('Describe a deck');
  });

  it('refuses a moved API port against a running lab, because that page cannot be told', () => {
    // The running page's proxy target was fixed when it booted. Starting on a
    // port it will never ask is a server nobody can reach, and a launcher that
    // says it is up would be lying.
    const plan = planWeb(HELD, 6100);

    expect(plan.kind).toBe('refuse');
    expect(plan.kind === 'refuse' ? plan.message : '').toContain('--api-port');
  });

  it('lets a moved API port through when this run is starting its own page', () => {
    expect(planWeb(null, 6100)).toStrictEqual({ kind: 'start' });
  });
});
