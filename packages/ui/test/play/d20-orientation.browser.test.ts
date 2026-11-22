// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { D20_FACE_LIST } from '../../src/routes/play/d20';
import { die } from '../../src/routes/play/OpeningRoll';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome, stillPage } from '../support/chrome';

function page(value: number): string {
  const markup = renderToStaticMarkup(die(value, 'purple', 'settled', () => undefined));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>d20</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${uiStyleSheet()}html,body{margin:0;padding:0}.mtg-d20-harness{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh}</style></head><body><div class="mtg-d20-harness">${markup}</div></body></html>`;
}

const MEASURE = `(() => {
  const stage = document.querySelector('.mtg-d20-stage');
  const spin = document.querySelector('.mtg-d20__spin');
  const body = document.querySelector('.mtg-d20');
  if (stage === null || spin === null || body === null) {
    return { hitPip: null, matrixPip: null, faceCount: 0 };
  }
  const chain = [body, spin].map((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform));
  let best = null;
  let bestZ = Number.NEGATIVE_INFINITY;
  for (const face of document.querySelectorAll('.mtg-d20__face')) {
    const local = new DOMMatrixReadOnly(getComputedStyle(face).transform);
    const full = chain.reduce((acc, m) => m.multiply(acc), local);
    const normal = full.transformPoint(new DOMPoint(0, 0, 1, 0));
    const pip = face.querySelector('.mtg-d20__pip');
    if (normal.z > bestZ) {
      bestZ = normal.z;
      best = pip === null ? null : pip.textContent;
    }
  }
  for (const face of document.querySelectorAll('.mtg-d20__face')) {
    face.style.clipPath = 'none';
  }
  const rect = stage.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const hitFace = hit === null ? null : hit.closest('.mtg-d20__face');
  const hitPipEl = hitFace === null ? null : hitFace.querySelector('.mtg-d20__pip');
  return {
    hitPip: hitPipEl === null ? null : hitPipEl.textContent,
    matrixPip: best,
    faceCount: document.querySelectorAll('.mtg-d20__face').length,
  };
})()`;

interface Reading {
  readonly hitPip: string | null;
  readonly matrixPip: string | null;
  readonly faceCount: number;
}

function readingOf(result: Record<string, unknown>): Reading {
  return result as unknown as Reading;
}

const EDGE_MEASURE = `(() => {
  const spin = document.querySelector('.mtg-d20__spin');
  const body = document.querySelector('.mtg-d20');
  const faces = document.querySelectorAll('.mtg-d20__face');
  if (spin === null || body === null || faces.length === 0) {
    return { faceOnWidth: null, edgeOnWidth: null, faceCount: faces.length };
  }
  function unionWidth() {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const face of faces) {
      const rect = face.getBoundingClientRect();
      minX = Math.min(minX, rect.left);
      maxX = Math.max(maxX, rect.right);
    }
    return maxX - minX;
  }
  body.style.transform = 'none';
  spin.style.transform = 'none';
  const faceOnWidth = unionWidth();
  spin.style.transform = 'rotateY(90deg)';
  const edgeOnWidth = unionWidth();
  return { faceOnWidth, edgeOnWidth, faceCount: faces.length };
})()`;

interface EdgeReading {
  readonly faceOnWidth: number | null;
  readonly edgeOnWidth: number | null;
  readonly faceCount: number;
}

function edgeReadingOf(result: Record<string, unknown>): EdgeReading {
  return result as unknown as EdgeReading;
}

describe('the settled d20 points its rolled face at the viewer', () => {
  browserIt(
    'lands on the rolled number, for every one of the twenty faces',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-d20-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const face of D20_FACE_LIST) {
          const file = join(directory, `die-${String(face.value)}.html`);
          await writeFile(file, page(face.value), 'utf8');
          const read = readingOf(
            await measurePage(
              chrome.client,
              file,
              600,
              600,
              MEASURE,
              `settled die on ${String(face.value)}`,
              '.mtg-d20__face',
            ),
          );
          expect(read.faceCount, `die for ${String(face.value)} drew the wrong face count`).toBe(20);
          expect(read.matrixPip, `rest*placement does not face ${String(face.value)} at the viewer`).toBe(
            String(face.value),
          );
          expect(read.hitPip, `the painted die does not land on ${String(face.value)}`).toBe(
            String(face.value),
          );
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove d20 fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `d20 orientation Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});

describe('the tumbling d20 keeps its depth edge-on', () => {
  browserIt(
    'does not collapse to a flat disk when turned edge-on',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-d20-edge-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const file = join(directory, 'die-edge.html');
        await writeFile(file, page(1), 'utf8');
        const read = edgeReadingOf(
          await measurePage(
            chrome.client,
            file,
            600,
            600,
            stillPage(EDGE_MEASURE),
            'd20 turned edge-on',
            '.mtg-d20__face',
          ),
        );
        expect(read.faceCount, 'die drew the wrong face count').toBe(20);
        expect(read.faceOnWidth, 'face-on width did not measure').not.toBeNull();
        expect(read.edgeOnWidth, 'edge-on width did not measure').not.toBeNull();
        const faceOnWidth = read.faceOnWidth ?? 0;
        const edgeOnWidth = read.edgeOnWidth ?? 0;
        expect(
          edgeOnWidth,
          `edge-on width ${String(edgeOnWidth)} is too small a share of face-on width ${String(faceOnWidth)}: the die reads as a flattened disk`,
        ).toBeGreaterThanOrEqual(faceOnWidth * 0.6);
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove d20 edge fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `d20 edge-on Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
