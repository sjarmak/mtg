// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import type { BoardSide } from '../../src/board/Board';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const found = EXAMPLE_CARDS.find((card) => card.kind === 'creature');
if (found === undefined) throw new Error('the examples hold no creature');
const creature: Card = found;

function filled(count: number, attacking: boolean): readonly BoardPermanent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    key: `creature-${String(index)}`,
    card: { ...creature, id: `${creature.id}-${String(index)}` },
    tapped: false,
    summoningSick: false,
    ...(attacking && index === 0 ? { attacking: true, attackingDefender: 'Bot' } : {}),
  }));
}

function you(attacking: boolean): BoardSide {
  return {
    status: { name: 'You', life: 24, handCount: 7, libraryCount: 53, graveyardCount: 0 },
    battlefield: { label: 'You battlefield', permanents: filled(8, attacking) },
    hand: { label: 'You hand', cards: [] },
    avatars: { label: 'You avatar', cards: [{ key: 'avatar-0', card: creature }] },
  };
}

function opponent(): BoardSide {
  return {
    status: { name: 'Bot', life: 24, handCount: 7, libraryCount: 53, graveyardCount: 0 },
    battlefield: { label: 'Bot battlefield', permanents: [] },
    hand: { label: 'Bot hand', cards: [] },
  };
}

function page(attacking: boolean): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(Board, {
        you: you(attacking),
        opponent: opponent(),
        stack: { entries: [] },
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Avatar zone footprint</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const rect = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { w: round(r.width), h: round(r.height) };
  };
  const side = document.querySelector(".mtg-board__side[data-seat='you']");
  const battlefield = side === null ? null : side.querySelector(':scope > :first-child');
  return {
    avatar: rect(document.querySelector('.mtg-avatar')),
    card: rect(document.querySelector('.mtg-avatar .mtg-slot')),
    battlefield: rect(battlefield),
    combatOpen: document.querySelector(".mtg-board__divider[data-combat='true']") !== null,
  };
})()`;

interface Box {
  readonly w: number;
  readonly h: number;
}

interface Measurement {
  readonly avatar: Box | null;
  readonly card: Box | null;
  readonly battlefield: Box | null;
  readonly combatOpen: boolean;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

describe('the avatar zone takes the room one card needs', () => {
  browserIt(
    'sizes to its one card at rest and stays readable once combat opens the band',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-avatar-zone-'));
      const files = new Map<boolean, string>();
      for (const attacking of [false, true]) {
        const file = join(directory, `board-${String(attacking)}.html`);
        await writeFile(file, page(attacking), 'utf8');
        files.set(attacking, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [attacking, file] of files) {
          for (const [width, height] of VIEWPORTS) {
            const where = `${String(width)}x${String(height)}${attacking ? ' in combat' : ''}`;
            const result = (await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              'avatar zone',
            )) as unknown as Measurement;
            if (attacking) expect(result.combatOpen, `${where}: combat band did not open`).toBe(true);
            expect(result.avatar, `${where}: no avatar zone drawn`).not.toBeNull();
            expect(result.card, `${where}: no avatar card drawn`).not.toBeNull();
            expect(result.battlefield, `${where}: no battlefield drawn`).not.toBeNull();
            const avatar = result.avatar as Box;
            const card = result.card as Box;
            const battlefield = result.battlefield as Box;

            expect(card.h, `${where}: avatar card height`).toBeGreaterThanOrEqual(80);
            expect(
              avatar.h,
              `${where}: avatar zone height ${String(avatar.h)} vs its one card ${String(card.h)}`,
            ).toBeLessThanOrEqual(card.h + 160);
            expect(
              avatar.h,
              `${where}: avatar zone height ${String(avatar.h)} vs battlefield height ${String(battlefield.h)}`,
            ).toBeLessThan(battlefield.h * 0.7);
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});
