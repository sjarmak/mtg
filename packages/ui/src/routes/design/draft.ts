/**
 * The brief being written, as the page holds it.
 *
 * `mtg-yddw.2`. A draft is not a `SetBrief` and this type is not a copy of that
 * schema. `SetBrief` is what `@mtg/setgen` accepts, and the whole point of the
 * split is that a draft is *invalid most of the time it is being written* —
 * every field starts empty, a mechanic exists before it names a keyword, and a
 * required card is typed a letter at a time. A page that held only legal briefs
 * could not hold a brief anybody was still writing.
 *
 * So the rule this file follows: **every field is a string or a list, nothing is
 * optional, and nothing is parsed here.** A number the schema wants is kept as
 * the text somebody typed, because `targetSize: ''` and `targetSize: 0` are
 * different states and only one of them is "has not said yet". Turning the draft
 * into the JSON the server judges is `briefFrom` below, and it is the *only*
 * place that decides what an empty field means.
 *
 * There is deliberately no validation in this module. `@mtg/setgen`'s schema is
 * the judge, it reaches `@mtg/design-data`, and that package reads its canon off
 * disk at import time — so it cannot run here at all, and a second opinion
 * written here would be a second answer to what a legal brief is. The editor
 * shows the server's refusals and has none of its own.
 */

/** One desired mechanic, as typed. */
export interface MechanicDraft {
  readonly name: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly effectKinds: readonly string[];
  readonly abilityKinds: readonly string[];
  readonly triggerConditions: readonly string[];
  readonly colors: readonly string[];
}

/** One card the set must contain, as typed. Every narrowing field may be blank. */
export interface RequiredCardDraft {
  readonly name: string;
  /** A pool, a card kind, a rarity: `''` is "any", which is what omitting it means. */
  readonly color: string;
  readonly cardKind: string;
  readonly rarity: string;
  /**
   * The rarity the pin derivation may relax to, below the stated one.
   *
   * `''` is "no ceiling", which the schema reads as the rarity itself: a card
   * seated where it was designed. Stating one is how a brief says "print this as
   * a mythic, and seat it in the common slot if that is what fits".
   */
  readonly seatCeiling: string;
  readonly manaValue: string;
  readonly flavorDirection: string;
  readonly equipment: boolean;
  readonly legendary: boolean;
  readonly partCounter: string;
  readonly sacrificeSubtype: string;
  readonly suppliesSubtype: string;
}

/** One tier's stated spell roles. */
export interface SpellRolesDraft {
  readonly rarity: string;
  readonly pool: string;
  readonly roles: readonly string[];
  readonly why: string;
}

/** One color's signature: the subjects this set decides that color does not print. */
export interface SignatureDraft {
  readonly color: string;
  readonly absent: readonly string[];
}

export interface BriefDraft {
  readonly setCode: string;
  readonly setName: string;
  readonly theme: string;
  readonly seed: string;
  readonly targetSize: string;
  readonly tertiaryBudget: string;
  readonly mechanics: readonly MechanicDraft[];
  readonly archetypeNotes: readonly string[];
  readonly requiredCards: readonly RequiredCardDraft[];
  readonly spellRoles: readonly SpellRolesDraft[];
  readonly colorSignatures: readonly SignatureDraft[];
}

export const EMPTY_MECHANIC: MechanicDraft = {
  name: '',
  description: '',
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  triggerConditions: [],
  colors: [],
};

export const EMPTY_REQUIRED_CARD: RequiredCardDraft = {
  name: '',
  color: '',
  cardKind: '',
  rarity: '',
  seatCeiling: '',
  manaValue: '',
  flavorDirection: '',
  equipment: false,
  legendary: false,
  partCounter: '',
  sacrificeSubtype: '',
  suppliesSubtype: '',
};

/**
 * A new brief, with one empty mechanic already in it.
 *
 * One rather than none, because the schema's floor is one and an editor that
 * opens on an empty list makes a person press Add before they can type anything.
 * The size is left blank rather than pre-filled with the default: a number
 * somebody did not choose, shown in a box they can edit, reads as a decision
 * they made. The server reports the default it applied instead.
 */
export function blankDraft(): BriefDraft {
  return {
    setCode: '',
    setName: '',
    theme: '',
    seed: '',
    targetSize: '',
    tertiaryBudget: '',
    mechanics: [EMPTY_MECHANIC],
    archetypeNotes: [],
    requiredCards: [],
    spellRoles: [],
    colorSignatures: [],
  };
}

/** A trimmed string, or undefined when the box was left empty. */
function stated(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A typed number, or undefined when the box is empty.
 *
 * Text that is not a number at all goes through as text, not as `NaN` and not
 * dropped. The schema refuses it and names the field, which is the message a
 * person needs; silently omitting it would show a different refusal (`required`)
 * about the same keystroke, and silently sending `NaN` would send something that
 * is not JSON.
 */
function statedNumber(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function withoutUndefined(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/**
 * The draft as the JSON the server judges.
 *
 * Blank narrowing fields are *omitted* rather than sent as `''`, because the
 * schema reads an absent field as "any pool will do" and an empty string as a
 * pool that does not exist. That is the one semantic decision in this file, and
 * it is here rather than in each panel so a new field cannot make it differently.
 */
export function briefFrom(draft: BriefDraft): Record<string, unknown> {
  return withoutUndefined({
    setCode: draft.setCode.trim(),
    setName: draft.setName.trim(),
    theme: draft.theme.trim(),
    seed: draft.seed.trim(),
    targetSize: statedNumber(draft.targetSize),
    tertiaryBudget: statedNumber(draft.tertiaryBudget),
    mechanics: draft.mechanics.map((mechanic) => ({
      name: mechanic.name.trim(),
      description: mechanic.description.trim(),
      keywords: [...mechanic.keywords],
      effectKinds: [...mechanic.effectKinds],
      abilityKinds: [...mechanic.abilityKinds],
      triggerConditions: [...mechanic.triggerConditions],
      colors: [...mechanic.colors],
    })),
    archetypeNotes: draft.archetypeNotes.map((note) => note.trim()).filter((note) => note !== ''),
    requiredCards: draft.requiredCards.map((card) =>
      withoutUndefined({
        name: card.name.trim(),
        color: stated(card.color),
        cardKind: stated(card.cardKind),
        rarity: stated(card.rarity),
        seatCeiling: stated(card.seatCeiling),
        manaValue: statedNumber(card.manaValue),
        flavorDirection: stated(card.flavorDirection),
        equipment: card.equipment,
        legendary: card.legendary,
        partCounter: stated(card.partCounter),
        sacrificeSubtype: stated(card.sacrificeSubtype),
        suppliesSubtype: stated(card.suppliesSubtype),
      }),
    ),
    spellRoles: draft.spellRoles.map((tier) => ({
      rarity: tier.rarity,
      pool: tier.pool,
      roles: [...tier.roles],
      why: tier.why.trim(),
    })),
    colorSignatures: draft.colorSignatures.map((signature) => ({
      color: signature.color,
      absent: [...signature.absent],
    })),
  });
}

/** The brief as the file a person keeps, which is what the box on screen holds. */
export function briefJson(draft: BriefDraft): string {
  return `${JSON.stringify(briefFrom(draft), null, 2)}\n`;
}

/** The file name an exported brief lands under: the set's own code, lowercased. */
export function briefFileName(draft: BriefDraft): string {
  const code = draft.setCode.trim().toLowerCase();
  return `${code === '' ? 'brief' : code}.json`;
}
