// @vitest-environment node
/** Official illustration art and exact printed text stay inside the normal shared frame. */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ART_WINDOW, CARD_TRIM_MM } from '@mtg/card-geometry';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Card } from '../../src/card/Card';
import { PrintedCardFace } from '../../src/card/PrintedCardFace';
import type { PrintedCardPresentation } from '../../src/card/printed-card-art';
import { uiStyleSheet } from '../../src/styles/index';
import { RAIL_REM } from '../../src/styles/panel';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const example: DslCard = (() => {
  const card = EXAMPLE_CARDS[0];
  if (card === undefined) throw new Error('the DSL example-card fixture is empty');
  return card;
})();

const ART_CROP =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#18352c"/><text x="400" y="320" text-anchor="middle" font-size="44" fill="#fff">Official illustration</text></svg>',
  );

const printing: PrintedCardPresentation = {
  physicalId: 'legacy-cube-2021-08:0001:card-id',
  position: 1,
  name: 'Giver of Runes',
  oracleId: 'oracle-id',
  scryfallId: 'card-id',
  typeLine: 'Creature — Kor Cleric',
  power: '1',
  toughness: '2',
  loyalty: null,
  colors: ['W'],
  faces: [
    {
      name: 'Giver of Runes',
      manaCost: '{W}',
      typeLine: 'Creature — Kor Cleric',
      oracleText: '{T}: Another target creature you control gains protection.',
      power: '1',
      toughness: '2',
      loyalty: null,
      colors: ['W'],
    },
  ],
  art: {
    status: 'available',
    source: 'scryfall',
    scryfallId: 'card-id',
    images: [{ face: null, uris: { normal: '/whole-card-must-not-render.jpg', art_crop: ART_CROP } }],
  },
};

const CATALOG = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'data',
      'data',
      'legacy-cube-2021-card-catalog-v1.json',
    ),
    'utf8',
  ),
) as { readonly cards: readonly PrintedCardPresentation[] };

function catalogPrinting(name: string): PrintedCardPresentation {
  const card = CATALOG.cards.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the pinned Legacy Cube catalog has no ${name}`);
  return withInlineArt(card);
}

function withInlineArt(card: PrintedCardPresentation): PrintedCardPresentation {
  return {
    ...card,
    art:
      card.art.status === 'missing'
        ? card.art
        : {
            ...card.art,
            images: card.art.images.map((image) => ({
              ...image,
              uris: { art_crop: ART_CROP },
            })),
          },
  };
}

const LONG_PRINTINGS = [
  catalogPrinting('Wurmcoil Engine'),
  catalogPrinting('Emrakul, the Promised End'),
  catalogPrinting('Emrakul, the Aeons Torn'),
] as const;
const ELSPETH = catalogPrinting('Elspeth, Knight-Errant');
const VIVIEN = catalogPrinting("Vivien, Monsters' Advocate");
const TAIGA = catalogPrinting('Taiga');
const WOODED_FOOTHILLS = catalogPrinting('Wooded Foothills');
const RIFT_SOWER = catalogPrinting('Rift Sower');
const VENERATED_LOXODON = catalogPrinting('Venerated Loxodon');

function page(): string {
  const printed = [printing, ...LONG_PRINTINGS, ELSPETH, TAIGA, WOODED_FOOTHILLS]
    .map((card) => renderToStaticMarkup(h(PrintedCardFace, { card, size: 'full' })))
    .join('');
  const generated = renderToStaticMarkup(h(Card, { card: example, art: null }));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:flex;flex-wrap:wrap;gap:24px;padding:24px}.fixture>.mtg-card{width:214px}</style></head><body><main class="fixture">${printed}${generated}</main></body></html>`;
}

