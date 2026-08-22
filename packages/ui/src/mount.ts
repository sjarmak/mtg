/**
 * Mounting, kept behind a narrow interface.
 *
 * The workspace tsconfig has no `lib: dom` (packages carry no tsconfig of their
 * own, and adding DOM globally would collide with `@types/node`'s `fetch`,
 * `Event` and friends). So the two DOM facts this package needs — "there is a
 * document" and "it can find an element by id" — are declared structurally
 * here, checked at runtime, and never assumed.
 */
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';

/** Structural stand-in for an `Element`: enough to identify a mount point. */
export interface MountTarget {
  readonly nodeType: number;
}

interface DocumentLike {
  getElementById(id: string): MountTarget | null;
}

interface BrowserWindow {
  readonly document: DocumentLike;
}

function browserWindow(): BrowserWindow | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as { readonly document?: unknown };
  const doc = partial.document;
  if (typeof doc !== 'object' || doc === null) return null;
  if (typeof (doc as Partial<DocumentLike>).getElementById !== 'function') return null;
  return candidate as BrowserWindow;
}

export interface MountedApp {
  unmount(): void;
}

/** Renders `node` into `#id`. Throws with a specific reason when it cannot. */
export function mount(elementId: string, node: ReactNode): MountedApp {
  const win = browserWindow();
  if (win === null) throw new Error('mount() needs a browser document; this host has no window');
  const target = win.document.getElementById(elementId);
  if (target === null) throw new Error(`mount target #${elementId} is not in the document`);
  const root = createRoot(target as unknown as Parameters<typeof createRoot>[0]);
  root.render(createElement(StrictMode, null, node));
  return {
    unmount: () => {
      root.unmount();
    },
  };
}
