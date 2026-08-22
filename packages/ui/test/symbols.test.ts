/**
 * The registry, from the lab's side: what the page reaches for when nobody
 * tells it which set to paint.
 *
 * `packages/card-render/test/symbols.test.ts` checks that both faces substitute
 * a brace token and that every set is total over the vocabulary. This file
 * checks the one thing that is `@mtg/ui`'s alone: a lab opened with no network
 * still draws every symbol, because the default set names no other host.
 *
 * That was not true when `DEFAULT_SYMBOL_SET` was `scryfall`. A viewer behind a
 * DNS filter or on the far end of a tunnel got an empty box per symbol, which
 * is the same failure `tools/stage-art.ts` exists to prevent for illustrations.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card as DslCard } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS, isCastable } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { ManaPips } from '../src/card/ManaPips';
import { PlayerStatus } from '../src/board/PlayerStatus';
import {
  DEFAULT_SYMBOL_SET,
  LOCAL_SYMBOL_BASE,
  PRINTED_SYMBOL_SET,
  SYMBOL_SETS,
  SYMBOL_TOKENS,
  symbolArt,
  symbolSetFrom,
} from '../src/card/symbols';

/** True for an href the browser resolves against another origin. */
function namesAHost(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

describe('the set the lab paints with when nothing configures it', () => {
  it('names no other host, so a lab with no network still draws every symbol', () => {
    for (const token of SYMBOL_TOKENS) {
      const art = symbolArt(token, DEFAULT_SYMBOL_SET);
      expect(art, `${token} is stated`).not.toBeNull();
      if (art?.kind === 'image') {
        expect(namesAHost(art.href), `${token} draws from ${art.href}`).toBe(false);
      }
    }
  });

  it('is the drawn set, which needs no staging run at all', () => {
    // Nothing has staged anything into a bare `vitest` or a bare `vite dev`, so
    // the only set that is certainly complete is the one this tree draws itself.
    expect(DEFAULT_SYMBOL_SET).toBe('original');
  });
});

describe('the staged local set', () => {
  it('addresses every token by name under the served directory', () => {
    for (const token of SYMBOL_TOKENS) {
      const art = symbolArt(token, 'local');
      expect(art?.kind, `${token} is referenced`).toBe('image');
      if (art?.kind !== 'image') continue;
      expect(art.href).toBe(`${LOCAL_SYMBOL_BASE}${token}.svg`);
      expect(namesAHost(art.href), `${token} stays on this origin`).toBe(false);
    }
  });

  it('is a set the registry states beside the other two', () => {
    expect([...SYMBOL_SETS]).toEqual(['scryfall', 'local', 'original']);
  });
});

describe('what a launcher may configure', () => {
  it('takes the staged set only when the launcher says it staged one', () => {
    expect(symbolSetFrom('local')).toBe('local');
    expect(symbolSetFrom('scryfall')).toBe('scryfall');
    expect(symbolSetFrom('original')).toBe('original');
  });

  it('falls back to the drawn set for anything else, rather than to an empty box', () => {
    expect(symbolSetFrom('')).toBe('original');
    expect(symbolSetFrom('nonsense')).toBe('original');
  });
});

/** The pips of a cost line, as `{token: how it was drawn}` in document order. */
function costPipArt(markup: string): readonly string[] {
  const cost = /<span class="mtg-cost"[^>]*>([\s\S]*?)<\/span><\/span>/.exec(markup)?.[1] ?? '';
  return [...cost.matchAll(/<span class="mtg-pip"[^>]*>([\s\S]*?)<\/span>/g)].map((match) => match[1] ?? '');
}

function costPipTags(markup: string): readonly string[] {
  const cost = /<span class="mtg-cost"[^>]*>([\s\S]*?)<\/span><\/span>/.exec(markup)?.[1] ?? '';
  return [...cost.matchAll(/<span class="mtg-pip"([^>]*)>/g)].map((match) => match[1] ?? '');
}

function castable(): DslCard {
  const card = EXAMPLE_CARDS.find((example) => isCastable(example));
  if (card === undefined) throw new Error('symbols: no castable card in the example set');
  return card;
}

describe('one card, one vocabulary', () => {
  it('draws the title bar cost from the set the rules box is drawn from', () => {
    // The face used to hold two vocabularies at once: the rules box asked the
    // registry and the title bar drew `anatomy.ts`'s own pip whatever the set
    // said, so a card could show a pale drawn {2} above a referenced {1}.
    const card = castable();
    const referenced = renderToStaticMarkup(h(Card, { card, symbols: 'local' }));
    for (const tag of costPipTags(referenced)) {
      expect(tag, 'a referenced pip is served from this origin').toContain('symbols/');
    }
    expect(costPipTags(referenced).length).toBeGreaterThan(0);

    const drawn = renderToStaticMarkup(h(Card, { card, symbols: 'original' }));
    for (const art of costPipArt(drawn)) {
      expect(art, 'a drawn pip is an outline this tree draws, or its numeral').not.toContain('http');
    }
  });

  it('takes the set from the face rather than from a global, on the pips too', () => {
    const cost = { generic: 2, W: 0, U: 0, B: 0, R: 1, G: 0, hasX: false };
    const local = renderToStaticMarkup(h(ManaPips, { cost, symbols: 'local' }));
    const scryfall = renderToStaticMarkup(h(ManaPips, { cost, symbols: 'scryfall' }));
    expect(local).toContain('symbols/R.svg');
    expect(local).not.toContain('scryfall.io');
    expect(scryfall).toContain('svgs.scryfall.io/card-symbols/R.svg');
  });

  it('draws the floating mana pool from the same set as a cost pip', () => {
    // `mtg-bc2.45.5` closed on the pool drawing glyphs rather than spelling
    // color letters, and it still does. What it could not know about is a set:
    // a pool of drawn pips beside a referenced cost line is the same disagreement
    // one layer down.
    const pool = { W: 1, U: 0, B: 0, R: 1, G: 0, C: 0 };
    const markup = renderToStaticMarkup(
      h(PlayerStatus, {
        name: 'You',
        life: 20,
        handCount: 7,
        libraryCount: 53,
        graveyardCount: 0,
        mana: pool,
        symbols: 'local',
      }),
    );
    expect(markup).toContain('symbols/W.svg');
    expect(markup).toContain('symbols/R.svg');
    expect(markup).not.toContain('scryfall.io');
  });

  it('paints a land face with no cost line at all, which is not a missing pip', () => {
    const swamp = BASIC_LANDS.find((land) => land.id.endsWith('swamp'));
    if (swamp === undefined) throw new Error('symbols: no swamp among the basic lands');
    const markup = renderToStaticMarkup(h(Card, { card: swamp, symbols: 'local' }));
    expect(costPipTags(markup)).toEqual([]);
    expect(markup, 'its rules text still carries symbols').toContain('symbols/T.svg');
  });
});

describe('the printed sheet', () => {
  it('keeps naming the host outright, because the file leaves this machine', () => {
    // A relative `symbols/T.svg` resolves against wherever the SVG was opened,
    // which is not this repository. Print references the host or draws its own.
    expect(PRINTED_SYMBOL_SET).toBe('scryfall');
  });
});
