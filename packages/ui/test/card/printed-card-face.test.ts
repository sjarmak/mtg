// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Card } from '../../src/card/Card';
import { PrintedCardFace } from '../../src/card/PrintedCardFace';
import { missingPrintedCardArt, printedCardArt } from '../../src/card/printed-card-art';
import type { PrintedCardPresentation } from '../../src/card/printed-card-art';

const example = EXAMPLE_CARDS[0];
if (example === undefined) throw new Error('the DSL example-card fixture is empty');

interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
}

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
    images: [{ face: null, uris: { normal: '/giver-card.jpg', art_crop: '/giver-art.jpg' } }],
  },
};

const elspeth: PrintedCardPresentation = {
  ...printing,
  physicalId: 'legacy-cube-2021-08:elspeth',
  position: 31,
  name: 'Elspeth, Knight-Errant',
  typeLine: 'Legendary Planeswalker — Elspeth',
  power: null,
  toughness: null,
  loyalty: '4',
  faces: [
    {
      name: 'Elspeth, Knight-Errant',
      manaCost: '{2}{W}{W}',
      typeLine: 'Legendary Planeswalker — Elspeth',
      oracleText:
        '+1: Create a 1/1 white Soldier creature token.\n' +
        '+1: Target creature gets +3/+3 and gains flying until end of turn.\n' +
        '−8: You get an emblem with "Artifacts, creatures, enchantments, and lands you control have indestructible."',
      power: null,
      toughness: null,
      loyalty: '4',
      colors: ['W'],
    },
  ],
};

const aftermath: PrintedCardPresentation = {
  ...printing,
  physicalId: 'hou-printed-v1:0152:appeal-authority',
  position: 152,
  name: 'Appeal // Authority',
  typeLine: 'Sorcery // Sorcery',
  power: null,
  toughness: null,
  colors: ['W', 'G'],
  faces: [
    {
      name: 'Appeal',
      manaCost: '{G}',
      typeLine: 'Sorcery',
      oracleText: 'Target creature gets +X/+X and gains trample until end of turn.',
      power: null,
      toughness: null,
      loyalty: null,
      colors: null,
    },
    {
      name: 'Authority',
      manaCost: '{1}{W}',
      typeLine: 'Sorcery',
      oracleText: 'Aftermath\nTap up to two target creatures your opponents control.',
      power: null,
      toughness: null,
      loyalty: null,
      colors: null,
    },
  ],
};

function landPrinting(name: string, oracleText: string): PrintedCardPresentation {
  return {
    ...printing,
    physicalId: `legacy-cube-2021-08:${name}`,
    name,
    typeLine: 'Land',
    power: null,
    toughness: null,
    colors: [],
    faces: [
      {
        name,
        manaCost: null,
        typeLine: 'Land',
        oracleText,
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
      },
    ],
  };
}

afterEach(cleanup);

