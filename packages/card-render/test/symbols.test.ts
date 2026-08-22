/**
 * Rules-text symbols, on both faces, behind the swappable glyph registry.
 *
 * `@mtg/dsl` prints a mana or tap cost as a brace token — `{T}`, `{1}{R}`,
 * `Equip {2}` — and until this file nothing downstream substituted it, so both
 * faces printed the braces. The check is written over both renderers at once,
 * for the same reason `parity.test.ts` is: a substitution that lands on the web
 * face and not on the printed sheet is the failure this suite exists to catch.
 *
 * The registry is the licensing half. `symbols.ts` in `@mtg/ui` resolves a token
 * to artwork through a named set rather than an import, so the artwork can be
 * swapped without touching a call site, and `original` is a set with no
 * third-party artwork in it at all.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card as DslCard } from '@mtg/dsl';
import { BASIC_LANDS, isCastable, renderOracleText } from '@mtg/dsl';
import {
  PRINTED_SYMBOL_SET,
  SCRYFALL_SYMBOL_BASE,
  SYMBOL_SETS,
  SYMBOL_TOKENS,
  Card,
  oracleChunks,
  symbolArt,
  symbolLabel,
} from '@mtg/ui';
import { checkSvgOverflow, renderCardSvg } from '@mtg/card-render';
import { activatedCards, equipmentCards } from './fixtures/cards';

/** Cards whose printed text carries a brace token: a land, an ability, an equip cost. */
const SYMBOL_CARDS: readonly DslCard[] = [...BASIC_LANDS, ...activatedCards(), ...equipmentCards()];

function domFace(card: DslCard): string {
  return renderToStaticMarkup(h(Card, { card }));
}

function svgFace(card: DslCard): string {
  return renderCardSvg(card, { embedStyles: false }).svg;
}

/**
 * The rules box of a web face, as markup.
 *
 * Cut at its own boundaries rather than at the end of the face: the opening tag
 * carries `data-fit` after `data-region`, and a creature's out-of-flow P/T
 * badge now follows the box, so neither end of it is where it used to be.
 */
function domRules(markup: string): string {
  const open = /<span class="mtg-card__text"[^>]*>/.exec(markup);
  if (open === null) return '';
  const rest = markup.slice(open.index + open[0].length);
  const after = /<span class="mtg-card__(?:stats|foot)"/.exec(rest);
  const box = after === null ? rest : rest.slice(0, after.index);
  return box.replace(/<\/span>(<\/(?:div|button)>)?\s*$/, '');
}

