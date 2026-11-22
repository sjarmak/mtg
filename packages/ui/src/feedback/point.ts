/**
 * Describing the thing somebody clicked, so a bead can say which button.
 *
 * `mtg-fvuyq.2`'s "point at it". The description is a path of tags with their
 * ids and classes, outermost first and capped, the nearest ancestor that names
 * a surface, the element's own text and its box. No DOM type is named: the
 * workspace tsconfig has no `lib: dom` (`../mount.ts` records why), so the
 * element is the four members this needs, declared structurally and checked
 * where the click arrives.
 */
import type { PointedElement } from './wire';

export interface ElementLike {
  readonly tagName: string;
  readonly id: string;
  readonly className: unknown;
  readonly parentElement: ElementLike | null;
  readonly textContent: string | null;
  getAttributeNames(): readonly string[];
  getAttribute(name: string): string | null;
  getBoundingClientRect(): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** How many ancestors a path names; a card in a hand is six deep from the shell. */
const PATH_DEPTH = 8;

/** The one class carrying the `mtg-` prefix, if any: the sheets name surfaces that way. */
function surfaceClass(element: ElementLike): string | null {
  if (typeof element.className !== 'string') return null;
  const found = element.className.split(/\s+/).find((name) => name.startsWith('mtg-'));
  return found ?? null;
}

function segment(element: ElementLike): string {
  const tag = element.tagName.toLowerCase();
  if (element.id !== '') return `${tag}#${element.id}`;
  const surface = surfaceClass(element);
  return surface === null ? tag : `${tag}.${surface}`;
}

/** The nearest `data-mtg-*` attribute or `mtg-` class, walking up from the element itself. */
function nearestSurface(element: ElementLike): string | null {
  for (let at: ElementLike | null = element; at !== null; at = at.parentElement) {
    const data = at.getAttributeNames().find((name) => name.startsWith('data-mtg-'));
    if (data !== undefined) return `${data}=${at.getAttribute(data) ?? ''}`;
    const surface = surfaceClass(at);
    if (surface !== null) return surface;
  }
  return null;
}

export function describeElement(element: ElementLike): PointedElement {
  const segments: string[] = [];
  for (
    let at: ElementLike | null = element;
    at !== null && segments.length < PATH_DEPTH;
    at = at.parentElement
  ) {
    segments.unshift(segment(at));
  }
  const box = element.getBoundingClientRect();
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    path: segments.join(' > '),
    surface: nearestSurface(element),
    text,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

/** Whether a click target is an element this can describe. */
export function isElementLike(value: unknown): value is ElementLike {
  if (typeof value !== 'object' || value === null) return false;
  const partial = value as Partial<ElementLike>;
  return (
    typeof partial.tagName === 'string' &&
    typeof partial.id === 'string' &&
    typeof partial.getAttributeNames === 'function' &&
    typeof partial.getAttribute === 'function' &&
    typeof partial.getBoundingClientRect === 'function'
  );
}
