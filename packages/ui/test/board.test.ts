// @vitest-environment jsdom
/**
 * Board and zone primitives: props in, markup out, no state of their own.
 *
 * Several tests here measure rather than read: the compact width, a slot's
 * footprint tapped and untapped, how a board face divides its height, and
 * whether the hand rail wraps all reach an element through the cascade, so the
 * rendered element is the only honest place to check them. The window is reached
 * through a narrow structural interface for the same reason `src/mount.ts` uses
 * one: the workspace tsconfig has no `lib: dom`.
 *
 * jsdom performs no layout, and several properties this surface now depends on
 * are outside what its cascade carries at all — it evaluates no container query
 * and no `scale`. Where that bites, the test says so and checks the emitted rule
 * instead of pretending to have measured an effect. The browser numbers are in
 * the commit message.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card as DslCard } from '@mtg/dsl';
import { EXAMPLE_CARDS, BASIC_LANDS, parseCard } from '@mtg/dsl';
import { Battlefield, permanentMarks } from '../src/board/Battlefield';
import type { BoardPermanent } from '../src/board/Battlefield';
import { Board } from '../src/board/Board';
import { CardSlot } from '../src/board/CardSlot';
import { Graveyard } from '../src/board/Graveyard';
import { Hand } from '../src/board/Hand';
import { PlayerStatus } from '../src/board/PlayerStatus';
import { StackZone } from '../src/board/StackZone';
import { Zone } from '../src/board/Zone';
import { Card } from '../src/card/Card';
import { BOARD_REGIONS, CARD_TRIM_MM, COMPACT_FACE_WIDTH_REM, PIP_GLYPHS } from '../src/card/anatomy';
import { cssNumber } from '../src/styles/number';
import { GlobalStyles, uiStyleSheet } from '../src/styles/index';

afterEach(cleanup);

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly closest: (selector: string) => ElementLike | null;
  readonly contains: (other: ElementLike | null) => boolean;
  readonly getAttribute: (name: string) => string | null;
}

/**
 * Narrows what testing-library hands back to the shape these tests use. The
 * workspace tsconfig has no `lib: dom`, so `HTMLElement` here carries none of
 * these members and the check has to happen at runtime, as `src/mount.ts` does
 * for the real window.
 */
function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.closest !== 'function' ||
    typeof candidate.contains !== 'function' ||
    typeof candidate.getAttribute !== 'function'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

interface WindowLike {
  readonly document: { readonly body: ElementLike };
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/** The computed style of the one element matching `selector`, under the mounted sheet. */
function styleOf(selector: string): StyleLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  const element = document.body.querySelector(selector);
  if (element === null) throw new Error(`nothing rendered matched ${selector}`);
  return candidate.getComputedStyle(element);
}

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

function land(): DslCard {
  const card = BASIC_LANDS[0];
  if (card === undefined) throw new Error('the DSL example set has no basic lands');
  return card;
}

function aura(): DslCard {
  return parseCard({
    kind: 'enchantment',
    id: 'm11-pacifism',
    name: 'Pacifism',
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 24 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Aura'],
    aura: {
      enchant: 'creature',
      modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }],
    },
  });
}

