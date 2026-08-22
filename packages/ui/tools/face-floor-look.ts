/**
 * The two pages a person actually opens, written out so they can be looked at.
 *
 * `face-floor.ts` deals a stated board because a measurement has to ask the same
 * question of both routes. This one deals nothing: it is a *real recorded game*
 * from `stage-replay.ts`'s own pinned seeds, and a *real sealed pool* opened
 * from the set on the command line, which is what `npm run play` puts in front
 * of you. Numbers come off the rig; this is for reading the cards.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/face-floor-look.ts out/face-floor-look \
 *       out/XMP/set.json out/art/xmp-variants/art.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayRoute } from '../src/routes/PlayRoute';
import { ReplayViewer, readEventLog } from '../src/routes/replay';
import { uiStyleSheet } from '../src/styles/index';
import { recordGame, writeEventLog } from './record-replay';
import { LAB_GAMES } from './stage-replay';

const out = process.argv[2];
const named = process.argv[3];
if (out === undefined || named === undefined) {
  throw new Error('face-floor-look.ts <out-dir> <set.json> [art.json]');
}
const setPath: string = named;
const artPath = process.argv[4];

const CARDS: readonly DslCard[] = ((): readonly DslCard[] => {
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) throw new Error(`${setPath} has no "cards" array`);
  return parseCards(listed);
})();

const ART: ArtResolver | null = ((): ArtResolver | null => {
  if (artPath === undefined) return null;
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
})();

function page(title: string, markup: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head><body data-set="${basename(setPath)}">${markup}</body></html>
`;
}

mkdirSync(out, { recursive: true });

// The replay, on the first of the three games `npm run play` records, at a step
// deep enough that both boards have permanents on them.
const first = LAB_GAMES[0];
if (first === undefined) throw new Error('stage-replay records no games');
const log = readEventLog(writeEventLog('face-floor-look', [recordGame(first)]));
const game = log.games[0];
if (game === undefined) throw new Error('the recorded log has no game');
const seq = Math.min(Math.floor(game.steps.length * 0.7), game.steps.length - 1);
writeFileSync(
  join(out, 'replay-recorded.html'),
  page(
    'the replay, on a real recorded game',
    renderToStaticMarkup(
      h(Shell, { mode: 'replay', onSelectMode: () => undefined, children: null }, [
        h(ReplayViewer, {
          key: 'viewer',
          state: { status: 'ready', log },
          route: { mode: 'replay', params: { game: '0', seq: String(seq) } },
          onSetParams: () => undefined,
          ...(ART === null ? {} : { artFor: ART }),
        }),
      ]),
    ),
  ),
  'utf8',
);
console.log(
  `wrote ${join(out, 'replay-recorded.html')} at step ${String(seq)} of ${String(game.steps.length)}`,
);

// The sealed game, on the set named on the command line.
writeFileSync(
  join(out, 'play-sealed.html'),
  page(
    'a sealed game on the named set',
    renderToStaticMarkup(
      h(Shell, { mode: 'play', onSelectMode: () => undefined, children: null }, [
        h(PlayRoute, {
          key: 'play',
          set: { status: 'ready', cards: CARDS },
          seed: 'tools/face-floor-look/sealed',
          ...(ART === null ? {} : { artFor: ART }),
        }),
      ]),
    ),
  ),
  'utf8',
);
console.log(`wrote ${join(out, 'play-sealed.html')}`);
