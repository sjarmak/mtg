/** Either printed format kind, told apart by `kind` before anything reads a product or a deck. */
import { z } from 'zod';
import {
  PrintedConstructedFormatSchema,
  serializedPrintedConstructedFormatContent,
} from './constructed-format';
import type { PrintedConstructedFormat } from './constructed-format';
import { PrintedLimitedFormatSchema, serializedPrintedLimitedFormatContent } from './limited-format';
import type { PrintedLimitedFormat } from './limited-format';

export const PrintedFormatSchema = z.discriminatedUnion('kind', [
  PrintedLimitedFormatSchema,
  PrintedConstructedFormatSchema,
]);
export type PrintedFormat = PrintedLimitedFormat | PrintedConstructedFormat;

export function parsePrintedFormat(value: unknown): PrintedFormat {
  return PrintedFormatSchema.parse(value);
}

/** The bytes a format's `contentSha256` covers, whichever kind it is. */
export function serializedPrintedFormatContent(format: PrintedFormat): string {
  return format.kind === 'printed-limited-format'
    ? serializedPrintedLimitedFormatContent(format)
    : serializedPrintedConstructedFormatContent(format);
}
