/**
 * The tolerant JSON extractor: models wrap JSON in prose or fences more often
 * than we would like, and a provider has to read what came back anyway.
 *
 * The canonical serializer that used to sit beside it is `@mtg/dsl`'s
 * `canonicalJson`, which `schema.ts` and `prompt.ts` import directly. This
 * package declared a second copy until mtg-bc2.135 measured the two identical
 * over every recorded fixture in the checkout.
 */

export type JsonExtraction =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

const FENCE = /^```(?:json|jsonc|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/**
 * Pull a JSON value out of model output: bare JSON, a fenced block, or JSON
 * embedded in surrounding prose. Never throws — failures come back as `ok: false`
 * so the retry loop can feed the reason to the next attempt.
 */
export function extractJsonValue(text: string): JsonExtraction {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'response was empty' };

  const fenced = FENCE.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;

  const direct = tryParse(body);
  if (direct.ok) return direct;

  const sliced = sliceBalanced(body);
  if (sliced === null) {
    return { ok: false, reason: `response was not JSON: ${direct.reason}` };
  }
  const embedded = tryParse(sliced);
  if (embedded.ok) return embedded;
  return { ok: false, reason: `response was not JSON: ${embedded.reason}` };
}

function tryParse(text: string): JsonExtraction {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** First balanced `{…}` or `[…]` region, respecting string literals and escapes. */
function sliceBalanced(text: string): string | null {
  const start = firstStructuralIndex(text);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function firstStructuralIndex(text: string): number {
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  if (brace < 0) return bracket;
  if (bracket < 0) return brace;
  return Math.min(brace, bracket);
}
