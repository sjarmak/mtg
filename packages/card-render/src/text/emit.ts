/**
 * Emitting a measured run of text.
 *
 * Every `<text>` this package writes goes through here, and every one of them
 * carries `textLength` with `lengthAdjust="spacing"`. That is the belt to the
 * metrics table's braces: the table says how wide the run *should* be, and
 * `textLength` tells the renderer to make it exactly that wide by adjusting
 * inter-glyph spacing rather than by running off the edge of the box.
 *
 * `spacing` and not `spacingAndGlyphs` is deliberate. Spacing adjustment moves
 * glyphs; glyph adjustment stretches them. If a viewer resolves a font wider
 * than anything the table was measured against, tight tracking is a fair price
 * and squashed letterforms are not.
 */
import type { Attrs } from '../svg';
import { textEl } from '../svg';
import { measureText } from './metrics';

export interface TextRunAttrs {
  readonly className: string;
  readonly x: number;
  /** Baseline y. */
  readonly y: number;
  readonly fontSize: number;
  readonly anchor?: 'start' | 'middle' | 'end';
  readonly boldFactor?: number;
  readonly widthSafety?: number;
  /**
   * Width to set the run to. Defaults to the measured width; pass a larger
   * value to track a label out, and the run still cannot exceed it.
   */
  readonly width?: number;
  readonly extra?: Attrs;
}

/** A `<text>` element pinned to a measured width. Empty text renders nothing. */
export function textRun(text: string, attrs: TextRunAttrs): string {
  if (text.length === 0) return '';
  const measured = measureText(text, {
    fontSize: attrs.fontSize,
    ...(attrs.boldFactor === undefined ? {} : { boldFactor: attrs.boldFactor }),
    ...(attrs.widthSafety === undefined ? {} : { widthSafety: attrs.widthSafety }),
  });
  const width = attrs.width ?? measured;
  return textEl(
    'text',
    {
      class: attrs.className,
      x: attrs.x,
      y: attrs.y,
      'font-size': attrs.fontSize,
      ...(attrs.anchor === undefined ? {} : { 'text-anchor': attrs.anchor }),
      textLength: width,
      lengthAdjust: 'spacing',
      ...(attrs.extra ?? {}),
    },
    text,
  );
}
