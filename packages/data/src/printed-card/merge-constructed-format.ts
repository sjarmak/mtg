import { createHash } from 'node:crypto';
import {
  PrintedConstructedFormatSchema,
  serializedPrintedConstructedFormatContent,
  type PrintedConstructedFormat,
} from '@mtg/printed-card';

export interface MergePrintedConstructedFormatsOptions {
  readonly id: string;
  readonly name: string;
}

export function mergePrintedConstructedFormats(
  formats: readonly PrintedConstructedFormat[],
  options: MergePrintedConstructedFormatsOptions,
): PrintedConstructedFormat {
  if (formats.length === 0) throw new Error('No printed-constructed formats to merge');
  const [first, ...rest] = formats;
  for (const format of rest) {
    if (
      format.rules.variant !== first!.rules.variant ||
      format.rules.startingLife !== first!.rules.startingLife
    ) {
      throw new Error(`${format.id} and ${first!.id} state different table rules`);
    }
  }
  const unsealed = PrintedConstructedFormatSchema.parse({
    schemaVersion: 1,
    kind: 'printed-constructed-format',
    id: options.id,
    name: options.name,
    sources: formats.flatMap((format) => format.sources),
    rules: first!.rules,
    decks: formats.flatMap((format) => format.decks),
    contentSha256: '0'.repeat(64),
  });
  return PrintedConstructedFormatSchema.parse({
    ...unsealed,
    contentSha256: createHash('sha256')
      .update(serializedPrintedConstructedFormatContent(unsealed))
      .digest('hex'),
  });
}
