/** Read the committed, normalized calibration corpus at a checked boundary. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InvalidInputError } from '../errors';
import { ReferenceCorpusSchema, type ReferenceCorpus } from './schemas';

export const REFERENCE_CORPUS_PATH = fileURLToPath(
  new URL('../../data/reference-sets-v1.json', import.meta.url),
);

export function loadReferenceCorpus(path: string = REFERENCE_CORPUS_PATH): ReferenceCorpus {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'reference corpus',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  const parsed = ReferenceCorpusSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('reference corpus', `${path}: ${parsed.error.message}`);
  return parsed.data;
}