function draftArtPage(): string {
  const printed = [
    printing,
    LONG_PRINTINGS[0],
    ELSPETH,
    VIVIEN,
    TAIGA,
    WOODED_FOOTHILLS,
    RIFT_SOWER,
    VENERATED_LOXODON,
  ]
    .map((card) => renderToStaticMarkup(h(PrintedCardFace, { card, size: 'full' })))
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.mtg-draft{padding:24px}.fixture{display:grid;grid-template-columns:repeat(4,244px);gap:24px}.fixture>.mtg-card{width:244px;aspect-ratio:63/88}</style></head><body><main class="mtg-draft"><div class="mtg-work__scroll"><div class="fixture mtg-thumbs">${printed}</div></div></main></body></html>`;
}

function completeCatalogPage(width = 214): string {
  const printed = CATALOG.cards
    .map((card) =>
      renderToStaticMarkup(h(PrintedCardFace, { card: withInlineArt(card), size: 'full', deferArt: true })),
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:grid;grid-template-columns:repeat(8,${String(width)}px);gap:12px;padding:12px}.fixture>.mtg-card{width:${String(width)}px}</style></head><body><main class="mtg-draft"><div class="mtg-work__scroll"><div class="fixture mtg-thumbs" style="--thumb-w:214px;--thumb-max:244px">${printed}</div></div></main></body></html>`;
}

const LIMITED_CARDS = ['akh', 'hou', 'mp2'].flatMap(
  (code) =>
    (
      JSON.parse(
        readFileSync(
          new URL(`../../../data/data/akh-hou/${code}-printed-catalog-v1.json`, import.meta.url),
          'utf8',
        ),
      ) as {
        readonly cards: readonly PrintedCardPresentation[];
      }
    ).cards,
);

