/**
 * Expanding a JSON Schema's internal `$ref`s back into the tree they name.
 *
 * This exists to keep one number from being two things. `toJsonSchema` emits
 * `$defs` plus `$ref` rather than inlining a reused subschema, because the
 * `claude-cli` transport passes the schema on argv and Linux caps a single argv
 * entry at 128 KiB: the DSL effect union alone inlines to 773 KB and refuses to
 * go on the wire at all. But a fixture is keyed by `hash(system, prompt,
 * schema)`, and a key that moves when the *encoding* of an unchanged contract
 * changes would orphan every recording in the tree for no semantic reason —
 * 180 of them, across five corpora, none of which asked a different question
 * afterwards.
 *
 * So the wire gets the compact form and the key gets the expanded one. The
 * expansion is a pure function of the compact form, so the key is still a pure
 * function of the request; it is just a function of what the request *means*
 * rather than of how zod chose to spell it this release.
 *
 * ## Cycles
 *
 * A recursive schema cannot be expanded, and zod emits a `$ref` for one whether
 * or not reuse-refs were asked for. A `$ref` already on the expansion stack is
 * therefore left exactly as it is, which is both the only terminating choice and
 * the one that reproduces what the inlining mode itself produced.
 */
import type { JsonSchema } from './types';

const DEFS_KEYS = ['$defs', 'definitions'] as const;
const REF_PREFIXES = DEFS_KEYS.map((key) => `#/${key}/`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `$defs` name a local `$ref` points at, or undefined for anything else. */
function localRefName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  for (const prefix of REF_PREFIXES) {
    if (value.startsWith(prefix)) {
      const name = value.slice(prefix.length);
      // A pointer into a nested member is not a definition reference; leaving it
      // alone is safer than guessing which segment names the definition.
      return name.length > 0 && !name.includes('/') ? name : undefined;
    }
  }
  return undefined;
}

function collectDefs(schema: Record<string, unknown>): Map<string, unknown> {
  const defs = new Map<string, unknown>();
  for (const key of DEFS_KEYS) {
    const block = schema[key];
    if (!isRecord(block)) continue;
    for (const [name, value] of Object.entries(block)) defs.set(name, value);
  }
  return defs;
}

function expand(node: unknown, defs: Map<string, unknown>, open: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => expand(item, defs, open));
  if (!isRecord(node)) return node;

  const name = localRefName(node['$ref']);
  if (name !== undefined && defs.has(name) && !open.includes(name)) {
    const target = expand(defs.get(name), defs, [...open, name]);
    const siblings = Object.entries(node).filter(([key]) => key !== '$ref');
    // `$ref` alongside sibling keywords is a 2020-12 annotation, not a
    // replacement: the target expands and the siblings stay on top of it.
    if (siblings.length === 0) return target;
    return { ...(isRecord(target) ? target : {}), ...Object.fromEntries(siblings) };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = expand(value, defs, open);
  }
  return out;
}

/**
 * The schema with every resolvable local `$ref` replaced by what it names, and
 * the `$defs` block that fed them dropped. A `$ref` this cannot resolve — a
 * remote pointer, a cycle, a pointer into a definition's interior — survives
 * untouched, so the result is always a valid schema and never a truncated one.
 */
export function inlineRefs(schema: JsonSchema): JsonSchema {
  const defs = collectDefs(schema);
  if (defs.size === 0) return schema;
  const expanded = expand(schema, defs, []);
  if (!isRecord(expanded)) return schema;
  // The top-level block fed the expansion and has no reader left. A nested one
  // is somebody else's document and is not this function's to drop.
  const out = { ...expanded };
  for (const key of DEFS_KEYS) delete out[key];
  return out;
}
