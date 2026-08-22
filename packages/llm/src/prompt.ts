/**
 * Attempt-prompt composition.
 *
 * The prompt the transport sees is always the caller's prompt plus an explicit
 * output contract, plus — on a retry — the previous attempt's raw output and the
 * exact validation errors it produced. Building it here (rather than in each
 * provider) keeps fixture keys meaningful: the same logical request produces the
 * same bytes on every backend.
 */
import { canonicalJson } from '@mtg/dsl';
import type { AttemptRecord, JsonSchema } from './types';

const RAW_ECHO_LIMIT = 2000;

export interface AttemptPromptInput {
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
  readonly previous: readonly AttemptRecord[];
}

export function buildAttemptPrompt(input: AttemptPromptInput): string {
  const sections = [
    `<task>\n${input.prompt.trim()}\n</task>`,
    outputContract(input.jsonSchema),
    ...input.previous.map(failureSection),
  ];
  return sections.join('\n\n');
}

function outputContract(jsonSchema: JsonSchema): string {
  return [
    '<output_contract>',
    'Return a single JSON value that validates against this JSON Schema:',
    canonicalJson(jsonSchema),
    'Return only that JSON value. No prose, no explanation, no markdown fences.',
    '</output_contract>',
  ].join('\n');
}

function failureSection(record: AttemptRecord): string {
  const issues = record.issues.map((issue) => `- ${issue}`).join('\n');
  return [
    `<rejected_attempt n="${record.attempt}">`,
    'This output was rejected:',
    truncate(record.rawText, RAW_ECHO_LIMIT),
    '',
    'Validation errors:',
    issues,
    '',
    'Fix exactly these errors and return corrected JSON.',
    '</rejected_attempt>',
  ].join('\n');
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (truncated, ${text.length} chars)`;
}