describe('Zone', () => {
  it('says it is empty rather than rendering a bare label', () => {
    render(h(Zone, { label: 'Exile', items: [] }));
    expect(screen.getByText('Exile')).toBeTruthy();
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('shows an explicit count when given one', () => {
    render(h(Zone, { label: 'Library', items: [], count: 37, emptyText: 'face down' }));
    expect(screen.getByText('37')).toBeTruthy();
    expect(screen.getByText('face down')).toBeTruthy();
  });
});

describe('Battlefield', () => {
  const permanent: BoardPermanent = {
    key: 'o1',
    card: creature(),
    tapped: true,
    summoningSick: true,
    damage: 2,
    counters: 1,
    attacking: true,
  };

  it('derives marks from flags in a fixed order', () => {
    // By key, because two of the four are drawn as something other than their
    // own text now: the sick mark is an hourglass whose label is the sentence
    // behind it. `board-marks.test.ts` holds each one against what it says.
    expect(permanentMarks(permanent).map((mark) => mark.key)).toEqual([
      'attacking',
      'sick',
      'counters',
      'damage',
    ]);
    expect(permanentMarks({ key: 'o2', card: creature() })).toEqual([]);
  });

  it('marks the tapped state on the slot, not the card', () => {
    const markup = renderToStaticMarkup(h(Battlefield, { label: 'Battlefield', permanents: [permanent] }));
    expect(markup).toContain('data-tapped="true"');
    expect(markup).toContain('data-permanent-key="o1"');
  });

  it('reports the permanent that was selected', () => {
    const picked: string[] = [];
    render(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [{ key: 'o1', card: creature() }],
        onSelect: (chosen: BoardPermanent) => {
          picked.push(chosen.key);
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(creature().name) }));
    expect(picked).toEqual(['o1']);
  });

  it('says when nothing is in play', () => {
    render(h(Battlefield, { label: 'Battlefield', permanents: [] }));
    expect(screen.getByText('no permanents')).toBeTruthy();
  });

  it('makes a tapped slot square, so the room a rotation needs comes out of the row', () => {
    // The reversal `mtg-yi5` is, measured off both rendered slots rather than
    // read off the rule, because what decides it is the whole cascade.
    //
    // The footprint used to hold still through a tap and the *face* paid for the
    // rotation, scaled by 63/88 to fit the width it already had. In a browser
    // that came out at a 128x92 card with an 11px-wide name box, on the creature
    // a player most needs to read, because attacking taps. The slot reserves the
    // rotated width again — but only while the permanent is turned, so an
    // untapped row is still card-shaped and the reserve is paid once per tapped
    // permanent rather than on all of them at all times.
    render(
      h(
        'div',
        null,
        h(GlobalStyles),
        h(Battlefield, {
          label: 'Battlefield',
          permanents: [
            { key: 'p1', card: creature(), tapped: false },
            { key: 'p2', card: creature(), tapped: true },
          ],
        }),
      ),
    );
    const upright = styleOf(".mtg-slot[data-tapped='false']");
    const tapped = styleOf(".mtg-slot[data-tapped='true']");
    // Card-shaped upright: 9.5rem by 9.5 x 88 / 63 rem.
    expect(upright.getPropertyValue('width')).toBe('152px');
    expect(upright.getPropertyValue('height')).toBe('212.317px');
    // Square while turned, and the same height, so only the row's width moves.
    expect(tapped.getPropertyValue('height')).toBe(upright.getPropertyValue('height'));
    expect(tapped.getPropertyValue('width')).toBe(upright.getPropertyValue('height'));
    expect(tapped.getPropertyValue('aspect-ratio')).toBe('1 / 1');
  });

  it('draws a tapped face at its full size, turned rather than shrunk', () => {
    // Asserted against the emitted rule rather than a computed style: jsdom's
    // cascade does not carry `rotate` or `scale`, so the only honest place to
    // check them is the sheet, and `tools/board-legibility.ts` is where the
    // boxes it produces are measured. What this guards is that the face fills
    // the square slot it was given — 63/88 of the slot's width, which after the
    // quarter turn is the slot's width exactly, so its layout box is the box it
    // had upright — and that no scale shrinks it on the way.
    //
    // It used to be sized off the slot's *height*, and `mtg-bm1` is what that
    // cost once a row shrank: `test/play/tapped-slot.test.ts` holds the whole
    // cascade for a played row and `tools/tap-rotation.ts` measures the boxes.
    //
    // The second term is `mtg-5f9`, and it is the other direction: a slot the
    // block-axis cap squashed is not square any more, and a face still drawn
    // from its width hangs out of the top and loses its leading edge to the
    // row. Neither term alone is the rule - the share alone clips a squashed
    // slot, the height alone brings `mtg-bm1` back on a shrunk one.
    const sheet = uiStyleSheet();
    expect(sheet).toContain(`.mtg-slot[data-tapped='true'] > .mtg-card {
  rotate: 90deg;
  width: min(${cssNumber((CARD_TRIM_MM.width / CARD_TRIM_MM.height) * 100)}%, 100cqh);
  --card-w: min(${cssNumber((CARD_TRIM_MM.width / CARD_TRIM_MM.height) * 100)}cqw, 100cqh);
  height: auto; min-width: 0; max-height: none;
}`);
    expect(sheet).not.toMatch(/\.mtg-slot\[data-tapped='true'\] > \.mtg-card \{[^}]*scale: [\d.]+/);
    // The rotated width is reserved in the box again, and only while it is
    // needed: the square is on the tapped slot, never on the row's slots at rest.
    expect(sheet).toContain(
      `.mtg-slot[data-slot][data-tapped='true'] {\n  width: ${cssNumber(
        (COMPACT_FACE_WIDTH_REM * CARD_TRIM_MM.height) / CARD_TRIM_MM.width,
      )}rem; aspect-ratio: 1;\n}`,
    );
  });

  it('gives a board face height to its art window and none of it to the bars', () => {
    // The face on the table is art-dominant, and this is the mechanism: the
    // window is the one region that grows, the text bars take exactly the height
    // their text needs, and the text sizes are a share of the face's own width
    // rather than fixed. Without that last part every bar keeps its intrinsic
    // height whatever the card does and the picture is the residual — which is
    // how `ui/board-face` reached a 41.34 x 8.55px art window mid-game.
    render(
      h(
        'div',
        null,
        h(GlobalStyles),
        h(Battlefield, { label: 'Battlefield', permanents: [{ key: 'p1', card: creature() }] }),
      ),
    );
    const art = styleOf(".mtg-card[data-size='board'] > [data-region='art']");
    expect(art.getPropertyValue('flex-grow'), 'the window takes the surplus').toBe('1');
    // Every region but the window, and but the footer: a board face draws no
    // foot row for a creature at all now, because the P/T moved to the card's
    // own corner and out of the column (`../src/card/anatomy.ts`,
    // `BOARD_REGIONS`). The row is still laid out for a caller's footnote, which
    // the attachment tests below drive; there is nothing to read a computed
    // style off here.
    for (const region of BOARD_REGIONS.filter((entry) => entry !== 'art' && entry !== 'footer')) {
      const style = styleOf(`.mtg-card[data-size='board'] > [data-region='${region}']`);
      expect(style.getPropertyValue('flex-grow'), `${region} takes no share of the height`).toBe('0');
      expect(style.getPropertyValue('flex-shrink'), `${region} gives none of it back`).toBe('0');
    }
    // The name is sized against the face's own container, so it scales with the
    // card instead of pinning a constant number of pixels of text on it.
    expect(styleOf(".mtg-card[data-size='board']").getPropertyValue('container-type')).toBe('inline-size');
    // Every term of that clamp also takes the name ladder's scale, the floor
    // included — under about a 130px face the proportional term loses to the
    // floor and a long name stops tracking the bar it has to fit, which is where
    // a five-line name came from (`../src/card/anatomy.ts`, `nameFitStepOf`).
    //
    // Re-recorded for `mtg-0sq`, which is the other end of the same sentence:
    // the ladder is calibrated on the *full* face's bar, so it tells a
    // 22-character name to shrink by nothing and that name is still four
    // characters a line on a 48px thumbnail. The floor is now the lower of
    // `BOARD_TEXT_FLOOR_REM` and the ladder's own, so the scale is still on
    // every term and there is an absolute stop under all three.
    // `card-uniformity.test.ts` holds the floor itself and carries the browser
    // numbers; what this line is for is the *scale*, which that file's own
    // count of three `--name-scale` references also holds.
    expect(uiStyleSheet()).toMatch(
      /\.mtg-card\[data-size='board'\] \.mtg-card__name \{\s*font-size: clamp\(\s*min\([\d.]+rem, calc\(var\(--mtg-text-xs\) \* var\(--name-scale, 1\)\)\),\s*calc\([\d.]+cqw \* var\(--name-scale, 1\)\),/,
    );
  });

  it('draws no placeholder where there is no permanent, and says so in words when there are none', () => {
    // The playtester, 2026-08-14: "not sure why there are dashed line card boxes on
    // the battlefield, no reason for them". A battlefield row used to pad itself
    // out to a stated slot count with small dashed markers; measured in
    // chrome-headless-shell 151 at four viewports before they were deleted, they
    // held no box on the mat up. What answers "did this render" now is the
    // zone's own sentence, which is a stronger answer than a row of holes.
    const one = renderToStaticMarkup(
      h(Battlefield, { label: 'Battlefield', permanents: [{ key: 'p1', card: creature() }] }),
    );
    expect(one).not.toContain('data-empty');
    expect(one).toContain('class="mtg-zone__count">1<');
    const none = renderToStaticMarkup(h(Battlefield, { label: 'Battlefield', permanents: [] }));
    expect(none).not.toContain('data-empty');
    expect(none).toContain('no permanents');
  });

  it('draws a land as an art tile in a row of its own, and keeps its marks', () => {
    // The playtester, 2026-08-13: "I would like to see the lands in play as their
    // card art by the way not just pips", then "in a row below the cards in
    // play [...] just show their art". So a land is an art tile in a row under
    // the spells rather than a slot among them (`./play/land-tile.test.ts` holds
    // the tile itself). What the row may not do is drop what the chip was
    // carrying, so a land with counters on it still says so.
    const markup = renderToStaticMarkup(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [
          { key: 'p1', card: creature() },
          { key: 'p2', card: land(), tapped: true, counters: 1 },
        ],
      }),
    );
    // Two faces and nothing else: the land is a face in a band of its own.
    expect(markup.match(/class="mtg-slot"/g)).toHaveLength(2);
    expect(markup).toContain('class="mtg-lands"');
    expect(markup).toContain(land().name);
    expect(markup).toContain('data-tapped="true"');
    expect(markup).toContain('>+1<');
    // The land's own art window is drawn, which is the whole of the request.
    expect(markup.match(/class="mtg-art"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // The land is on the battlefield, so it is one of the permanents the zone
    // counts; it just is not one of the faces the numbered row draws.
    expect(markup).toContain('class="mtg-zone__count">2<');
  });

  it('reports a land the same way it reports a permanent', () => {
    const picked: string[] = [];
    render(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [{ key: 'p2', card: land() }],
        onSelect: (chosen: BoardPermanent) => {
          picked.push(chosen.key);
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(land().name) }));
    expect(picked).toEqual(['p2']);
  });
});

describe('CardSlot', () => {
  // What the board face gives up is the rules box, and this is where it went.
  // jsdom shows no tooltip, fires no `:hover`, and lays nothing out, so the four
  // properties split: two are structure and are checked on the rendered tree,
  // two are cascade and are checked against the emitted rule. The browser
  // numbers (244 x 341px panel, `pointer-events` resolving to the panel behind
  // it, fully inside the viewport at both sizes) are in the commit message.

  it('draws the whole face beside the board face, not inside it', () => {
    // The card's name is on the page twice, once per face, which is the whole
    // point: `getByText` would fail on the ambiguity rather than measure it.
    const slot = asElement(render(h(CardSlot, { kind: 'hand', card: creature() })).container).querySelector(
      '.mtg-slot',
    );
    expect(slot, 'the face is in a slot').toBeTruthy();
    const board = asElement(slot).querySelector(".mtg-card[data-size='board']");
    const zoom = asElement(slot).querySelector('.mtg-zoom');
    expect(board, 'the table draws a board face').toBeTruthy();
    expect(zoom, 'and a zoom beside it').toBeTruthy();
    expect(asElement(zoom).querySelector('.mtg-card')?.getAttribute('data-size')).toBe('full');
    // Beside, not within: a panel inside the face would scale with the face and
    // be clipped by it, which is the whole reason it is a sibling.
    expect(asElement(board).contains(zoom)).toBe(false);
    expect(asElement(zoom).getAttribute('aria-hidden'), 'the same words are already on the face').toBe(
      'true',
    );
  });

  it('keeps the panel outside the button when the face is one', () => {
    // The face becomes a `<button>` the moment a caller passes `onSelect`. A
    // panel nested inside it would put a `div` in phrasing content and, worse,
    // put a second interactive-looking region inside a control. Keeping it a
    // sibling is what makes the zoom safe on every surface, not just this one.
    render(h(CardSlot, { kind: 'hand', card: creature(), onSelect: () => undefined }));
    const button = asElement(screen.getByRole('button'));
    const zoom = asElement(button.closest('.mtg-slot')).querySelector('.mtg-zoom');
    expect(zoom, 'the zoom is still drawn').toBeTruthy();
    expect(button.querySelector('.mtg-zoom'), 'and it is not inside the control').toBeNull();
    expect(button.contains(zoom)).toBe(false);
  });

  it('cannot swallow the click that plays the card', () => {
    // Structure is not enough here: the panel is drawn over the table, so it
    // sits above whatever is beneath it in paint order. `pointer-events: none`
    // is the part that keeps it out of the hit-test path, and jsdom's cascade
    // does carry it.
    render(h('div', null, h(GlobalStyles), h(CardSlot, { kind: 'hand', card: creature() })));
    expect(styleOf('.mtg-zoom').getPropertyValue('pointer-events')).toBe('none');
    expect(styleOf('.mtg-zoom').getPropertyValue('position')).toBe('fixed');
    expect(styleOf('.mtg-zoom').getPropertyValue('display'), 'hidden until asked for').toBe('none');
  });

  it('is raised by hover and by focus, and nothing on the table may clip it', () => {
    // Read off the sheet: jsdom evaluates neither pseudo-class, and a test that
    // rendered a hover state would be asserting its own mock.
    //
    // The keyboard's trigger is `:focus-visible` rather than the `:focus-within`
    // it was, and the difference is not cosmetic: focus-within is true after a
    // tap or a click, so on a phone every card selection drew the panel over the
    // card being played. `./play/zoom-touch.browser.test.ts` drives the real
    // input that settles which is which; what belongs here is that both triggers
    // are in the sheet at all.
    const sheet = uiStyleSheet();
    expect(sheet).toContain('.mtg-slot:hover > .mtg-zoom,');
    expect(sheet).toContain('.mtg-slot:has(:focus-visible) > .mtg-zoom { display: block; }');
    // And the coarse-pointer pair, which is the half a touch screen reads. Chrome
    // leaves a tapped element hovered until something else is touched, so
    // `:hover` there means "last pressed" and is no evidence of interest - that
    // stale panel beside the card being played was the whole complaint. The
    // second rule is the other half of the same ask, that a tapped card show its
    // full text: a finger leaves focus rather than `:focus-visible`, so the slot's
    // own focus is the signal that actually moves with the finger.
    expect(sheet).toContain('@media (pointer: coarse) {');
    expect(sheet).toContain('.mtg-slot:hover:not(:focus-within) > .mtg-zoom { display: none; }');
    expect(sheet).toContain('.mtg-slot:focus-within > .mtg-zoom { display: block; }');
    // A fixed box is clipped only by an ancestor that is a containing block for
    // it: a transform, a filter, or explicit layout or paint containment. The
    // `contain` property never appears in this sheet and this is the rule that
    // keeps it that way.
    //
    // It used to ban `container-type: size` by name, on the reasoning that the
    // spec applies layout containment to a size container. Measured in
    // chrome-headless-shell 151 on 2026-08-16 that is not what happens: with
    // the spells row and a tapped slot both size containers
    // (`../src/styles/board/hand.ts`, `../src/styles/board/slot.ts`), a board
    // face's zoom draws at exactly the box a hand card's does - 816, 437,
    // 320 x 447 at 1440x900, and the same pair at 1024x768 and 1440x480 - which
    // is the viewport's bottom-right corner less the rail, not the slot's. A
    // criterion that bans a declaration measured not to have the effect it
    // bans is a criterion about the wrong thing, so the live version of this
    // claim is in `play/table-allocation.browser.test.ts`, where the two boxes
    // are compared in a browser rather than argued from the sheet.
    expect(sheet).not.toMatch(/[^-]contain: (layout|paint|strict|content|size)/);
    expect(sheet).not.toMatch(/\.mtg-slot(\[[^\]]*\])? \{[^}]*(transform|translate|filter):/);
  });
});

describe('an attached permanent', () => {
  const host: BoardPermanent = { key: 'o1', card: creature() };
  const held: BoardPermanent = {
    key: 'o2',
    card: creature(),
    attachedTo: creature().name,
    attachedToKey: 'o1',
  };
  const heldAura: BoardPermanent = {
    key: 'o3',
    card: aura(),
    attachedTo: creature().name,
    attachedToKey: 'o1',
  };

  it('is drawn beside what it is attached to, in a group that names the pair', () => {
    render(h(Battlefield, { label: 'Battlefield', permanents: [held, host] }));
    const tray = screen.getByRole('group', {
      name: `${creature().name}, equipped with ${creature().name}`,
    });
    // Both cards are inside it, and the weapon was second in battlefield order
    // before this: grouping is what makes the two neighbors at all.
    expect(asElement(tray).querySelector(`[data-permanent-key='o1']`)).not.toBeNull();
    expect(asElement(tray).querySelector(`[data-permanent-key='o2']`)).not.toBeNull();
  });

  it('takes one place on the table between them, not two', () => {
    const markup = renderToStaticMarkup(h(Battlefield, { label: 'Battlefield', permanents: [host, held] }));
    // One item in the spell row, holding both cards, rather than two neighbors.
    expect(markup.match(/class="mtg-attach"/g)).toHaveLength(1);
    expect(markup.match(/data-permanent-key=/g)).toHaveLength(2);
  });

  it('is an ordinary permanent when this row does not hold its host', () => {
    // An Equipment stays attached through a control change, so the creature can
    // genuinely be in the other seat's row. The weapon's own foot line is then
    // the only thing that says where it went.
    render(h(Battlefield, { label: 'Battlefield', permanents: [held] }));
    expect(screen.queryAllByRole('group', { name: /equipped with/ })).toHaveLength(0);
    expect(screen.getAllByText(`Equipping ${creature().name}`).length).toBeGreaterThan(0);
  });

  it('names an Aura as enchanting its host instead of equipping it', () => {
    render(h(Battlefield, { label: 'Battlefield', permanents: [host, heldAura] }));
    expect(
      screen.getByRole('group', { name: `${creature().name}, enchanted by ${aura().name}` }),
    ).toBeTruthy();
    expect(screen.getAllByText(`Enchanting ${creature().name}`).length).toBeGreaterThan(0);
    expect(screen.queryByText(`Equipping ${creature().name}`)).toBeNull();
  });

  it('is drawn shorter than its host, under a rule the play route cannot outweigh', () => {
    // jsdom lays nothing out, so this reads the sheet. The two selectors weigh
    // the same, so the tucked height survives on source order alone.
    const sheet = uiStyleSheet();
    expect(sheet).toContain('.mtg-attach__held > .mtg-slot');
    expect(sheet.indexOf('.mtg-attach__held > .mtg-slot')).toBeGreaterThan(
      sheet.indexOf("[data-mtg-mode='play'] .mtg-slot {"),
    );
  });

  it('marks a derived pair on the face as well as in the corner', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toContain(".mtg-mark[data-mark='derived']");
    expect(sheet).toContain(".mtg-slot:has(.mtg-slot__marks .mtg-mark[data-mark='derived']) .mtg-card__pt");
  });
});

