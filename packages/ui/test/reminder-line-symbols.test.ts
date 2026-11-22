/**
 * A reminded rules line paints its mana symbols, the way the same line does
 * without a reminder on it.
 *
 * `mtg-m7hq`. the playtester, 2026-08-31, on Vitu-Ghazi Guildmage: the first
 * activated ability prints its cost as pips and the second prints the
 * characters `{2}{G}{W}: Populate.` Both abilities are the same shape in the
 * set document. The difference is that the second one earns a reminder, so
 * `../src/card/text-box.ts` gives it a block of kind `reminder` whose roman run
 * is the whole rules row rather than a keyword, and the DOM face sent only a
 * *rules* block's roman run through `symbolizeLine`.
 *
 * It was invisible while every reminded line was a keyword: `Flying` has no
 * braces, so painting it changed nothing. Every reminder whose roman run is a
 * whole rules row hits it, which is populate, gloom, protection and the ability
 * lines in `@mtg/dsl`'s own table.
 *
 * The printed face was already right (`@mtg/card-render`'s `regions.ts` sends
 * both runs through `richLine`), so this was a divergence between the two faces
 * ADR-0002 says draw the same card. The cross-face half is in
 * `packages/card-render/test/parity.test.ts`.
 *
 * Built on `@mtg/dsl`'s own example vocabulary, so it reads no set fixture.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Ability, Card as DslCard } from '@mtg/dsl';
import { exampleCard, renderOracleText } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { remindedBlocks } from '../src/card/text-box';

/** `{2}{G}{W}: Populate.` — the row Vitu-Ghazi Guildmage's second ability prints. */
const POPULATE: Ability = {
  kind: 'activated',
  cost: {
    mana: { generic: 2, W: 1, U: 0, B: 0, R: 0, G: 1, hasX: false },
    printedManaPips: ['G', 'W'],
    tapSelf: false,
    sacrificeSelf: false,
  },
  effects: [{ kind: 'populate' }],
};

function guildmage(): DslCard {
  const base = exampleCard('slc-skywatch-sentinel');
  return { ...base, keywords: [], abilities: [POPULATE] };
}

function face(card: DslCard): string {
  return renderToStaticMarkup(h(Card, { card, size: 'full' }));
}

describe('a rules line that carries a reminder', () => {
  /**
   * The precondition. If the row stopped earning a reminder this file would go
   * green while testing nothing, so what it is about is asserted first.
   */
  it('is a reminder block whose roman run is the whole rules row', () => {
    const card = guildmage();
    const line = renderOracleText(card).split('\n')[0];
    expect(line).toBe('{2}{G}{W}: Populate.');
    const blocks = remindedBlocks(card);
    const reminded = blocks.find((block) => block.kind === 'reminder');
    if (reminded === undefined) throw new Error('the populate row earned no reminder');
    expect(reminded.roman).toBe('{2}{G}{W}: Populate.');
  });

  it('paints the mana in it, rather than printing the braces', () => {
    const markup = face(guildmage());
    for (const token of ['{2}', '{G}', '{W}']) {
      expect(markup, `${token} is not painted`).toContain(`data-symbol="${token}"`);
    }
  });

  /**
   * The same card without the reminder, which is what already worked and is
   * here so the two are compared rather than asserted apart: the drawing of a
   * cost must not depend on whether the line it is on earns a gloss.
   */
  it('paints it the same way the same cost is painted with no reminder on it', () => {
    const plain: DslCard = {
      ...guildmage(),
      abilities: [
        {
          ...POPULATE,
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Centaur',
                power: 3,
                toughness: 3,
                colors: ['G'],
                subtypes: ['Centaur'],
                keywords: [],
              },
            },
          ],
        },
      ],
    };
    const painted = (markup: string): number => [...markup.matchAll(/data-symbol="\{[^"]+\}"/gu)].length;
    expect(painted(face(guildmage()))).toBe(painted(face(plain)));
  });
});
