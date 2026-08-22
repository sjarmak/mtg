import { describe, expect, it } from 'vitest';
import { el, escapeAttr, escapeText, num, styleEl, textEl } from '@mtg/card-render';

describe('num', () => {
  it('trims float noise so a re-render diffs to nothing', () => {
    expect(num(0.1 + 0.2)).toBe('0.3');
    expect(num(26)).toBe('26');
    expect(num(26.5)).toBe('26.5');
  });

  it('never emits negative zero', () => {
    expect(num(-0)).toBe('0');
    expect(num(-0.0001)).toBe('0');
  });

  it('refuses a non-finite number rather than writing "NaN" into a file', () => {
    expect(() => num(Number.NaN)).toThrow(/non-finite/);
    expect(() => num(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });
});

describe('escaping', () => {
  it('escapes markup characters in text', () => {
    expect(escapeText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('escapes both quote characters in attributes', () => {
    expect(escapeAttr(`Kaervek's "Torch"`)).toBe('Kaervek&apos;s &quot;Torch&quot;');
  });

  it('carries an apostrophe in a card name through unbroken', () => {
    const markup = textEl('text', { 'aria-label': "its owner's hand" }, "Return to its owner's hand.");
    expect(markup).toContain('aria-label="its owner&apos;s hand"');
    expect(markup).toContain(">Return to its owner's hand.<");
  });
});

describe('el', () => {
  it('self-closes an element with no children', () => {
    expect(el('rect', { x: 1, y: 2 })).toBe('<rect x="1" y="2" />');
  });

  it('drops null and undefined attributes entirely', () => {
    expect(el('g', { a: null, b: undefined, c: 'x' })).toBe('<g c="x" />');
  });

  it('drops false and prints true', () => {
    expect(el('g', { a: false, b: true })).toBe('<g b="true" />');
  });

  it('nests already-serialized children', () => {
    expect(el('g', {}, [el('rect', { x: 0 })])).toBe('<g><rect x="0" /></g>');
  });
});

describe('styleEl', () => {
  it('wraps CSS in CDATA so a selector never needs escaping', () => {
    expect(styleEl(".a[data-x='y'] { fill: red; }")).toContain('<![CDATA[');
  });

  it('refuses content that would close the CDATA section', () => {
    expect(() => styleEl('a { content: "]]>"; }')).toThrow(/\]\]>/);
  });
});
