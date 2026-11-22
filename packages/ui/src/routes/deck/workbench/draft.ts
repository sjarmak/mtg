/**
 * What the form holds while somebody is typing, and how it becomes criteria.
 *
 * The draft is looser than the criteria on purpose. A person mid-keystroke has
 * `2` in the size box on the way to `24`, and a draft typed as `number` would
 * either refuse that or silently snap it. So every numeric field is a string
 * here and is converted once, at the edge, and a box that cannot be read as a
 * number is left for the server to refuse by name rather than dropped.
 *
 * The blank string is a real value and means **not stated**, which is not the
 * same as zero. Half the fields on this form are criteria the model decides when
 * nobody states them — the land count says so in `@mtg/decklab`'s own schema,
 * and the curve, the mana-value ceiling and the archetype work the same way — so
 * a blank box has to survive being blank all the way to the request, where the
 * field is simply absent.
 */
import type { Criteria } from './client';

export interface WorkbenchDraft {
  readonly prompt: string;
  readonly sets: readonly string[];
  readonly colors: readonly string[];
  readonly size: string;
  readonly landCount: string;
  readonly maxCopies: string;
  readonly archetype: string;
  readonly themes: string;
  readonly maxManaValue: string;
  readonly powerBand: string;
  /** JSON because each member has an identity, population share, and free-text strategy. */
  readonly opponentPopulation: string;
}

/**
 * A blank form, with the two fields that have real defaults filled in.
 *
 * Sixty cards and four copies are the constructed defaults `@mtg/decklab`
 * already applies, and they are shown rather than left blank because a person
 * reading an empty size box cannot tell whether the deck will be 40, 60 or 100.
 * Everything else starts empty, because everything else is a judgment the model
 * makes when nobody states it, and a prefilled guess would read as a decision
 * somebody made.
 */
export const EMPTY_DRAFT: WorkbenchDraft = {
  prompt: '',
  sets: [],
  colors: [],
  size: '60',
  landCount: '',
  maxCopies: '4',
  archetype: '',
  themes: '',
  maxManaValue: '',
  powerBand: '',
  opponentPopulation: '',
};

/** The draft that would rebuild an existing variation: its criteria, back in boxes. */
export function draftOf(criteria: Criteria): WorkbenchDraft {
  return {
    prompt: criteria.prompt,
    sets: criteria.sets,
    colors: criteria.colors,
    size: String(criteria.size),
    landCount: criteria.landCount === undefined ? '' : String(criteria.landCount),
    maxCopies: String(criteria.maxCopies),
    archetype: criteria.archetype ?? '',
    themes: criteria.themes.join(', '),
    maxManaValue: criteria.maxManaValue === undefined ? '' : String(criteria.maxManaValue),
    powerBand: criteria.powerBand ?? '',
    opponentPopulation:
      criteria.opponentPopulation === undefined ? '' : JSON.stringify(criteria.opponentPopulation, null, 2),
  };
}

/**
 * A number, or the field's absence, or the unreadable string itself.
 *
 * The third case is what keeps the server the only judge of a bad value: `abc`
 * in the size box is handed on as `abc` and comes back refused at `/size`, next
 * to the box. Converting it to `NaN` here would produce "expected number,
 * received nan" pointing at the same place with none of the person's input in
 * it, and dropping it would silently build a 60-card deck for somebody who
 * asked for something else.
 */
function numeric(raw: string): number | string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : trimmed;
}

/** A field included only when it was stated, so an absence never becomes a value. */
function stated(raw: string): { readonly value: string } | undefined {
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : { value: trimmed };
}

/** Parse JSON mechanically; preserve invalid input so the server can refuse it at the field. */
function jsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

/**
 * The draft as the server reads it.
 *
 * Deliberately typed loose. This is the payload of a POST that is validated on
 * arrival, and pretending here that it already satisfies `Criteria` would mean
 * this function had to decide what an unreadable size box means — which is the
 * judgment that belongs to the one validator, on the other side.
 */
export function toCriteriaRequest(draft: WorkbenchDraft): Record<string, unknown> {
  const themes = draft.themes
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const archetype = stated(draft.archetype);
  const powerBand = stated(draft.powerBand);
  const landCount = numeric(draft.landCount);
  const maxManaValue = numeric(draft.maxManaValue);
  const opponentPopulation = jsonValue(draft.opponentPopulation);

  return {
    prompt: draft.prompt.trim(),
    sets: draft.sets,
    colors: draft.colors,
    size: numeric(draft.size) ?? 60,
    maxCopies: numeric(draft.maxCopies) ?? 4,
    themes,
    ...(landCount === undefined ? {} : { landCount }),
    ...(maxManaValue === undefined ? {} : { maxManaValue }),
    ...(archetype === undefined ? {} : { archetype: archetype.value }),
    ...(powerBand === undefined ? {} : { powerBand: powerBand.value }),
    ...(opponentPopulation === undefined ? {} : { opponentPopulation }),
  };
}

/**
 * A name for the variation, from what the person asked for.
 *
 * Offered rather than imposed: the name box is prefilled with this and stays
 * editable, because a shelf of variations all called "a fast white deck" is a
 * shelf nobody can read, and the person renaming them is the one who knows what
 * changed between two builds.
 */
export function suggestedName(draft: WorkbenchDraft): string {
  const words = draft.prompt
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return 'untitled';
  return words.slice(0, 6).join(' ');
}
