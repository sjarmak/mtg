// @vitest-environment jsdom
/**
 * The lab deals a different game each time, and can still get one back.
 *
 * Both halves are the test. `SealedGame` used to default to the constant
 * `'lab/sealed/v0'`, so every session of the lab opened the identical six packs
 * — the shuffle in `kernel/src/setup.ts` was always real and always seeded, and
 * the seed was simply pinned. Randomizing that is easy and, done carelessly,
 * strictly worse: a pool nobody can name is a pool nobody can report a bug
 * against, and this project's whole measurement story rests on a game being
 * reproducible from a seed plus a list of integers.
 *
 * So: fresh when unasked, exact when asked, and the seed on screen either way.
 *
 * `openSealed` is called directly rather than through the component for the
 * determinism assertions, because that is the function whose totality in the
 * seed is the actual claim. The render tests then prove the component reaches
 * it with the seed it says it did.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { SealedGame } from '../../src/routes/play/SealedGame';
import { SEED_LABEL } from '../../src/routes/play/SealedBuilder';
import { newSeed } from '../../src/routes/play/seed';
import { openSealed } from '../../src/routes/play/sealed';

afterEach(cleanup);

/** The pool as card ids, which is what "the same game" means here. */
function poolOf(seed: string): readonly string[] {
  return openSealed(EXAMPLE_CARDS, seed).pool.map((card) => card.id);
}

describe('newSeed', () => {
  it('draws a different seed every call', () => {
    const seeds = new Set(Array.from({ length: 64 }, () => newSeed()));
    expect(seeds.size).toBe(64);
  });

  it('carries its prefix, so a seed says where it came from', () => {
    expect(newSeed('lab/sealed').startsWith('lab/sealed/')).toBe(true);
  });

  it('uses only characters that survive being read off a screen', () => {
    const token = newSeed('x').slice(2);
    expect(token).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
  });
});

describe('a sealed pool', () => {
  it('is a total function of its seed', () => {
    expect(poolOf('lab/sealed/fixed')).toEqual(poolOf('lab/sealed/fixed'));
  });

  it('differs between two seeds', () => {
    expect(poolOf('lab/sealed/one')).not.toEqual(poolOf('lab/sealed/two'));
  });
});

describe('the sealed builder', () => {
  /**
   * The value beside the `seed` label. Read through a cast for the same reason
   * `equip.test.ts` does: this project's test tsconfig carries no `dom` lib, so
   * the DOM node types testing-library returns are structural here.
   */
  function seedOnScreen(): string {
    const label: unknown = screen.getByText(SEED_LABEL);
    const fact = label as { readonly nextElementSibling?: { readonly textContent?: string | null } };
    const value = fact.nextElementSibling;
    if (value === undefined || value === null) {
      throw new Error('the seed fact has no value beside its label');
    }
    return value.textContent ?? '';
  }

  it('plays the seed it was given, and shows it', () => {
    render(createElement(SealedGame, { set: EXAMPLE_CARDS, seed: 'lab/sealed/named' }));
    expect(seedOnScreen()).toBe('lab/sealed/named');
  });

  it('draws its own seed when given none, and shows that', () => {
    render(createElement(SealedGame, { set: EXAMPLE_CARDS }));
    const shown = seedOnScreen();
    expect(shown).not.toBe('lab/sealed/v0');
    expect(shown.startsWith('lab/sealed/')).toBe(true);
  });

  /**
   * The regression itself. Two independent mounts with no seed named must not
   * open the same packs — that is the whole of what was reported from play.
   */
  it('opens a different pool on a second visit', () => {
    render(createElement(SealedGame, { set: EXAMPLE_CARDS }));
    const first = seedOnScreen();
    cleanup();
    render(createElement(SealedGame, { set: EXAMPLE_CARDS }));
    expect(seedOnScreen()).not.toBe(first);
  });
});
