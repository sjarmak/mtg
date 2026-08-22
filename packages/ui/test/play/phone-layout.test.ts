/**
 * The played table's phone layout contract.
 *
 * Browser measurements belong in the evidence for this lane because jsdom has
 * no layout engine. These assertions guard the structural rules beneath those
 * measurements: a phone gets one useful board column, a vertically reachable
 * table, fingertip-sized phase controls, and a viewport that exposes iOS safe
 * area insets. Tablet and desktop widths stay outside this layer.
 *
 * Both routes that draw a table are named here rather than the play route
 * alone. A draft game is played through the same `LiveGame` the play route
 * mounts (`../../src/routes/draft/DraftGame.ts`), so a rule that stops at
 * `[data-mtg-mode='play']` leaves a phone drafting against an unfitted board;
 * see `../../src/styles/board/geometry.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { uiStyleSheet } from '../../src/styles/index';

const CSS = uiStyleSheet();
const phoneAt = CSS.indexOf('@media (max-width: 40rem) {');
const coarseAt = CSS.indexOf('@media (max-width: 40rem) and (pointer: coarse) {');
const PHONE = phoneAt < 0 || coarseAt < 0 ? '' : CSS.slice(phoneAt, coarseAt);
const COARSE_PHONE = coarseAt < 0 ? '' : CSS.slice(coarseAt);

describe('the played table at phone widths', () => {
  it('moves the three board regions onto one reachable column', () => {
    expect(PHONE).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(PHONE).toContain('grid-template-rows: auto auto auto');
    expect(PHONE).toContain('height: auto');
    expect(PHONE).toContain('overflow: visible');
  });

  it('keeps the route register inside the phone and scrolls it locally when needed', () => {
    expect(PHONE).toMatch(/\.mtg-modes[^}]*max-width: 100%[^}]*overflow-x: auto/);
    expect(PHONE).toMatch(
      /\.mtg-shell:is\(\[data-mtg-mode='play'\], \[data-mtg-mode='draft'\]\)[^}]*overflow: hidden/,
    );
    expect(PHONE).toMatch(/\.mtg-shell__main[^}]*position: relative[^}]*overflow-y: auto/);
    expect(PHONE).toMatch(/\.mtg-panel__body[^}]*overflow-y: visible/);
  });

  it('gives both battlefield lanes and the hand a width instead of clipping them between rails', () => {
    expect(PHONE).toMatch(
      /\.mtg-board__side\[data-seat='opponent'\][^}]*display: flex[^}]*flex-direction: column/,
    );
    expect(PHONE).toContain('.mtg-board__lanes');
    expect(PHONE).toContain('min-height: 46rem');
  });

  it('makes every phase and priority press at least 44 CSS pixels on a coarse phone', () => {
    expect(COARSE_PHONE).toMatch(/\.mtg-phasebar__node[^}]*min-width: 44px/);
    expect(COARSE_PHONE).toMatch(/\.mtg-phasebar__beats[^}]*min-width: 44px/);
    expect(COARSE_PHONE).toMatch(/\.mtg-priority[^}]*\.mtg-btn[^}]*min-height: 44px/);
  });

  it('opts into and spends the device safe area', () => {
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(PHONE).toContain('env(safe-area-inset-left)');
    expect(PHONE).toContain('env(safe-area-inset-right)');
    expect(PHONE).toContain('env(safe-area-inset-bottom)');
  });
});
