// @vitest-environment node
/** Every official cube position and face crosses the shared UI presentation seam. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectView } from '@mtg/engine';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { PrintedCardFace } from '../../src/card/PrintedCardFace';
import { printedCardArt, printedDisplayCard } from '../../src/card/printed-card-art';
import { LEGACY_CUBE_OFFICIAL_POSITIONS, readLegacyCubeCatalog } from '../../src/routes/legacy-cube/model';

const CATALOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-card-catalog-v1.json',
);

let catalog: PrintedCardCatalog;

beforeAll(async () => {
  catalog = await readLegacyCubeCatalog(JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as unknown);
});

function observedFace(
  physicalId: string,
  face: PrintedCardCatalog['cards'][number]['faces'][number],
): ObjectView {
  return {
    oid: `${physicalId}:${face.name}`,
    name: face.name,
    typeLine: face.typeLine,
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0,
    counters: {},
  };
}

describe('complete Legacy Cube presentation census', () => {
  it('renders all 600 singleton positions through the ordinary shared card frame', () => {
    const failures: string[] = [];
    const ids = new Set<string>();

    for (const card of catalog.cards) {
      ids.add(card.physicalId);
      try {
        const html = renderToStaticMarkup(h(PrintedCardFace, { card, size: 'full', deferArt: true }));
        const required = [
          'data-presentation="printed-card"',
          `data-physical-id="${card.physicalId}"`,
          `data-position="${String(card.position)}"`,
          'data-region="title"',
          'data-region="art"',
          'data-region="type"',
          'data-region="rules"',
        ];
        if (required.some((marker) => !html.includes(marker)) || html.includes('mtg-printed-card-image')) {
          failures.push(`${String(card.position)} ${card.name}: incomplete shared frame`);
        }
      } catch (error) {
        failures.push(`${String(card.position)} ${card.name}: ${String(error)}`);
      }
    }

    expect(catalog.cards).toHaveLength(LEGACY_CUBE_OFFICIAL_POSITIONS);
    expect(ids.size).toBe(LEGACY_CUBE_OFFICIAL_POSITIONS);
    expect(failures).toEqual([]);
  });

  it('maps every front, back, transform, modal and Adventure face by its backend name', () => {
    const failures: string[] = [];
    let faces = 0;

    for (const card of catalog.cards) {
      for (const face of card.faces) {
        faces += 1;
        try {
          const object = observedFace(card.physicalId, face);
          const art = printedCardArt(card, object);
          const display = printedDisplayCard(card, object);
          if (
            art.printedFrame?.name !== face.name ||
            art.printedFrame.manaCost !== face.manaCost ||
            art.printedFrame.typeLine !== face.typeLine ||
            art.printedFrame.oracleText !== face.oracleText ||
            art.printedFrame.loyalty !== face.loyalty ||
            art.src.length === 0 ||
            display.name !== face.name
          ) {
            failures.push(`${String(card.position)} ${face.name}: wrong face presentation`);
          }
        } catch (error) {
          failures.push(`${String(card.position)} ${face.name}: ${String(error)}`);
        }
      }
    }

    expect(faces).toBeGreaterThan(LEGACY_CUBE_OFFICIAL_POSITIONS);
    expect(failures).toEqual([]);
  });
});
