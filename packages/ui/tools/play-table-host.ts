/**
 * A component to render `playTable` from, for the rigs that are not an app.
 *
 * `mtg-uvey`. `../src/routes/play/table.ts`'s `playTable` reads as a builder --
 * it takes an input object and returns an element -- but it is a component body:
 * since `6a046473` it calls `useKeptRing`, which is `useRef` and
 * `useLayoutEffect`. React's dispatcher is only live while a component is being
 * rendered, so calling it at module scope throws
 * `Cannot read properties of null (reading 'useRef')` on the first hook, and the
 * four measuring rigs under this directory that did exactly that all stopped
 * writing pages the day that commit landed. Nothing ran them, so nothing said so.
 *
 * The substitution a rig makes here is none: the table it measures is the shipped
 * one, rendered the way an app renders it. What changes is only *where* the call
 * happens, which is the whole fix.
 *
 * `useLayoutEffect` does not run under `renderToStaticMarkup`, silently, and that
 * is correct for a static page: the ring keeper's whole job is to hand focus back
 * after a commit, and a rig commits nothing.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import type { TableInput } from '../src/routes/play/table';
import { playTable } from '../src/routes/play/table';

function PlayTableHost({ input }: { readonly input: TableInput }): ReactElement {
  return playTable(input);
}

/** `playTable`'s element, in a component the renderer will call it from. */
export function playTableHost(input: TableInput): ReactElement {
  return h(PlayTableHost, { input });
}
