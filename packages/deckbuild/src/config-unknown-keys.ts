/**
 * The boundary check that makes a misspelled config a failure rather than a
 * result.
 *
 * `resolveConfig` reads its input key by key, so a key it does not read is
 * simply never read. That is the dangerous shape of silence: a silently ignored
 * input does not produce an error or an odd number, it produces exactly the
 * answer a null result looks like. `mtg-5923` records the run that proved it —
 * a balance-attribution sweep passed `{ formatMedianRounds: 999 }` to neutralize
 * a landed builder change, that key lives on `CardScoreWeights` rather than at
 * the top level, and six seeds came back byte-identical. Read at face value the
 * commit under test did nothing. Passed as `{ weights: { formatMedianRounds:
 * 999 } }` the same commit moves the pinned reading by 0.0055.
 *
 * So the message matters as much as the refusal. A key that exists somewhere
 * else in the config is named with its real path, because that was the actual
 * mistake and a bare "unknown key" would have sent the reader looking for a
 * typo they did not make.
 *
 * Every declared key set here is DERIVED from the runtime default the merge
 * reads, or from the `@mtg/dsl` vocabulary the merge enumerates. Nothing is
 * a literal list. A gate whose subject list is hardcoded reports on the list
 * rather than on the tree, and this repo has been bitten by that twice; here
 * it would be worse than a stale report, because a new weight would be
 * rejected by the check that exists to protect it.
 */
import type { AnyEffectKind, KeywordAbility } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_SCOPES,
  KEYWORD_ABILITY_KINDS,
  KEYWORDS,
  STATIC_SCOPES,
  TRIGGER_CONDITIONS,
} from '@mtg/dsl';
import { CURVE_BUCKETS } from './curve-bucket';
import {
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_KEYWORD_ABILITY_VALUE,
  DEFAULT_MANA_BASE_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
} from './config';

/** The keys one object in the config declares, addressed by its dotted path. */
interface DeclaredLevel {
  /** Dotted path from the config root; `''` is the root object itself. */
  readonly path: string;
  readonly keys: readonly string[];
}

const effectWeightKeys = (): readonly string[] => {
  const sample = ALL_EFFECT_KINDS[0];
  return sample === undefined ? [] : Object.keys(DEFAULT_SCORE_WEIGHTS.effectValue[sample]);
};

const keywordAbilityWeightKeys = (): readonly string[] => {
  const sample = KEYWORD_ABILITY_KINDS[0];
  return sample === undefined ? [] : Object.keys(DEFAULT_KEYWORD_ABILITY_VALUE[sample]);
};

/**
 * Every object the config accepts, with the keys it declares.
 *
 * The per-primitive records are two levels rather than one: the record's own
 * keys are the vocabulary (`effectValue.drawCards`), and each row is a shape
 * with its own keys (`effectValue.drawCards.perUnit`). Both are addressable,
 * so both are checked; a row that states `perunit` is the same class of
 * mistake as a top-level key that belongs on `weights`.
 */
const declaredLevels = (): readonly DeclaredLevel[] => {
  const rows: DeclaredLevel[] = [
    { path: '', keys: Object.keys(DEFAULT_DECK_BUILD_CONFIG) },
    { path: 'targetCurve', keys: CURVE_BUCKETS.map((bucket) => String(bucket)) },
    { path: 'manaBase', keys: Object.keys(DEFAULT_MANA_BASE_CONFIG) },
    { path: 'weights', keys: Object.keys(DEFAULT_SCORE_WEIGHTS) },
    { path: 'weights.keywordBase', keys: KEYWORDS },
    { path: 'weights.keywordPowerScale', keys: KEYWORDS },
    { path: 'weights.staticScopeReach', keys: STATIC_SCOPES },
    { path: 'weights.effectScopeReach', keys: EFFECT_SCOPES },
    { path: 'weights.triggerFireCount', keys: TRIGGER_CONDITIONS },
    { path: 'weights.effectValue', keys: ALL_EFFECT_KINDS },
    { path: 'weights.keywordAbilityValue', keys: KEYWORD_ABILITY_KINDS },
  ];
  for (const kind of ALL_EFFECT_KINDS) {
    rows.push({ path: `weights.effectValue.${kind}`, keys: effectWeightKeys() });
  }
  for (const kind of KEYWORD_ABILITY_KINDS) {
    rows.push({ path: `weights.keywordAbilityValue.${kind}`, keys: keywordAbilityWeightKeys() });
  }
  return rows;
};

/**
 * The index, built once on first use rather than at module evaluation.
 *
 * `config.ts` imports this module and this module reads `config.ts`'s default
 * objects, which is a cycle. It is a safe one only while nothing here runs
 * before both modules have finished evaluating, so the tables are built inside
 * the first call instead of beside the imports.
 */
interface KeyIndex {
  readonly byPath: ReadonlyMap<string, DeclaredLevel>;
  readonly byKey: ReadonlyMap<string, readonly string[]>;
}

let index: KeyIndex | null = null;

function keyIndex(): KeyIndex {
  if (index !== null) return index;
  const levels = declaredLevels();
  const byKey = new Map<string, string[]>();
  for (const level of levels) {
    for (const key of level.keys) {
      const address = level.path === '' ? key : `${level.path}.${key}`;
      const existing = byKey.get(key);
      if (existing === undefined) byKey.set(key, [address]);
      else existing.push(address);
    }
  }
  index = { byPath: new Map(levels.map((level) => [level.path, level])), byKey };
  return index;
}

/** Standard edit distance, iterative and allocation-light; the tables are small. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/**
 * What to say after naming the offending key.
 *
 * A key declared elsewhere is reported at its real path first, because that is
 * the mistake `mtg-5923` was filed for and it is not a typo at all. Only when
 * the name exists nowhere does this fall back to the nearest declared key at
 * the level the caller wrote it, and only when that key is close enough that
 * naming it is a hint rather than a guess.
 */
function suggestion(key: string, level: DeclaredLevel): string {
  const elsewhere = keyIndex()
    .byKey.get(key)
    ?.filter((address) => address !== (level.path === '' ? key : `${level.path}.${key}`));
  if (elsewhere !== undefined && elsewhere.length > 0) {
    return `; it is declared at ${elsewhere.map((address) => `\`${address}\``).join(' and ')}`;
  }
  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of level.keys) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance < best) {
      best = distance;
      nearest = candidate;
    }
  }
  if (nearest === null || best > Math.max(2, Math.floor(key.length / 3))) {
    return '; no key of that name exists anywhere in the config';
  }
  return `; the nearest declared key here is \`${nearest}\``;
}

function walk(value: unknown, path: string, found: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const level = keyIndex().byPath.get(path);
  if (level === undefined) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!level.keys.includes(key as AnyEffectKind & KeywordAbility['kind'] & string)) {
      const address = path === '' ? key : `${path}.${key}`;
      found.push(`\`${address}\`${suggestion(key, level)}`);
      continue;
    }
    walk(entry, path === '' ? key : `${path}.${key}`, found);
  }
}

/**
 * Throws when the input names a key the config does not declare.
 *
 * Every offending key is reported, not just the first: a config written from
 * the wrong mental model usually gets more than one key wrong the same way, and
 * fixing them one error at a time is how a reader concludes the second one was
 * accepted.
 */
export function checkUnknownConfigKeys(input: unknown): void {
  const found: string[] = [];
  walk(input, '', found);
  if (found.length === 0) return;
  const label = found.length === 1 ? 'key' : 'keys';
  throw new Error(
    `deckBuild config: unrecognized ${label} ${found.join(', ')}. An ignored key produces the answer a null result looks like, so it is refused here.`,
  );
}
