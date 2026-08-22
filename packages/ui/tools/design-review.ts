/**
 * Writes the proof sheet: one self-contained HTML file holding every card in a
 * set as a real face, for a reviewer who is not on this machine.
 *
 * Node-only, like everything under `tools/`. It opens no browser and starts no
 * server; the reviewer is handed the file. Every input is named on the command
 * line and every one of them is printed on the way through, because the failure
 * this tool is most likely to have is reviewing the wrong build silently —
 * `frame-review.ts` had exactly that bug, and the fix there was to say the
 * resolved path out loud on every run including the default.
 *
 * The art arrives pre-encoded rather than read from disk here: the source
 * illustrations are multi-megabyte PNGs and a page with 280 of them inlined is
 * not a page. Producing the thumbnails is an image-processing job with no image
 * library in this workspace, so the encoder is a separate step that hands this
 * tool a map of card id to data URI. That keeps the size decision (dimensions,
 * quality, format) outside a tool whose job is layout.
 *
 *   npx tsx packages/ui/tools/design-review.ts \
 *     --set packages/setgen/fixtures/sets/<set>.set.json \
 *     --thumbs <thumbs>.json --changes <changes>.json --out out/review/<set>.html
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readChanges, readDesignReviewArgs, readThumbs } from './design-review-args';
import { reviewPage } from './design-review-page';

const args = readDesignReviewArgs(process.argv.slice(2));
if (typeof args === 'string') {
  console.error(args);
  process.exit(1);
}

console.log(`set      ${resolve(args.set)}`);
console.log(`thumbs   ${resolve(args.thumbs)}`);
console.log(
  `changes  ${args.changes === undefined ? '(none given, the round-two panel is empty)' : resolve(args.changes)}`,
);

const document: unknown = JSON.parse(readFileSync(args.set, 'utf8'));
const thumbs = readThumbs(JSON.parse(readFileSync(args.thumbs, 'utf8')), args.thumbs);
const changes =
  args.changes === undefined ? [] : readChanges(JSON.parse(readFileSync(args.changes, 'utf8')), args.changes);

const setName =
  args.setName ??
  (typeof document === 'object' && document !== null && 'set' in document
    ? (((document as { set?: { name?: unknown } }).set?.name as string | undefined) ?? 'This set')
    : 'This set');

const html = reviewPage({
  title: args.title ?? `${setName} Proof Sheet`,
  setName,
  document,
  thumbs,
  changes,
});

mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(args.out, html, 'utf8');
const megabytes = statSync(args.out).size / 1024 / 1024;
console.log(`wrote ${resolve(args.out)} (${megabytes.toFixed(2)} MB, ${String(thumbs.size)} illustrations)`);
if (megabytes > 15) {
  console.error(`that is over the 16 MB an artifact may be; re-encode the thumbnails smaller`);
  process.exit(1);
}
