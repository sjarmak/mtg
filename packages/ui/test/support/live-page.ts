/**
 * One self-contained `file://` page holding a *live* React app.
 *
 * Every other browser rig in this package screenshots server-rendered markup,
 * which is enough for every question about a box and useless for a question
 * about a handler. `mtg-42w` is the second kind: a double click on a castable
 * card opens the staged cast rather than submitting a move, and that branch is
 * six lines of `../../src/routes/play/selection.ts` with no CSS behind it at
 * all. Static markup cannot be asked.
 *
 * Two constraints decide the shape. Headless Chrome in this checkout cannot
 * reach HTTP -- a `Page.navigate` at a loopback server is still unanswered at
 * fifteen seconds -- so the page has to be a file, which means the script has to
 * be inlined rather than fetched. And the app is TypeScript across twelve
 * workspace packages with three aliases behind it, so inlining it means
 * bundling it.
 *
 * The bundle is built through **`packages/ui/vite.config.ts` itself** rather
 * than through a config assembled here, and that is the load-bearing choice. A
 * hand-written config drifts: the first spike of this rig omitted the
 * `node:crypto` alias and failed with `"createHash" is not exported by
 * "__vite-browser-external"`, which is `@mtg/dsl`'s fingerprint module reaching
 * a Node builtin the lab has shimmed since long before this rig existed. A rig
 * that carried its own copy of those three aliases would be green on a page
 * built differently from the page a person opens, which is the same objection
 * `../deck/builder-frame.browser.test.ts` makes about mounting a component
 * outside its route.
 *
 * `rollupOptions.input` is overridden because that config names three HTML
 * pages, and a library build with three inputs is refused outright
 * (`output.inlineDynamicImports` cannot hold multiple inputs). Everything else
 * -- the aliases, the React plugin, the `__MTG_SYMBOL_SET__` substitution --
 * comes from the file the lab uses.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { uiStyleSheet } from '../../src/styles/index';

const VITE_CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

interface BuiltFile {
  readonly type: string;
  readonly code?: string;
}

interface BuiltBundle {
  readonly output?: readonly BuiltFile[];
}

/**
 * The one script an entry compiles to.
 *
 * `formats: ['iife']` because a `file://` page has no module resolution worth
 * relying on, and `write: false` because the artifact is wanted in memory: it
 * goes straight into a `<script>`, and a `dist/` written beside the package
 * would be a build output inside a source tree that nothing cleans up.
 */
async function bundle(entry: string): Promise<string> {
  const built = (await build({
    configFile: VITE_CONFIG,
    logLevel: 'error',
    // React's development build warns into the console and double-invokes under
    // `StrictMode`, which `mount` uses. Neither changes what a gesture submits,
    // and the production build is what a person opening the lab runs.
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'MtgLiveTable', fileName: 'live' },
      rollupOptions: { input: entry },
    },
  })) as BuiltBundle | readonly BuiltBundle[];
  const bundles = Array.isArray(built) ? built : [built as BuiltBundle];
  for (const chunk of bundles) {
    for (const file of chunk.output ?? []) {
      if (file.type === 'chunk' && file.code !== undefined) return file.code;
    }
  }
  throw new Error(`vite built no chunk for ${entry}`);
}

/**
 * A whole document: the lab's stylesheet, a mount point, and the compiled entry.
 *
 * The stylesheet is not decoration here. The rig drives a real mouse at a
 * coordinate, so what is under that coordinate is decided by layout, and an
 * unstyled page stacks every card at the left margin where the top one takes
 * every press.
 */
export async function livePage(entry: string, title: string): Promise<string> {
  const script = await bundle(entry);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style>`,
    '</head><body><div id="root"></div>',
    `<script>${script}</script>`,
    '</body></html>',
  ].join('');
}
