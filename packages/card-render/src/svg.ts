/**
 * A very small SVG serializer.
 *
 * Not a DOM and not a template string: attributes go through one escaper and
 * numbers through one formatter, so an apostrophe in a card name (`Kaervek's`)
 * or a float with seventeen digits of noise cannot produce a malformed or
 * non-deterministic file. Determinism matters here for the same reason it
 * matters for the set file — two runs over the same set must diff to nothing,
 * or nobody will review a re-render.
 */

/** Attribute values: `null` and `undefined` drop the attribute entirely. */
export type AttrValue = string | number | boolean | null | undefined;

export type Attrs = Readonly<Record<string, AttrValue>>;

const DECIMALS = 3;

/** Formats a number for an SVG attribute: fixed precision, no trailing zeros. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`svg: non-finite number ${String(value)}`);
  const fixed = value.toFixed(DECIMALS);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** Escapes text content. `&`, `<` and `>` only; attributes use `escapeAttr`. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes an attribute value, including both quote characters. */
export function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function serializeAttrs(attrs: Attrs): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(`${name}="true"`);
      continue;
    }
    const text = typeof value === 'number' ? num(value) : value;
    parts.push(`${name}="${escapeAttr(text)}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/** An element with children. Children are already-serialized markup. */
export function el(tag: string, attrs: Attrs, children: readonly string[] = []): string {
  const open = `<${tag}${serializeAttrs(attrs)}`;
  if (children.length === 0) return `${open} />`;
  return `${open}>${children.join('')}</${tag}>`;
}

/** An element whose only child is escaped text. */
export function textEl(tag: string, attrs: Attrs, content: string): string {
  return `<${tag}${serializeAttrs(attrs)}>${escapeText(content)}</${tag}>`;
}

/** A `<style>` block. CSS is not escaped; it is wrapped in CDATA instead. */
export function styleEl(css: string): string {
  if (css.includes(']]>')) throw new Error('svg: style content cannot contain "]]>"');
  return `<style><![CDATA[${css}]]></style>`;
}

/** Indents a serialized document by newline-separating top-level children. */
export function joinLines(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('\n');
}