function completeCatalogBuilderPage(surface: 'deckbuilder' | 'gallery' | 'draft'): string {
  const printed = [...CATALOG.cards, ...LIMITED_CARDS]
    .map((card) =>
      renderToStaticMarkup(h(PrintedCardFace, { card: withInlineArt(card), size: 'full', deferArt: true })),
    )
    .map((face) => (surface === 'gallery' ? `<div>${face}</div>` : face))
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:grid;grid-template-columns:repeat(8,288px);gap:12px;padding:12px}${surface === 'gallery' ? '' : '.fixture>.mtg-card{width:288px}'}</style></head><body><main class="${surface === 'draft' ? 'mtg-draft' : surface === 'deckbuilder' ? 'mtg-builder-screen' : 'mtg-gallery'}"><div class="${surface === 'draft' ? 'mtg-work__scroll' : 'mtg-deck__pane-scroll'}"><div class="fixture ${surface === 'draft' ? 'mtg-thumbs' : ''}">${printed}</div></div></main></body></html>`;
}

function completeCatalogZoomPage(): string {
  const printed = CATALOG.cards
    .map(
      (card) =>
        `<div class="mtg-zoom">${renderToStaticMarkup(
          h(PrintedCardFace, { card: withInlineArt(card), size: 'full', deferArt: true }),
        )}</div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:grid;grid-template-columns:repeat(5,320px);gap:12px;padding:12px}.fixture>.mtg-zoom{display:block!important;position:static!important}</style></head><body><main class="fixture">${printed}</main></body></html>`;
}

function completeCatalogBuilderPreviewPage(): string {
  const printed = CATALOG.cards
    .filter((card) => card.loyalty !== null)
    .map(
      (card) =>
        `<div class="mtg-cardpeek">${renderToStaticMarkup(
          h(PrintedCardFace, { card: withInlineArt(card), size: 'full', deferArt: true }),
        )}</div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:grid;grid-template-columns:repeat(6,244px);gap:12px;padding:12px}.fixture>.mtg-cardpeek{display:block!important;position:static!important;filter:none}</style></head><body><main class="fixture">${printed}</main></body></html>`;
}

/** The rail's reading face: the draft rail's chosen card and the play rail's
 * Info tab. Drawn inside the rail's own body at the rail's width, so the
 * measurement is the one a player gets. */
function completeCatalogRailPage(railRem: number): string {
  const printed = [...CATALOG.cards, ...LIMITED_CARDS]
    .map(
      (card) =>
        `<div class="mtg-rail"><div class="mtg-rail__body">${renderToStaticMarkup(
          h(PrintedCardFace, { card: withInlineArt(card), size: 'full', deferArt: true }),
        )}</div></div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${uiStyleSheet()}html,body{margin:0}.fixture{display:grid;grid-template-columns:repeat(${String(Math.floor(2200 / (railRem * 16 + 12)))},${String(railRem)}rem);gap:12px;padding:12px}.fixture>.mtg-rail{display:block;position:static}</style></head><body><main class="fixture">${printed}</main></body></html>`;
}

interface FaceReading {
  readonly cardWidth: number;
  readonly ratio: number;
  readonly artHeight: number;
  readonly rulesHeight: number;
  readonly rulesFont: number;
  readonly rulesPaddingTop: number;
  readonly rulesPaddingBottom: number;
  readonly rulesBlankTop: number;
  readonly rulesBlankBottom: number;
  readonly size: string | null;
  readonly regions: number;
  readonly wholeCardImage: boolean;
  readonly artInside: boolean;
  readonly textInside: boolean;
  readonly text: string;
  readonly fit: number;
  readonly rulesOverflow: number;
  readonly loyaltyRows: number;
  readonly loyaltyCosts: readonly string[];
  readonly shield: string | null;
  readonly shieldWidth: number;
  readonly shieldHeight: number;
  readonly shieldInkWidth: number;
  readonly shieldInkInside: boolean;
  readonly seal: boolean;
}

const MEASURE = `(() => [...document.querySelectorAll('.fixture .mtg-card')].map((card) => {
  const box = card.getBoundingClientRect();
  const art = card.querySelector('[data-region="art"]');
  const artBox = art?.getBoundingClientRect();
  const rules = card.querySelector('[data-region="rules"]');
  const lines = rules === null ? [] : [...rules.querySelectorAll(':scope > .mtg-card__line')];
  const firstLine = lines[0]?.getBoundingClientRect();
  const lastLine = lines.at(-1)?.getBoundingClientRect();
  const rulesStyle = rules === null ? null : getComputedStyle(rules);
  const rulesBox = rules?.getBoundingClientRect();
  const textNodes = [...card.querySelectorAll('[data-region="title"], [data-region="type"], [data-region="rules"], .mtg-card__pt')];
  const shield = card.querySelector('.mtg-card__shield');
  const shieldBox = shield?.getBoundingClientRect();
  const shieldRange = shield === null ? null : document.createRange();
  shieldRange?.selectNodeContents(shield);
  const shieldInkBox = shieldRange?.getBoundingClientRect();
  return {
    cardWidth: box.width,
    ratio: box.height / box.width,
    artHeight: artBox?.height ?? -1,
    rulesHeight: rules?.getBoundingClientRect().height ?? -1,
    rulesFont: rulesStyle === null ? -1 : parseFloat(rulesStyle.fontSize),
    rulesPaddingTop: rulesStyle === null ? -1 : parseFloat(rulesStyle.paddingTop),
    rulesPaddingBottom: rulesStyle === null ? -1 : parseFloat(rulesStyle.paddingBottom),
    rulesBlankTop: rulesBox === undefined || firstLine === undefined ? -1 : firstLine.top - rulesBox.top,
    rulesBlankBottom: rulesBox === undefined || lastLine === undefined ? -1 : rulesBox.bottom - lastLine.bottom,
    size: card.getAttribute('data-size'),
    regions: card.querySelectorAll('[data-region="title"], [data-region="art"], [data-region="type"], [data-region="rules"]').length,
    wholeCardImage: card.querySelector('.mtg-printed-card-image') !== null || card.querySelector('img[src*="whole-card"]') !== null,
    artInside: artBox !== undefined && artBox.top >= box.top - 0.5 && artBox.left >= box.left - 0.5 && artBox.right <= box.right + 0.5 && artBox.bottom <= box.bottom + 0.5,
    textInside: textNodes.every((node) => { const nodeBox = node.getBoundingClientRect(); return nodeBox.left >= box.left - 0.5 && nodeBox.right <= box.right + 0.5 && nodeBox.top >= box.top - 0.5 && nodeBox.bottom <= box.bottom + 0.5; }),
    text: card.textContent ?? '',
    fit: Number(rules?.getAttribute('data-fit') ?? '-1'),
    rulesOverflow: rules === null ? -1 : Math.max(0, rules.scrollHeight - rules.clientHeight),
    loyaltyRows: card.querySelectorAll('[data-loyalty]').length,
    loyaltyCosts: [...card.querySelectorAll('[data-loyalty]')].map((row) => row.getAttribute('data-loyalty') ?? ''),
    shield: shield?.textContent ?? null,
    shieldWidth: shieldBox?.width ?? -1,
    shieldHeight: shieldBox?.height ?? -1,
    shieldInkWidth: shieldInkBox?.width ?? -1,
    shieldInkInside: shieldBox !== undefined && shieldInkBox !== undefined &&
      shieldInkBox.left >= shieldBox.left - 0.5 && shieldInkBox.right <= shieldBox.right + 0.5 &&
      shieldInkBox.top >= shieldBox.top - 0.5 && shieldInkBox.bottom <= shieldBox.bottom + 0.5,
    seal: card.querySelector('.mtg-card__seal') !== null,
  };
}))()`;

function completeCatalogMeasure(selector: string, standardArt = false): string {
  return `(() => {
  const cards = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const failures = [];
  const physicalIds = new Set();
  let smallestRulesText = { id: 'none', px: Number.POSITIVE_INFINITY };
  for (const card of cards) {
    const id = card.getAttribute('data-physical-id') ?? 'missing physical id';
    physicalIds.add(id);
    const box = card.getBoundingClientRect();
    const art = card.querySelector('[data-region="art"]').getBoundingClientRect();
    if (${String(standardArt)} && card.dataset.largeArt !== 'true' &&
        Math.abs(art.height - art.width * ${String(ART_WINDOW.height / ART_WINDOW.width)}) > 0.5) {
      failures.push(id + ': art window differs from standard card proportions');
    }
    const regions = card.querySelectorAll('[data-region="title"], [data-region="art"], [data-region="type"], [data-region="rules"]');
    const rules = card.querySelector('[data-region="rules"]');
    if (${String(standardArt)}) {
      for (const bar of card.querySelectorAll(':scope > .mtg-card__bar')) {
        const style = getComputedStyle(bar);
        if (parseFloat(style.paddingTop) < 2 || parseFloat(style.paddingBottom) < 2 ||
            parseFloat(style.paddingLeft) < 6 || parseFloat(style.paddingRight) < 6) {
          failures.push(id + ': title/type bar lacks breathing room');
        }
      }
    }
    const rulesPx = rules === null ? 0 : parseFloat(getComputedStyle(rules).fontSize);
    if (rulesPx < smallestRulesText.px) smallestRulesText = { id, px: rulesPx };
    const shield = card.querySelector('.mtg-card__shield');
    const textNodes = [...card.querySelectorAll('[data-region="title"], [data-region="type"], [data-region="rules"], .mtg-card__pt, .mtg-card__shield')];
    const outsideText = textNodes.filter((node) => {
      const nodeBox = node.getBoundingClientRect();
      return nodeBox.left < box.left - 0.5 || nodeBox.right > box.right + 0.5 || nodeBox.top < box.top - 0.5 || nodeBox.bottom > box.bottom + 0.5;
    });
    if (regions.length !== 4) failures.push(id + ': missing shared frame region');
    if (card.querySelector('.mtg-printed-card-image') !== null) failures.push(id + ': whole-card image');
    if ((rules?.scrollHeight ?? 0) > (rules?.clientHeight ?? 0)) failures.push(
      id + ': rules overflow ' + String((rules?.scrollHeight ?? 0) - (rules?.clientHeight ?? 0)) +
      'px at fit ' + String(rules?.getAttribute('data-fit') ?? '?') +
      ' (' + String(rules?.clientHeight ?? 0) + '/' + String(rules?.scrollHeight ?? 0) +
      ', ' + (rules === null ? '?' : getComputedStyle(rules).fontSize) + ')'
    );
    if (outsideText.length > 0) failures.push(
      id + ': text outside card (' + outsideText.map((node) => {
        const nodeBox = node.getBoundingClientRect();
        return (node.getAttribute('data-region') ?? node.className ?? node.tagName) +
          ' [' + [nodeBox.left - box.left, nodeBox.top - box.top, nodeBox.right - box.right, nodeBox.bottom - box.bottom].map((value) => Math.round(value * 10) / 10).join(',') + ']';
      }).join('; ') + ')'
    );
    if (shield !== null) {
      const shieldBox = shield.getBoundingClientRect();
      const shieldRange = document.createRange();
      shieldRange.selectNodeContents(shield);
      const shieldInkBox = shieldRange.getBoundingClientRect();
      if (shieldBox.width < box.width * 0.08 || shieldBox.height < box.width * 0.09) failures.push(
        id + ': collapsed loyalty shield ' + String(Math.round(shieldBox.width * 10) / 10) +
        'x' + String(Math.round(shieldBox.height * 10) / 10) + 'px on ' +
        String(Math.round(box.width * 10) / 10) + 'px card'
      );
      if (shieldInkBox.width < 2 || shieldInkBox.left < shieldBox.left - 0.5 || shieldInkBox.right > shieldBox.right + 0.5 || shieldInkBox.top < shieldBox.top - 0.5 || shieldInkBox.bottom > shieldBox.bottom + 0.5) failures.push(
        id + ': starting-loyalty numeral is not visible inside its shield'
      );
      const textWalker = document.createTreeWalker(rules, NodeFilter.SHOW_TEXT);
      let textNode = textWalker.nextNode();
      while (textNode !== null) {
        if ((textNode.textContent ?? '').trim().length > 0 && textNode.parentElement?.closest('.mtg-card__loyalty') === null) {
          const textRange = document.createRange();
          textRange.selectNodeContents(textNode);
          const shieldHitsText = [...textRange.getClientRects()].some((inkBox) =>
            inkBox.left < shieldBox.right && inkBox.right > shieldBox.left &&
            inkBox.top < shieldBox.bottom && inkBox.bottom > shieldBox.top
          );
          if (shieldHitsText) {
            failures.push(id + ': starting-loyalty shield overlaps rules text');
            break;
          }
        }
        textNode = textWalker.nextNode();
      }
    }
    for (const loyalty of card.querySelectorAll('.mtg-card__loyalty')) {
      const loyaltyBox = loyalty.getBoundingClientRect();
      const loyaltyRange = document.createRange();
      loyaltyRange.selectNodeContents(loyalty);
      const loyaltyInkBox = loyaltyRange.getBoundingClientRect();
      if (loyaltyBox.width < box.width * 0.08 || loyaltyInkBox.width < 2 ||
          loyaltyInkBox.left < loyaltyBox.left - 0.5 || loyaltyInkBox.right > loyaltyBox.right + 0.5 ||
          loyaltyInkBox.top < loyaltyBox.top - 0.5 || loyaltyInkBox.bottom > loyaltyBox.bottom + 0.5) failures.push(
        id + ': loyalty-cost numeral is not visible inside its badge'
      );
    }
  }
  return { cards: cards.length, physicalIds: physicalIds.size, failures, smallestRulesText };
})()`;
}

describe('official-card shared-frame geometry', () => {
  browserIt(
    'uses the same regions as generated cards and cannot paint beyond the card border',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-printed-card-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-printed-card-chrome-'));
      const file = join(directory, 'printed-card.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const [printed, wurmcoil, promisedEnd, aeonsTorn, elspeth, taiga, woodedFoothills, generated] =
          (await measurePage(
            chrome.client,
            file,
            900,
            700,
            MEASURE,
            'printed and generated card faces',
            '.fixture',
          )) as unknown as readonly [
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
          ];
        const trim = CARD_TRIM_MM.height / CARD_TRIM_MM.width;
        expect(Math.abs(printed.ratio - trim)).toBeLessThan(0.01);
        expect(printed.regions).toBe(4);
        expect(printed.wholeCardImage).toBe(false);
        expect(printed.artInside).toBe(true);
        expect(printed.textInside).toBe(true);
        expect(printed.text).toContain('Another target creature you control gains protection.');
        expect(generated.regions).toBe(4);
        for (const [name, reading] of [
          ['Wurmcoil Engine', wurmcoil],
          ['Emrakul, the Promised End', promisedEnd],
          ['Emrakul, the Aeons Torn', aeonsTorn],
        ] as const) {
          expect(
            reading.rulesOverflow,
            `${name} rules text leaves its box at fit ${String(reading.fit)}`,
          ).toBe(0);
          expect(reading.textInside, `${name} keeps all printed regions inside the card`).toBe(true);
        }
        expect(
          Math.max(wurmcoil.fit, promisedEnd.fit, aeonsTorn.fit),
          'at least one long official face uses the printed-text rungs below the ordinary card floor',
        ).toBeGreaterThan(3);
        expect(elspeth.loyaltyRows).toBe(3);
        expect(elspeth.loyaltyCosts).toEqual(['+1', '+1', '−8']);
        expect(elspeth.shield).toBe('4');
        expect(elspeth.shieldWidth).toBeGreaterThanOrEqual(elspeth.cardWidth * 0.08);
        expect(elspeth.shieldHeight).toBeGreaterThanOrEqual(elspeth.cardWidth * 0.09);
        expect(elspeth.shieldInkWidth).toBeGreaterThanOrEqual(2);
        expect(elspeth.shieldInkInside).toBe(true);
        expect(elspeth.seal).toBe(false);
        expect(elspeth.rulesOverflow, `Elspeth rules text leaves its box at fit ${String(elspeth.fit)}`).toBe(
          0,
        );
        expect(elspeth.textInside).toBe(true);
        for (const [name, reading] of [
          ['Wurmcoil Engine', wurmcoil],
          ['Emrakul, the Promised End', promisedEnd],
          ['Emrakul, the Aeons Torn', aeonsTorn],
          ['Elspeth, Knight-Errant', elspeth],
        ] as const) {
          expect(
            Math.abs(reading.artHeight - printed.artHeight),
            `${name} uses the same illustration height as every nonland`,
          ).toBeLessThanOrEqual(0.5);
        }
        expect(taiga.artHeight, 'a mana-only land receives the taller illustration').toBeGreaterThan(
          printed.artHeight * 1.15,
        );
        expect(
          Math.abs(woodedFoothills.artHeight - printed.artHeight),
          'a rules-heavy land keeps the ordinary illustration height',
        ).toBeLessThanOrEqual(0.5);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  browserIt(
    'keeps draft illustration windows uniform except for the deliberate land enlargement',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-art-window-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-art-window-chrome-'));
      const file = join(directory, 'draft-art-window.html');
      await writeFile(file, draftArtPage(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const [ordinary, creature, planeswalker, vivien, simpleLand, wordyLand, riftSower, veneratedLoxodon] =
          (await measurePage(
            chrome.client,
            file,
            1440,
            900,
            MEASURE,
            'draft illustration-window comparison',
            '.fixture',
          )) as unknown as readonly [
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
            FaceReading,
          ];
        expect([ordinary.size, creature.size, planeswalker.size, simpleLand.size, wordyLand.size]).toEqual([
          'full',
          'full',
          'full',
          'full',
          'full',
        ]);
        expect(Math.abs(creature.artHeight - ordinary.artHeight)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(planeswalker.artHeight - ordinary.artHeight)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(vivien.artHeight - ordinary.artHeight)).toBeLessThanOrEqual(0.5);
        expect(simpleLand.artHeight).toBeGreaterThan(ordinary.artHeight * 1.15);
        expect(Math.abs(wordyLand.artHeight - ordinary.artHeight)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(creature.rulesHeight - ordinary.rulesHeight)).toBeLessThanOrEqual(0.5);
        expect(riftSower.rulesOverflow).toBe(0);
        expect(veneratedLoxodon.rulesOverflow).toBe(0);
        expect(riftSower.rulesFont).toBeGreaterThanOrEqual(8.5);
        expect(veneratedLoxodon.rulesFont).toBeGreaterThanOrEqual(9.5);
        expect(riftSower.rulesBlankTop).toBeLessThanOrEqual(10);
        expect(riftSower.rulesBlankBottom).toBeLessThanOrEqual(10);
        expect(veneratedLoxodon.rulesBlankTop).toBeLessThanOrEqual(11);
        expect(veneratedLoxodon.rulesBlankBottom).toBeLessThanOrEqual(11);
        expect(vivien.rulesOverflow).toBe(0);
        expect(vivien.textInside).toBe(true);
        expect(vivien.shieldWidth).toBeGreaterThanOrEqual(vivien.cardWidth * 0.08);
        expect(vivien.shieldHeight).toBeGreaterThanOrEqual(vivien.cardWidth * 0.09);
        expect(vivien.shieldInkWidth).toBeGreaterThanOrEqual(2);
        expect(vivien.shieldInkInside).toBe(true);
        expect(
          vivien.rulesFont,
          "Vivien's 244px draft face uses comfortably readable loyalty text",
        ).toBeGreaterThanOrEqual(10);
        expect(
          vivien.rulesBlankTop,
          "Vivien's loyalty rows use the top of the rules box",
        ).toBeLessThanOrEqual(8);
        expect(
          vivien.rulesBlankBottom,
          "Vivien's loyalty rows use the bottom of the rules box",
        ).toBeLessThanOrEqual(8);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  browserIt(
    'keeps every one of the 600 official positions inside the shared draft frame at both desktop widths',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-complete-cube-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-complete-cube-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        for (const width of [214, 244] as const) {
          const file = join(directory, `complete-cube-${String(width)}.html`);
          await writeFile(file, completeCatalogPage(width), 'utf8');
          const reading = (await measurePage(
            chrome.client,
            file,
            2200,
            1080,
            completeCatalogMeasure('.fixture > .mtg-card'),
            `complete Legacy Cube ${String(width)}px card census`,
            '.fixture',
          )) as unknown as {
            readonly cards: number;
            readonly physicalIds: number;
            readonly failures: readonly string[];
          };
          expect(reading.cards).toBe(600);
          expect(reading.physicalIds).toBe(600);
          expect(reading.failures, `${String(width)}px draft cards`).toEqual([]);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  for (const surface of ['deckbuilder', 'gallery', 'draft'] as const)
    browserIt(
      `keeps every official position readable inside the shared ${surface} frame`,
      async () => {
        expect(LIMITED_CARDS).toHaveLength(550);
        const directory = await mkdtemp(join(tmpdir(), 'mtg-complete-builder-cube-'));
        const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-complete-builder-cube-chrome-'));
        const file = join(directory, 'complete-builder-cube.html');
        await writeFile(file, completeCatalogBuilderPage(surface), 'utf8');
        const chrome = await launchChrome(userDataDir);
        try {
          const reading = (await measurePage(
            chrome.client,
            file,
            2200,
            1080,
            completeCatalogMeasure('.fixture .mtg-card', true),
            'complete Cube and AKH/HOU deckbuilder-card census',
            '.fixture',
          )) as unknown as {
            readonly cards: number;
            readonly physicalIds: number;
            readonly failures: readonly string[];
            readonly smallestRulesText: { readonly id: string; readonly px: number };
          };
          expect(reading.cards).toBe(600 + LIMITED_CARDS.length);
          expect(reading.physicalIds).toBe(600 + LIMITED_CARDS.length);
          expect(reading.failures).toEqual([]);
          expect(
            reading.smallestRulesText.px,
            `${reading.smallestRulesText.id} is unreadably small in the deckbuilder`,
          ).toBeGreaterThanOrEqual(11);
        } finally {
          await shutdownChrome(chrome);
          await rm(directory, { recursive: true, force: true });
          await rm(userDataDir, { recursive: true, force: true });
        }
      },
      120_000,
    );

  browserIt(
    'keeps every one of the 600 official positions inside its enlarged reading panel',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-complete-cube-zoom-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-complete-cube-zoom-chrome-'));
      const file = join(directory, 'complete-cube-zoom.html');
      await writeFile(file, completeCatalogZoomPage(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const reading = (await measurePage(
          chrome.client,
          file,
          1920,
          1080,
          completeCatalogMeasure('.fixture > .mtg-zoom > .mtg-card'),
          'complete Legacy Cube enlarged-card census',
          '.fixture',
        )) as unknown as {
          readonly cards: number;
          readonly physicalIds: number;
          readonly failures: readonly string[];
          readonly smallestRulesText: { readonly id: string; readonly px: number };
        };
        expect(reading.cards).toBe(600);
        expect(reading.physicalIds).toBe(600);
        expect(reading.failures).toEqual([]);
        expect(
          reading.smallestRulesText.px,
          `${reading.smallestRulesText.id} is still thumbnail-sized in the enlarged reading panel`,
        ).toBeGreaterThanOrEqual(12);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  browserIt(
    'keeps every official position inside the rail reading face',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-rail-reading-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-rail-reading-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        // The rail is RAIL_REM wide by default and the play board's split
        // handle can double it; the type is set in container units, so the
        // census runs at both ends of that range.
        for (const railRem of [RAIL_REM, RAIL_REM * 2]) {
          const file = join(directory, `rail-reading-${String(railRem)}.html`);
          await writeFile(file, completeCatalogRailPage(railRem), 'utf8');
          const reading = (await measurePage(
            chrome.client,
            file,
            2200,
            1080,
            completeCatalogMeasure('.fixture > .mtg-rail > .mtg-rail__body > .mtg-card'),
            `complete Cube and AKH/HOU rail reading-face census at ${String(railRem)}rem`,
            '.fixture',
          )) as unknown as {
            readonly cards: number;
            readonly physicalIds: number;
            readonly failures: readonly string[];
            readonly smallestRulesText: { readonly id: string; readonly px: number };
          };
          expect(reading.cards).toBe(600 + LIMITED_CARDS.length);
          expect(reading.physicalIds).toBe(600 + LIMITED_CARDS.length);
          expect(reading.failures, `at ${String(railRem)}rem`).toEqual([]);
          expect(
            reading.smallestRulesText.px,
            `${reading.smallestRulesText.id} is unreadably small in the ${String(railRem)}rem rail`,
          ).toBeGreaterThanOrEqual(railRem >= RAIL_REM * 2 ? 16 : 8);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  browserIt(
    'keeps every official planeswalker inside the deckbuilder hover preview at its readable rung',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-planeswalker-preview-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-planeswalker-preview-chrome-'));
      const file = join(directory, 'planeswalker-preview.html');
      await writeFile(file, completeCatalogBuilderPreviewPage(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const reading = (await measurePage(
          chrome.client,
          file,
          1920,
          1080,
          completeCatalogMeasure('.fixture > .mtg-cardpeek > .mtg-card'),
          'Legacy Cube planeswalker builder previews',
          '.fixture',
        )) as unknown as {
          readonly cards: number;
          readonly physicalIds: number;
          readonly failures: readonly string[];
          readonly smallestRulesText: { readonly id: string; readonly px: number };
        };
        expect(reading.cards).toBeGreaterThan(20);
        expect(reading.physicalIds).toBe(reading.cards);
        expect(reading.failures).toEqual([]);
        expect(
          reading.smallestRulesText.px,
          `${reading.smallestRulesText.id} is still thumbnail-sized in the deckbuilder preview`,
        ).toBeGreaterThanOrEqual(12);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
