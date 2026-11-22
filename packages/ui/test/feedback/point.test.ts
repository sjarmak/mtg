// @vitest-environment jsdom
/**
 * "Point at it": the description of a clicked element names its path, the
 * nearest surface, its text and its box, and refuses what is not an element.
 */
import { describe, expect, it } from 'vitest';
import { describeElement, isElementLike } from '../../src/feedback/point';
import type { ElementLike } from '../../src/feedback/point';

/**
 * The document, structurally: the workspace tsconfig has no `lib: dom`, so a
 * test reaches jsdom the way `../app.test.ts` does.
 */
interface DocumentLike {
  readonly body: ElementLike & { innerHTML: string };
  getElementById(id: string): ElementLike | null;
  querySelector(selector: string): ElementLike | null;
  createTextNode(text: string): unknown;
}

function doc(): DocumentLike {
  const found = (globalThis as { readonly document?: DocumentLike }).document;
  if (found === undefined) throw new Error('this test needs a jsdom document');
  return found;
}

function built(): ElementLike {
  const document = doc();
  document.body.innerHTML = `
    <div class="mtg-shell" data-mtg-route="play">
      <main class="mtg-shell__main">
        <div class="mtg-live" data-mtg-gameplay="recorded">
          <section class="mtg-hand other-class">
            <button id="end-turn" class="mtg-btn">  End
              turn </button>
            <span>plain</span>
          </section>
        </div>
      </main>
    </div>`;
  const found = document.getElementById('end-turn');
  if (found === null) throw new Error('the fixture has no button');
  return found;
}

describe('describeElement', () => {
  it('walks up to the shell, outermost first, naming ids and mtg- classes', () => {
    const described = describeElement(built());
    expect(described.path).toBe(
      'html > body > div.mtg-shell > main.mtg-shell__main > div.mtg-live > section.mtg-hand > button#end-turn',
    );
    expect(described.text).toBe('End turn');
    expect(described.box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('names the nearest data-mtg-* attribute as the surface, over a class', () => {
    built();
    const span = doc().querySelector('span');
    if (span === null) throw new Error('no span');
    expect(describeElement(span).surface).toBe('mtg-hand');
    const live = doc().querySelector('.mtg-live');
    if (live === null) throw new Error('no live');
    expect(describeElement(live).surface).toBe('data-mtg-gameplay=recorded');
  });

  it('caps the path', () => {
    let markup = '<span id="deep">x</span>';
    for (let depth = 0; depth < 20; depth += 1) markup = `<div>${markup}</div>`;
    doc().body.innerHTML = markup;
    const deep = doc().getElementById('deep');
    if (deep === null) throw new Error('no deep');
    expect(describeElement(deep).path.split(' > ')).toHaveLength(8);
  });

  it('knows an element from a text node or nothing', () => {
    built();
    expect(isElementLike(doc().body)).toBe(true);
    expect(isElementLike(doc().createTextNode('t'))).toBe(false);
    expect(isElementLike(null)).toBe(false);
  });
});