describe('shared printed-card face', () => {
  it('frames each aftermath half by its visible color without changing whole-card colors', () => {
    const before = JSON.stringify(aftermath);
    const appeal = renderToStaticMarkup(
      createElement(PrintedCardFace, { card: aftermath, faceIndex: 0, size: 'full' }),
    );
    const authority = renderToStaticMarkup(
      createElement(PrintedCardFace, { card: aftermath, faceIndex: 1, size: 'full' }),
    );

    expect(appeal).toContain('data-identity="g"');
    expect(appeal).toContain('data-colors="g"');
    expect(authority).toContain('data-identity="w"');
    expect(authority).toContain('data-colors="w"');
    expect(JSON.stringify(aftermath)).toBe(before);
    expect(aftermath.colors).toEqual(['W', 'G']);
  });

  it('preserves optional inspection gestures and rejects an absent face', () => {
    const onMenu = vi.fn();
    const onHover = vi.fn();
    render(
      createElement(PrintedCardFace, {
        card: printing,
        physicalId: 'runtime-copy',
        faceIndex: 0,
        size: 'full',
        selected: true,
        autoFocus: false,
        deferArt: false,
        footnote: 'Runtime copy',
        onSelect: vi.fn(),
        onMenu,
        onHover,
      }),
    );
    const face = screen.getByRole('button');
    fireEvent.contextMenu(face);
    fireEvent.pointerEnter(face);
    fireEvent.pointerLeave(face);
    expect(onMenu).toHaveBeenCalledOnce();
    expect(onHover.mock.calls).toEqual([[true], [false]]);
    expect(() =>
      renderToStaticMarkup(
        createElement(PrintedCardFace, {
          card: printing,
          faceIndex: 1,
          size: 'full',
        }),
      ),
    ).toThrow('printed card Giver of Runes has no face');
  });

  it('renders distinct runtime copies without changing their shared catalog row or art', () => {
    const before = JSON.stringify(printing);
    for (const size of ['art', 'board', 'compact', 'full'] as const) {
      for (const physicalId of ['printed-copy:draft:0:1:card-id', 'printed-copy:draft:8:1:card-id']) {
        const html = renderToStaticMarkup(
          createElement(PrintedCardFace, { card: printing, physicalId, size }),
        );
        expect(html).toContain(`data-physical-id="${physicalId}"`);
        if (size !== 'compact') expect(html).toContain('src="/giver-art.jpg"');
        expect(html).toContain('data-position="1"');
      }
    }
    expect(JSON.stringify(printing)).toBe(before);
  });

  it('enlarges only mana-only land illustrations', () => {
    const simple = renderToStaticMarkup(
      createElement(PrintedCardFace, {
        card: landPrinting('Simple Land', '({T}: Add {G} or {W}.)'),
        size: 'full',
      }),
    );
    const wordy = renderToStaticMarkup(
      createElement(PrintedCardFace, {
        card: landPrinting(
          'Wordy Land',
          '{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Destroy target nonbasic land.',
        ),
        size: 'full',
      }),
    );

    expect(simple).toContain('data-large-art="true"');
    expect(wordy).toContain('data-large-art="false"');
    expect(simple).toContain('({T}: Add {G} or {W}.)');
    expect(wordy).toContain('Destroy target nonbasic land.');
  });

  it('keeps the shared frame when an official illustration is presented', () => {
    const printed = renderToStaticMarkup(
      createElement(Card, {
        card: example,
        art: {
          src: '/ajani.jpg',
          alt: 'Ajani Goldmane illustration, M11 #1',
          presentation: 'printed-card',
        },
      }),
    );
    const generated = renderToStaticMarkup(
      createElement(Card, {
        card: example,
        art: { src: '/illustration.jpg', alt: 'an illustration' },
      }),
    );

    expect(printed).toContain('data-presentation="printed-card"');
    expect(printed).toContain('src="/ajani.jpg"');
    expect(printed).toContain('data-region="title"');
    expect(printed).toContain('data-region="art"');
    expect(printed).toContain('data-region="type"');
    expect(printed).toContain('data-region="rules"');
    expect(printed).not.toContain('mtg-printed-card-image');
    expect(generated).toContain('data-region="rules"');
    expect(generated).not.toContain('data-presentation="printed-card"');
  });

  it('selects the official illustration crop instead of the scanned card frame', () => {
    const art = printedCardArt(printing, {
      oid: printing.physicalId,
      name: printing.name,
      typeLine: printing.typeLine,
      power: null,
      toughness: null,
    });
    expect(art.src).toBe('/giver-art.jpg');
    expect(art.src).not.toBe('/giver-card.jpg');
    expect(art).not.toHaveProperty('faces');
  });

  it('uses the shared planeswalker loyalty anatomy without a set-specific seal', () => {
    for (const size of ['full', 'compact', 'board'] as const) {
      const html = renderToStaticMarkup(createElement(PrintedCardFace, { card: elspeth, size }));
      expect(html).toContain('class="mtg-card__shield">4</span>');
      expect(html).not.toContain('class="mtg-card__seal"');
      if (size !== 'compact') {
        expect(html.match(/data-loyalty=/g)).toHaveLength(3);
        expect(html.match(/class="mtg-card__loyalty"/g)).toHaveLength(3);
        expect(html).toContain('data-loyalty="+1"');
        expect(html).toContain('data-loyalty="−8"');
      }
    }
  });

  it('keeps a refused illustration as a labeled pending window inside the shared frame', () => {
    const missing = renderToStaticMarkup(
      createElement(Card, {
        card: example,
        art: missingPrintedCardArt({
          oid: 'missing-object',
          name: 'Missing Card',
          typeLine: 'Artifact',
          power: null,
          toughness: null,
          tapped: false,
          attacking: false,
          damage: 0,
          controller: 0,
          counters: {},
        }),
      }),
    );

    expect(missing).toContain('data-region="art"');
    expect(missing).toContain('data-art-state="pending"');
    expect(missing).toContain('Art pending');
    expect(missing).not.toContain('<img');
    expect(missing).not.toContain('mtg-printed-card-image');
  });

  it('draws an unprinted token from the facts the engine states, with the picture still pending', () => {
    const html = renderToStaticMarkup(
      createElement(Card, {
        card: example,
        art: missingPrintedCardArt({
          oid: 'foreign:pegasus:1',
          name: 'Pegasus Token',
          typeLine: 'Token Creature — Pegasus',
          power: 1,
          toughness: 1,
          tapped: false,
          attacking: false,
          damage: 0,
          controller: 0,
          counters: {},
          characteristics: { colors: ['W'], manaCost: null, token: true },
        }),
      }),
    );
    expect(html).toContain('data-physical-id="observed:pegasus-token:token-creature-pegasus"');
    expect(html).toContain('Token Creature — Pegasus');
    expect(html).toContain('data-art-state="pending"');
    expect(html).not.toContain(example.name);
  });

  it('adapts exact printed facts and official art into the shared card frame and gestures', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const { container } = render(
      createElement(PrintedCardFace, {
        card: printing,
        size: 'full',
        onSelect,
        onActivate,
      }),
    );
    const face = screen.getByRole('button', {
      name: 'Giver of Runes. Mana cost {W}. Creature — Kor Cleric. 1/2.',
    });
    const faceElement = face as unknown as ElementLike;
    const containerElement = container as unknown as ElementLike;

    expect(containerElement.querySelector('.mtg-card[data-presentation="printed-card"]')).toBe(face);
    expect(faceElement.getAttribute('data-physical-id')).toBe(printing.physicalId);
    expect(faceElement.getAttribute('data-position')).toBe('1');
    expect(containerElement.querySelector('img')?.getAttribute('src')).toBe('/giver-art.jpg');
    expect(containerElement.querySelector('.mtg-printed-card-image')).toBeNull();
    expect(containerElement.querySelector('[data-region="title"]')).not.toBeNull();
    expect(containerElement.querySelector('[data-region="art"]')).not.toBeNull();
    expect(containerElement.querySelector('[data-region="type"]')).not.toBeNull();
    expect(containerElement.querySelector('[data-region="rules"]')).not.toBeNull();
    const text = (container as unknown as { readonly textContent: string | null }).textContent;
    expect(text).toContain('Giver of Runes');
    expect(text).toContain('Creature — Kor Cleric');
    expect(text).toContain('{T}: Another target creature you control gains protection.');
    expect(text).toContain('1/2');

    fireEvent.click(face, { detail: 1 });
    fireEvent.click(face, { detail: 2 });
    fireEvent.doubleClick(face);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