describe('Hand', () => {
  it('draws hidden cards instead of omitting them', () => {
    render(h(Hand, { label: 'Hand', cards: [], hiddenCount: 3 }));
    expect(screen.getAllByLabelText('face-down card')).toHaveLength(3);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('says a card cannot be played by not being a button, and says nothing else', () => {
    // The affordance was the message all along, and the footnote spelling it
    // out took the collector line's place on every card the player could not
    // cast. the playtester, 2026-08-13: "remove that text".
    render(
      h(Hand, {
        label: 'Hand',
        cards: [{ key: 'h1', card: creature(), playable: false }],
        onSelect: () => undefined,
      }),
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('unplayable')).toBeNull();
    // Still drawn and still named: hidden and inert are different answers.
    expect(screen.getAllByRole('group', { name: new RegExp(creature().name) }).length).toBeGreaterThan(0);
  });

  it('draws the rail it was given, including the slots it has no card for', () => {
    // A hand of two in a rail of seven is two cards and five drawn holes, not a
    // row of two that moves every time a card is cast. The empty ones are out of
    // the accessible tree: a slot is a place, and there is nothing to announce.
    const markup = renderToStaticMarkup(
      h(Hand, {
        label: 'Hand',
        cards: [
          { key: 'h1', card: creature() },
          { key: 'h2', card: land() },
        ],
        slots: 7,
      }),
    );
    expect(markup.match(/class="mtg-slot"/g)).toHaveLength(7);
    expect(markup.match(/data-empty="true"/g)).toHaveLength(5);
    expect(markup).toContain('data-empty="true" aria-hidden="true"');
  });

  it('pads nothing when the caller asks for no rail', () => {
    const markup = renderToStaticMarkup(h(Hand, { label: 'Hand', cards: [{ key: 'h1', card: creature() }] }));
    expect(markup).not.toContain('data-empty');
  });

  it('leaves a hidden hand its face-down count rather than a padded rail', () => {
    // Seven drawn slots against a hand of three would be three face-down cards
    // and four the opponent does not hold.
    const markup = renderToStaticMarkup(h(Hand, { label: 'Hand', cards: [], hiddenCount: 3, slots: 7 }));
    expect(markup.match(/mtg-facedown/g)).toHaveLength(3);
    expect(markup).not.toContain('data-empty');
  });

  it('keeps the rail one row and scrolls it, while every other zone still wraps', () => {
    // Seven slots and their six gaps are 69.5rem, so under the wrap the zone body
    // gives everything else the hand broke onto a second row at any ordinary
    // window width and read as a grid rather than as a hand. A second rail-toned
    // zone is rendered beside it because the tone is the thing the rule must not
    // be keyed off: `src/styles/board/zone.ts` makes the nowrap opt-in per zone,
    // and a rule written against `[data-tone='rail']` instead would take every
    // zone that merely paints like paper with it. The witness used to be the
    // stack, which `mtg-rgc.7` turned into a strip on the seam that is no longer
    // a zone at all.
    render(
      h(
        'div',
        null,
        h(GlobalStyles),
        h(Hand, { label: 'Hand', cards: [{ key: 'h1', card: creature() }], slots: 7 }),
        h(Battlefield, { label: 'Battlefield', permanents: [{ key: 'p1', card: creature() }] }),
        h(Zone, { label: 'Exile', tone: 'rail', items: [h(Card, { key: 'e1', card: creature() })] }),
      ),
    );
    const hand = styleOf("[aria-label='Hand'] .mtg-zone__body");
    expect(hand.getPropertyValue('flex-wrap')).toBe('nowrap');
    expect(hand.getPropertyValue('overflow-x')).toBe('auto');
    const paper = styleOf("[aria-label='Exile'] .mtg-zone__body");
    expect(paper.getPropertyValue('flex-wrap'), 'the rail tone took the nowrap with it').toBe('wrap');
    expect(paper.getPropertyValue('overflow-x'), 'the rail tone took the scroll with it').toBe('visible');
    // A battlefield holds two things down the zone rather than n across it —
    // the cards in play, and the mana base in a row under them — so its body is
    // the column and the cards inside it are what wrap.
    const battlefield = styleOf("[aria-label='Battlefield'] .mtg-zone__body");
    expect(battlefield.getPropertyValue('flex-direction')).toBe('column');
    const played = styleOf("[aria-label='Battlefield'] .mtg-board__spells");
    expect(played.getPropertyValue('flex-wrap'), 'the cards in play stopped wrapping').toBe('wrap');
    expect(played.getPropertyValue('overflow-x'), 'the cards in play stopped overflowing visibly').toBe(
      'visible',
    );
  });

  it('draws a card at the compact width the face specification gives', () => {
    // Measured off the rendered hand, never off the constant the stylesheet was
    // supposed to have used: an assertion comparing the specification's number
    // to itself passes whatever that number becomes. The absolute size is the
    // property under test — 9.5rem is a design decision about whether a card in
    // hand reads as a card, not an arithmetic identity — so all three values are
    // pinned independently. The specification is pinned for the one case the two
    // rendered values cannot see: a stylesheet typed back to its own literal
    // holds the hand at 152px while `COMPACT_FACE_WIDTH_REM` drifts away from
    // it. Moving any one of the three alone fails here (ADR-0002 §6.2).
    expect(COMPACT_FACE_WIDTH_REM).toBe(9.5);
    render(
      h('div', null, h(GlobalStyles), h(Hand, { label: 'Hand', cards: [{ key: 'h1', card: creature() }] })),
    );
    // 9.5rem against the 16px root: the sheet sets a font size on `body`, never
    // on the root element, so a rem is the browser default here.
    expect(styleOf('.mtg-slot').getPropertyValue('width')).toBe('152px');
    // The face in a hand is the `board` size, not the compact one: it draws its
    // art. The compact face is still specified at the same width and is still
    // what deckbuilding draws, which the next test renders directly rather than
    // leaning on this one.
    expect(styleOf('.mtg-slot > .mtg-card').getPropertyValue('width')).toBe('100%');
    expect(styleOf('.mtg-slot > .mtg-card').getPropertyValue('aspect-ratio')).toBe('63 / 88');
  });

  it('still draws a compact face at the specified width, for the surfaces that ask for one', () => {
    render(h('div', null, h(GlobalStyles), h(Card, { card: creature(), size: 'compact' })));
    // The channel rather than the resolved width: jsdom substitutes no custom
    // property, so `width` reads back as the `var()` that references this.
    expect(styleOf(".mtg-card[data-size='compact']").getPropertyValue('--card-w')).toBe('9.5rem');
  });
});

describe('StackZone', () => {
  it('draws nothing at all when it holds nothing', () => {
    // It used to say "stack is empty" inside a floored 52px rail block, which is
    // the state of the table at nearly every decision in a game. `mtg-rgc.7`
    // moved it onto the mat, where a strip saying nothing is a strip that should
    // not be there: the board reports the empty stack by carrying no strip.
    const { container } = render(h(StackZone, { entries: [] }));
    expect(screen.queryByLabelText('Stack')).toBeNull();
    expect((container as unknown as { readonly childElementCount: number }).childElementCount).toBe(0);
  });

  it('flags the top entry, which is the last one given', () => {
    const markup = renderToStaticMarkup(
      h(StackZone, {
        entries: [
          { key: 's1', card: creature(), controller: 'you' },
          { key: 's2', card: EXAMPLE_CARDS[1] ?? creature(), controller: 'bot' },
        ],
      }),
    );
    expect(markup.match(/data-top="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-top="false"');
  });
});

describe('Graveyard', () => {
  /**
   * The reclaim itself (`mtg-bc2.138`): the rail spends one strip on a zone of
   * any depth. How the browser behaves once opened is
   * `./graveyard-browser.test.ts`; what is checked here is that nothing is
   * drawn until it is.
   */
  it('draws the count and the newest name, and holds the rest behind the click', () => {
    const cards = EXAMPLE_CARDS.slice(0, 6).map((card, index) => ({ key: `g${index}`, card }));
    render(h(Graveyard, { label: 'Graveyard', cards }));
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText(EXAMPLE_CARDS[5]?.name ?? '')).toBeTruthy();
    for (const card of EXAMPLE_CARDS.slice(0, 5)) {
      expect(screen.queryByText(card.name)).toBeNull();
    }
  });
});

describe('PlayerStatus', () => {
  it('shows an em dash for counts a view cannot know', () => {
    render(
      h(PlayerStatus, {
        name: 'oppo',
        life: 12,
        handCount: 4,
        libraryCount: null,
        graveyardCount: null,
      }),
    );
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('flags a low life total and the active seat', () => {
    const markup = renderToStaticMarkup(
      h(PlayerStatus, {
        name: 'you',
        life: 3,
        handCount: 1,
        libraryCount: 30,
        graveyardCount: 2,
        active: true,
        priority: true,
      }),
    );
    expect(markup).toContain('data-low="true"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('Priority');
  });

  it('renders a floating mana pool', () => {
    render(
      h(PlayerStatus, {
        name: 'you',
        life: 20,
        handCount: 7,
        libraryCount: 33,
        graveyardCount: 0,
        mana: { W: 1, U: 0, B: 0, R: 2, G: 0, C: 0 },
      }),
    );
    expect(screen.getByLabelText('Mana pool: 3 floating')).toBeTruthy();
  });

  it('draws the pool as the shared symbols rather than spelling them', () => {
    const markup = renderToStaticMarkup(
      h(PlayerStatus, {
        name: 'you',
        life: 20,
        handCount: 7,
        libraryCount: 33,
        graveyardCount: 0,
        mana: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 },
      }),
    );
    expect(markup).toContain('class="mtg-pip__glyph"');
    expect(markup).toContain(`d="${PIP_GLYPHS.w.fill}"`);
    expect(markup).toContain(`d="${PIP_GLYPHS.c.fill}"`);
    expect(markup).not.toMatch(/>[WUBRGC]</);
  });
});

describe('Board', () => {
  it('lays out both seats and the rail from props alone', () => {
    render(
      h(Board, {
        opponent: {
          status: { name: 'Bot', life: 20, handCount: 7, libraryCount: null, graveyardCount: null },
          battlefield: { label: 'Bot battlefield', permanents: [] },
        },
        you: {
          status: { name: 'You', life: 18, handCount: 5, libraryCount: 33, graveyardCount: 1 },
          battlefield: {
            label: 'Your battlefield',
            permanents: [{ key: 'p1', card: land() }],
          },
          hand: { label: 'Your hand', cards: [{ key: 'h1', card: creature() }] },
          graveyard: { label: 'Your graveyard', cards: [] },
        },
        stack: { entries: [{ key: 's1', card: creature(), controller: 'You' }] },
      }),
    );
    expect(screen.getByLabelText("Bot's status")).toBeTruthy();
    expect(screen.getByLabelText('your status')).toBeTruthy();
    expect(screen.getByLabelText('Your battlefield')).toBeTruthy();
    expect(screen.getByLabelText('Your hand')).toBeTruthy();
    expect(screen.getByLabelText('Stack')).toBeTruthy();
    expect(screen.getByText('graveyard is empty')).toBeTruthy();
  });
});
