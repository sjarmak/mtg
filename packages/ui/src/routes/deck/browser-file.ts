/**
 * Handing a file to the person, and taking one back, through a browser that may
 * refuse to do either without saying so.
 *
 * Two of `../../../AGENTS.md`'s standing constraints meet here and both of them
 * fail quietly rather than loudly, which is why this is a module of its own
 * instead of six lines inside a component.
 *
 * # There is no `lib: dom`
 *
 * The workspace tsconfig is `lib: ["ES2023"], types: ["node"]`, so `document`,
 * `HTMLAnchorElement` and `File` are not types this package may name. Every one
 * of them is reached through a narrow structural interface that is runtime
 * checked before it is used, the way `../../app/router.ts` reaches the hash.
 *
 * # A page-initiated download reports nothing
 *
 * The DOM offers a page one way to hand somebody a file: an anchor carrying a
 * `download`, clicked by the page itself. That click returns `undefined`
 * whether the file reached the disk or the browser discarded the request. There
 * is no exception to catch, no promise to reject and no event to wait for, so
 * *no* implementation of this function can report success, in any browser.
 *
 * The environment sharpens that rather than causing it. `../../app/router.ts`
 * records why the app is a hash router: the built page is a static file that
 * works from `file://`, because these pages get opened straight out of an
 * `out/` run directory, and a download started from that origin is one a
 * browser is entitled to refuse. A headless run refuses it by default, and so
 * does a window with downloads switched off. Which browsers refuse it here has
 * not been measured, and nothing below depends on the answer: the point is that
 * the page cannot find out.
 *
 * So `saveTextFile` returns whether the browser was **asked**, which is the most
 * any code here can know, and its caller must never say "saved". The
 * surface that calls it keeps the whole text on screen, selectable, at all
 * times: the file is a convenience laid over a route that always works, rather
 * than the route. A caller that hides the text behind a download button has
 * moved the failure back into the silence this module exists to describe.
 */

/** What a saved file is offered as: an anchor that can be given a name and clicked. */
interface AnchorLike {
  download: string;
  href: string;
  click(): void;
}

interface DocumentLike {
  createElement(tag: string): unknown;
}

function documentLike(): DocumentLike | null {
  const host = globalThis as { readonly document?: unknown };
  const found = host.document;
  if (typeof found !== 'object' || found === null) return null;
  const partial = found as { createElement?: unknown };
  if (typeof partial.createElement !== 'function') return null;
  return found as DocumentLike;
}

/**
 * Asks the browser to save some text under a name.
 *
 * True means the click was dispatched, not that a file arrived; see the
 * docblock. False means the browser has no anchor with a `download` on it, or
 * threw on the way, and no file will arrive at all.
 *
 * A `data:` URL rather than a `Blob` and an object URL: a decklist is a couple
 * of kilobytes, and the blob route adds a second global to structurally type, a
 * revoke to remember and a lifetime to get wrong for no gain at this size.
 */
export function saveTextFile(name: string, text: string): boolean {
  const host = documentLike();
  if (host === null) return false;
  let made: unknown;
  try {
    made = host.createElement('a');
  } catch {
    return false;
  }
  if (typeof made !== 'object' || made === null) return false;
  const partial = made as { download?: unknown; click?: unknown };
  if (typeof partial.download !== 'string' || typeof partial.click !== 'function') return false;
  const anchor = made as AnchorLike;
  try {
    anchor.download = name;
    anchor.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    anchor.click();
    return true;
  } catch {
    return false;
  }
}

/** One file out of an `<input type="file">`, as much of it as this module needs. */
export interface PickedFile {
  readonly name: string;
  text(): Promise<string>;
}

/**
 * The first file in whatever an input's `files` turned out to be, or null.
 *
 * Structural all the way down, because `FileList` is a DOM type this package may
 * not name and because the value arrives from an event handler React types as
 * `unknown` here. A picker that was canceled hands back an empty list, which is
 * the same null as no list at all: in both cases nothing was chosen.
 */
export function pickedFile(files: unknown): PickedFile | null {
  if (typeof files !== 'object' || files === null) return null;
  const list = files as { readonly length?: unknown; readonly [index: number]: unknown };
  if (typeof list.length !== 'number' || list.length < 1) return null;
  const first = list[0];
  if (typeof first !== 'object' || first === null) return null;
  const partial = first as { name?: unknown; text?: unknown };
  if (typeof partial.name !== 'string' || typeof partial.text !== 'function') return null;
  return first as PickedFile;
}
