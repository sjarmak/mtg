// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-builder-preview-entry.ts');

let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Limited builder preview');
  return pending;
}

const SETTLED = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const check = () => {
    if (document.querySelector('[aria-label="Cards in your deck"] button') !== null &&
        document.querySelector('[aria-label="Drafted pool"] button') !== null) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      return;
    }
    if (Date.now() > deadline) { reject(new Error('the builder never mounted both panes')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

describe('the printed-card builder preview in a live browser', () => {
  browserIt(
    'previews cards on an explicit right click and adds a pool card in one guarded click',
    async () => {
      const page = await builtPage();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-preview-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-preview-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'builder.html');
      await writeFile(file, page, 'utf8');
      let targetId = '';
      let sessionId = '';
      const evaluate = async (expression: string): Promise<unknown> => {
        const answer = await chrome.client.call(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          sessionId,
          30_000,
        );
        if (answer['exceptionDetails'] !== undefined) {
          throw new Error(`the builder page threw: ${JSON.stringify(answer['exceptionDetails'])}`);
        }
        return (answer['result'] as { readonly value?: unknown } | undefined)?.value;
      };
      try {
        const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
        targetId = String(target['targetId']);
        const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
        sessionId = String(attached['sessionId']);
        await chrome.client.call('Page.enable', {}, sessionId);
        await chrome.client.call('Runtime.enable', {}, sessionId);
        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
        await chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
        await evaluate(SETTLED);

        const inspect = async (label: string, name?: string): Promise<readonly number[]> => {
          const cardExpression =
            name === undefined
              ? 'cards.at(-1)'
              : `cards.find((candidate) => candidate.getAttribute('aria-label')?.startsWith(${JSON.stringify(name)}) === true)`;
          return (await evaluate(`(() => {
            const region = document.querySelector('[aria-label="${label}"]');
            const cards = region === null ? [] : [...region.querySelectorAll('button.mtg-card, button.mtg-strips__card')];
            const card = ${cardExpression};
            if (card === undefined) throw new Error('missing ${label} card');
            const scrollport = card.closest('.mtg-deck__pane-scroll');
            card.scrollIntoView({ block: 'center', inline: 'center' });
            const box = card.getBoundingClientRect();
            const clip = scrollport?.getBoundingClientRect() ?? box;
            const visible = {
              left: Math.max(box.left, clip.left),
              right: Math.min(box.right, clip.right),
              top: Math.max(box.top, clip.top),
              bottom: Math.min(box.bottom, clip.bottom)
            };
            const candidates = [0.5, 0.75, 0.25].map((share) => [
              Math.round(visible.left + (visible.right - visible.left) / 2),
              Math.round(visible.top + (visible.bottom - visible.top) * share)
            ]);
            const hits = [];
            for (const [x, y] of candidates) {
              const hit = document.elementFromPoint(x, y);
              if (hit !== null && (card.contains(hit) || hit === card)) return [x, y];
              hits.push(hit === null ? 'nothing' : {
                tag: hit.tagName,
                className: String(hit.className),
                aria: hit.getAttribute('aria-label'),
                text: hit.textContent?.slice(0, 40)
              });
            }
            throw new Error('${label} has no exposed press point at ' +
              JSON.stringify({ box: { top: box.top, left: box.left, width: box.width, height: box.height }, visible, hits }));
          })()`)) as readonly number[];
        };
        const move = async (at: readonly number[]): Promise<void> => {
          await chrome.client.call(
            'Input.dispatchMouseEvent',
            { type: 'mouseMoved', x: at[0], y: at[1] },
            sessionId,
          );
          await evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');
        };
        const click = async (at: readonly number[], count: number): Promise<void> => {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await chrome.client.call(
              'Input.dispatchMouseEvent',
              {
                type,
                x: at[0],
                y: at[1],
                button: 'left',
                buttons: type === 'mousePressed' ? 1 : 0,
                clickCount: count,
              },
              sessionId,
            );
          }
          await evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');
        };
        const rightClick = async (at: readonly number[]): Promise<void> => {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await chrome.client.call(
              'Input.dispatchMouseEvent',
              {
                type,
                x: at[0],
                y: at[1],
                button: 'right',
                buttons: type === 'mousePressed' ? 2 : 0,
                clickCount: 1,
              },
              sessionId,
            );
          }
          await evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');
        };
        const state = async (): Promise<{ readonly count: string; readonly preview: boolean }> =>
          (await evaluate(`(() => ({
            count: document.querySelector('[data-pane="deck"] .mtg-deck__pane-note')?.textContent ?? '',
            preview: document.querySelector('.mtg-cardpeek [data-presentation="printed-card"]') !== null
          }))()`)) as { readonly count: string; readonly preview: boolean };
        const visibleGroupGap = async (): Promise<number> =>
          (await evaluate(`(() => {
            const controls = [...document.querySelectorAll('.mtg-deck__group')];
            const control = controls.find((candidate) => candidate.getBoundingClientRect().width > 0);
            const label = control?.querySelector('.mtg-deck__group-label');
            const select = control?.querySelector('select');
            if (label === null || label === undefined || select === null || select === undefined) {
              throw new Error('missing a visible Group by control');
            }
            const labelBox = label.getBoundingClientRect();
            const selectBox = select.getBoundingClientRect();
            return selectBox.left - labelBox.right;
          })()`)) as number;
        const frameState = async (
          label: string,
        ): Promise<{
          readonly faces: number;
          readonly full: number;
          readonly compact: number;
          readonly art: number;
          readonly rules: number;
          readonly staleFrames: number;
        }> =>
          (await evaluate(`(() => {
            const region = document.querySelector('[aria-label="${label}"]');
            const faces = [...(region?.querySelectorAll('[data-presentation="printed-card"]') ?? [])];
            return {
              faces: faces.length,
              full: faces.filter((face) => face.getAttribute('data-size') === 'full').length,
              compact: faces.filter((face) => face.getAttribute('data-size') === 'compact').length,
              art: faces.filter((face) => face.querySelector('[data-region="art"]') !== null).length,
              rules: faces.filter((face) => face.querySelector('[data-region="rules"]') !== null).length,
              staleFrames: region?.querySelectorAll('.mtg-legacy-card, .mtg-printed-card-image').length ?? 0
            };
          })()`)) as {
            readonly faces: number;
            readonly full: number;
            readonly compact: number;
            readonly art: number;
            readonly rules: number;
            readonly staleFrames: number;
          };
        const inlineRulesState = async (
          names: readonly string[],
        ): Promise<
          readonly {
            readonly name: string;
            readonly widthPx: number;
            readonly fit: string;
            readonly fontPx: number;
            readonly overflowPx: number;
          }[]
        > =>
          (await evaluate(`(() => {
            const names = ${JSON.stringify(names)};
            const region = document.querySelector('[aria-label="Drafted pool"]');
            return names.map((name) => {
              const face = [...(region?.querySelectorAll('[data-presentation="printed-card"]') ?? [])].find(
                (candidate) => candidate.getAttribute('aria-label')?.startsWith(name) === true
              );
              const rules = face?.querySelector('[data-region="rules"]');
              const text = rules?.matches('.mtg-card__text') === true
                ? rules
                : rules?.querySelector('.mtg-card__text');
              if (face === undefined || rules === null || rules === undefined || text === null || text === undefined) {
                throw new Error('missing inline printed face for ' + name + ': ' +
                  JSON.stringify([...(region?.querySelectorAll('[data-presentation="printed-card"]') ?? [])]
                    .map((candidate) => candidate.getAttribute('aria-label'))));
              }
              return {
                name,
                widthPx: Math.round(face.getBoundingClientRect().width * 100) / 100,
                fit: text.getAttribute('data-fit') ?? '',
                fontPx: Math.round(parseFloat(getComputedStyle(text).fontSize) * 100) / 100,
                overflowPx: Math.max(0, rules.scrollHeight - rules.clientHeight)
              };
            });
          })()`)) as readonly {
            readonly name: string;
            readonly widthPx: number;
            readonly fit: string;
            readonly fontPx: number;
            readonly overflowPx: number;
          }[];
        const showFullCards = async (label: string): Promise<void> => {
          await evaluate(`(() => {
            const group = document.querySelector('[aria-label="${label}, View"]');
            const button = [...(group?.querySelectorAll('button') ?? [])].find(
              (candidate) => candidate.textContent?.trim() === 'Full cards'
            );
            if (button === undefined) throw new Error('missing ${label} Full cards control');
            button.click();
            return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          })()`);
        };
        const jaceLoyalty = async (): Promise<{
          readonly face: readonly {
            readonly cost: string;
            readonly width: number;
            readonly inkWidth: number;
            readonly inkHeight: number;
          }[];
          readonly preview: readonly {
            readonly cost: string;
            readonly width: number;
            readonly inkWidth: number;
            readonly inkHeight: number;
          }[];
        }> =>
          (await evaluate(`(() => {
            const reading = (root) => [...root.querySelectorAll('.mtg-card__loyalty')].map((badge) => {
              const box = badge.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(badge);
              const ink = range.getBoundingClientRect();
              return { cost: badge.textContent ?? '', width: box.width, inkWidth: ink.width, inkHeight: ink.height };
            });
            const region = document.querySelector('[aria-label="Drafted pool"]');
            const face = [...(region?.querySelectorAll('[data-presentation="printed-card"]') ?? [])].find(
              (candidate) => candidate.getAttribute('aria-label')?.startsWith('Jace, the Mind Sculptor') === true
            );
            const preview = document.querySelector('.mtg-cardpeek [data-presentation="printed-card"]');
            if (face === undefined || preview === null) throw new Error('Jace face and preview must both be visible');
            return { face: reading(face), preview: reading(preview) };
          })()`)) as {
            readonly face: readonly {
              readonly cost: string;
              readonly width: number;
              readonly inkWidth: number;
              readonly inkHeight: number;
            }[];
            readonly preview: readonly {
              readonly cost: string;
              readonly width: number;
              readonly inkWidth: number;
              readonly inkHeight: number;
            }[];
          };

        const vivienPreview = async (): Promise<{
          readonly fontPx: number;
          readonly overflowPx: number;
          readonly blankBeforePx: number;
          readonly blankAfterPx: number;
          readonly rows: number;
        }> =>
          (await evaluate(`(() => {
            const face = document.querySelector('.mtg-cardpeek [data-presentation="printed-card"]');
            const rules = face?.querySelector('[data-region="rules"]');
            const lines = rules === null || rules === undefined ? [] : [...rules.querySelectorAll('.mtg-card__line')];
            if (face?.getAttribute('aria-label')?.startsWith("Vivien, Monsters' Advocate") !== true ||
                rules === null || rules === undefined || lines.length === 0) {
              throw new Error('the actual builder hover is not showing Vivien');
            }
            const box = rules.getBoundingClientRect();
            const first = lines[0].getBoundingClientRect();
            const last = lines.at(-1).getBoundingClientRect();
            return {
              fontPx: Math.round(parseFloat(getComputedStyle(rules).fontSize) * 100) / 100,
              overflowPx: Math.max(0, rules.scrollHeight - rules.clientHeight),
              blankBeforePx: Math.round((first.top - box.top) * 100) / 100,
              blankAfterPx: Math.round((box.bottom - last.bottom) * 100) / 100,
              rows: lines.length
            };
          })()`)) as {
            readonly fontPx: number;
            readonly overflowPx: number;
            readonly blankBeforePx: number;
            readonly blankAfterPx: number;
            readonly rows: number;
          };

        expect(await visibleGroupGap()).toBeGreaterThanOrEqual(7.5);
        for (const label of ['Cards in your deck', 'Drafted pool']) {
          const frames = await frameState(label);
          expect(frames.faces, `${label}: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
          expect(frames.full, `${label}: ${JSON.stringify(frames)}`).toBe(frames.faces);
          expect(frames.compact, `${label}: ${JSON.stringify(frames)}`).toBe(0);
          expect(frames.art, `${label}: ${JSON.stringify(frames)}`).toBe(frames.faces);
          expect(frames.rules, `${label}: ${JSON.stringify(frames)}`).toBe(frames.faces);
          expect(frames.staleFrames, `${label}: ${JSON.stringify(frames)}`).toBe(0);
        }
        await showFullCards('Drafted pool');

        const namedRules = await inlineRulesState([
          'Nicol Bolas, Planeswalker',
          'Frost Titan',
          'Fatal Push',
          'Remand',
          'Glen Elendra Archmage',
        ]);
        for (const reading of namedRules) {
          expect(reading.widthPx, JSON.stringify(namedRules)).toBeGreaterThanOrEqual(244);
          expect(reading.overflowPx, JSON.stringify(namedRules)).toBe(0);
          expect(reading.fontPx, JSON.stringify(namedRules)).toBeGreaterThanOrEqual(9.5);
        }
        const rulesByName = new Map(namedRules.map((reading) => [reading.name, reading]));
        expect(rulesByName.get('Remand')?.fontPx).toBeGreaterThan(
          rulesByName.get('Nicol Bolas, Planeswalker')?.fontPx ?? Number.POSITIVE_INFINITY,
        );

        const deckCard = await inspect('Cards in your deck');
        await move(deckCard);
        expect(await state()).toMatchObject({
          count: expect.stringContaining('2 of 2 cards'),
          preview: false,
        });
        await rightClick(deckCard);
        expect(await state()).toMatchObject({
          count: expect.stringContaining('2 of 2 cards'),
          preview: true,
        });
        await click([4, 4], 1);
        expect(await state()).toMatchObject({ preview: false });
        await click(deckCard, 1);
        expect(await state()).toMatchObject({
          count: expect.stringContaining('2 of 2 cards'),
          preview: false,
        });
        await click(deckCard, 2);
        expect(await state()).toMatchObject({ count: expect.stringContaining('1 of 2 cards') });

        const vivien = await inspect('Drafted pool', "Vivien, Monsters' Advocate");
        await move(vivien);
        expect(await state()).toMatchObject({ preview: false });
        await rightClick(vivien);
        const vivienReading = await vivienPreview();
        expect(vivienReading.rows).toBe(4);
        expect(vivienReading.overflowPx, JSON.stringify(vivienReading)).toBe(0);
        expect(vivienReading.fontPx, JSON.stringify(vivienReading)).toBeGreaterThanOrEqual(9.5);
        expect(
          Math.max(vivienReading.blankBeforePx, vivienReading.blankAfterPx),
          JSON.stringify(vivienReading),
        ).toBeLessThanOrEqual(18);
        await move([4, 4]);
        expect(
          await state(),
          'an explicitly opened reading stays pinned while the pointer continues through the pool',
        ).toMatchObject({ preview: true });
        await click([4, 4], 1);
        expect(await state()).toMatchObject({ preview: false });

        const poolCard = await inspect('Drafted pool', 'Jace, the Mind Sculptor');
        await move(poolCard);
        expect(await state()).toMatchObject({ preview: false });
        await rightClick(poolCard);
        const loyalty = await jaceLoyalty();
        expect(loyalty.face.map((badge) => badge.cost)).toEqual(['+2', '0', '−1', '−12']);
        expect(loyalty.preview.map((badge) => badge.cost)).toEqual(['+2', '0', '−1', '−12']);
        for (const [surface, badges] of Object.entries(loyalty)) {
          for (const badge of badges) {
            expect(
              badge.width,
              `${surface} ${badge.cost} loyalty ground must remain wider than its numeral (${JSON.stringify(loyalty)})`,
            ).toBeGreaterThan(badge.inkWidth + 2);
            expect(
              badge.inkHeight,
              `${surface} ${badge.cost} loyalty numeral must remain readable (${JSON.stringify(loyalty)})`,
            ).toBeGreaterThanOrEqual(7);
          }
        }
        expect(await state()).toMatchObject({
          count: expect.stringContaining('1 of 2 cards'),
          preview: true,
        });
        await click([4, 4], 1);
        expect(await state()).toMatchObject({ preview: false });
        await click(poolCard, 1);
        expect(await state()).toMatchObject({
          count: expect.stringContaining('2 of 2 cards'),
          preview: false,
        });
        await click(poolCard, 2);
        expect(await state()).toMatchObject({ count: expect.stringContaining('2 of 2 cards') });

        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
          sessionId,
        );
        await evaluate(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
        );
        expect(await visibleGroupGap()).toBeGreaterThanOrEqual(7.5);
      } finally {
        if (targetId !== '' && sessionId !== '') {
          await cleanupTarget(chrome.client, targetId, sessionId).catch(() => undefined);
        }
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