/** Every `<text>` run the printed face set in its rules box. */
function svgRulesRuns(markup: string): readonly string[] {
  return [...markup.matchAll(/<text[^>]*\bdata-region="rules"[^>]*>([\s\S]*?)<\/text>/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('a brace token never reaches a face as text', () => {
  it('paints every token of a printed line as a symbol on the web face', () => {
    for (const card of SYMBOL_CARDS) {
      const tokens = renderOracleText(card).match(/\{[^{}]+\}/g) ?? [];
      if (tokens.length === 0) continue;
      const rules = domRules(domFace(card));
      for (const token of tokens) {
        expect(rules, `${card.id} paints ${token}`).toContain(`data-symbol="${token}"`);
      }
    }
  });

  it('paints every token of a printed line as a symbol on the printed sheet', () => {
    for (const card of SYMBOL_CARDS) {
      const tokens = renderOracleText(card).match(/\{[^{}]+\}/g) ?? [];
      if (tokens.length === 0) continue;
      const svg = svgFace(card);
      for (const token of tokens) {
        expect(svg, `${card.id} paints ${token}`).toContain(`data-symbol="${token}"`);
      }
      // A run of set text is where a brace would surface if the substitution
      // missed one; the symbol carries its own name in an attribute instead.
      for (const run of svgRulesRuns(svg)) {
        expect(run, `${card.id} run "${run}"`).not.toMatch(/[{}]/);
      }
    }
  });

  it('keeps the brace text in the web face, where a reader can still find it', () => {
    const swamp = BASIC_LANDS.find((land) => land.id.endsWith('swamp'));
    if (swamp === undefined) throw new Error('symbols: no swamp among the basic lands');
    const rules = domRules(domFace(swamp));
    // `{T}: Add {B}.` — the abbreviation carries the token as its own content,
    // the way Scryfall's does, so find-in-page and a screen reader still work.
    expect(rules).toContain('>{T}<');
    expect(rules).toContain('>{B}<');
  });
});

describe('the glyph registry', () => {
  it('is total over the same tokens in every set', () => {
    expect(SYMBOL_TOKENS.length).toBeGreaterThan(0);
    for (const set of SYMBOL_SETS) {
      for (const token of SYMBOL_TOKENS) {
        expect(symbolArt(token, set), `${set} states ${token}`).not.toBeNull();
      }
    }
    for (const token of SYMBOL_TOKENS) {
      expect(symbolLabel(token), `${token} is named`).not.toBeNull();
    }
  });

  it('holds no third-party artwork in the original set', () => {
    for (const token of SYMBOL_TOKENS) {
      const art = symbolArt(token, 'original');
      expect(art?.kind, `${token} is drawn here`).not.toBe('image');
    }
  });

  it('leaves an unknown token alone rather than inventing a symbol for it', () => {
    expect(symbolArt('QQ', 'original')).toBeNull();
    expect(symbolArt('QQ', 'scryfall')).toBeNull();
    expect(oracleChunks('a {QQ} b')).toEqual([{ kind: 'text', text: 'a {QQ} b' }]);
  });

  it('splits a printed line into text and symbols, in order', () => {
    expect(oracleChunks('{T}: Add {B}.')).toEqual([
      { kind: 'symbol', token: 'T', text: '{T}' },
      { kind: 'text', text: ': Add ' },
      { kind: 'symbol', token: 'B', text: '{B}' },
      { kind: 'text', text: '.' },
    ]);
  });
});

describe('the swap layer', () => {
  it('is entered without touching a call site, on both faces', () => {
    for (const card of SYMBOL_CARDS) {
      const tokens = renderOracleText(card).match(/\{[^{}]+\}/g) ?? [];
      if (tokens.length === 0) continue;
      const dom = renderToStaticMarkup(h(Card, { card, symbols: 'original' }));
      const svg = renderCardSvg(card, { embedStyles: false, symbols: 'original' }).svg;
      expect(dom, `${card.id} web face references no remote symbol`).not.toContain('scryfall.io');
      expect(svg, `${card.id} printed face references no remote symbol`).not.toContain('scryfall.io');
      for (const token of tokens) {
        expect(domRules(dom), `${card.id} still paints ${token}`).toContain(`data-symbol="${token}"`);
        expect(svg, `${card.id} still paints ${token}`).toContain(`data-symbol="${token}"`);
      }
    }
  });

  it('leaves the printed words alone whichever set is drawn', () => {
    // The registry decides what a symbol looks like and nothing else. Both
    // faces are checked word for word by `parity.test.ts` under the default;
    // this is the same claim under the other set.
    for (const set of SYMBOL_SETS) {
      for (const card of SYMBOL_CARDS) {
        const dom = renderToStaticMarkup(h(Card, { card, symbols: set }));
        const printed = domRules(dom).replace(/<[^>]*>/g, '');
        for (const line of renderOracleText(card).split('\n')) {
          expect(printed, `${card.id} in ${set}`).toContain(line);
        }
      }
    }
  });
});

/** The cost group of a printed face, which is where the title bar's pips live. */
function svgCostGroup(markup: string): string {
  return /<g class="mtg-cost"[^>]*>([\s\S]*?)<\/g><\/g>/.exec(markup)?.[1] ?? '';
}

describe('the cost line is drawn from the same registry as the rules box', () => {
  it('references the same file the rules box references, when the set is a referenced one', () => {
    // One card, one vocabulary. The cost line used to draw `anatomy.ts`'s pip
    // whatever `--symbols` said, so a printed face could carry a drawn {2} in
    // the title bar over a referenced {1} in the rules box.
    const card = SYMBOL_CARDS.find((subject) => isCastable(subject));
    if (card === undefined) throw new Error('symbols: no castable card in the corpus');
    const referenced = renderCardSvg(card, { embedStyles: false, symbols: 'scryfall' }).svg;
    const cost = svgCostGroup(referenced);
    expect(cost).not.toBe('');
    expect(cost, 'every pip is the referenced file').toContain(SCRYFALL_SYMBOL_BASE);
    expect(cost, 'and nothing is drawn beside it').not.toContain('class="pip-glyph"');
  });

  it('draws its own outlines when asked for the set an artifact is published with', () => {
    const card = SYMBOL_CARDS.find((subject) => isCastable(subject));
    if (card === undefined) throw new Error('symbols: no castable card in the corpus');
    const drawn = renderCardSvg(card, { embedStyles: false, symbols: 'original' }).svg;
    const cost = svgCostGroup(drawn);
    expect(cost).not.toContain(SCRYFALL_SYMBOL_BASE);
    expect(cost).toMatch(/class="pip-glyph"|class="pip-digit"/);
  });
});

describe('the printed sheet stays measurable', () => {
  it('covers every symbol on a line, not just the text runs', () => {
    for (const set of SYMBOL_SETS) {
      for (const card of SYMBOL_CARDS) {
        const { svg } = renderCardSvg(card, { embedStyles: false, symbols: set });
        expect(checkSvgOverflow(svg), `${card.id} in ${set}`).toEqual([]);
      }
    }
  });

  it('renders a set with no third-party artwork when asked for one', () => {
    for (const card of SYMBOL_CARDS) {
      const { svg } = renderCardSvg(card, { embedStyles: false, symbols: 'original' });
      expect(svg, `${card.id} references no remote symbol`).not.toContain('scryfall.io');
    }
    // And the default is the other one, which is what decides what an emitted
    // file looks like when nobody passed the publish flag. A printed file is
    // opened somewhere this repository is not, so the referenced set is the
    // only one of the two remaining sets it can resolve; the web face defaults
    // elsewhere and `packages/ui/test/symbols.test.ts` says why.
    expect(PRINTED_SYMBOL_SET).toBe('scryfall');
    const swamp = BASIC_LANDS.find((land) => land.id.endsWith('swamp'));
    if (swamp === undefined) throw new Error('symbols: no swamp among the basic lands');
    expect(renderCardSvg(swamp, { embedStyles: false }).svg).toContain(SCRYFALL_SYMBOL_BASE);
  });
});
