/**
 * Forge card-script grammar primitives.
 *
 * A Forge card script is a line-oriented property file. Each line is
 * `Key:value`; ability lines further split their value on ` | ` into
 * `Param$ value` pairs (verified against `res/cardsfolder` in Forge 2.0.14,
 * e.g. `A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3`).
 *
 * Two characters are therefore structural and can never appear inside a
 * value we emit: a newline (ends the line) and `|` (ends the parameter).
 */

/** A single `Param$ value` pair on an ability line. */
export type ForgeParam = readonly [key: string, value: string];

/** One Forge ability: an effect-API name plus its ordered parameters. */
export interface ForgeAbility {
  /** Forge `ApiType`, e.g. `DealDamage`, `Pump`, `ChangeZone`. */
  readonly api: string;
  readonly params: readonly ForgeParam[];
}

/** Characters that would break the line/pipe grammar if embedded in a value. */
const UNSAFE_SCRIPT_CHARS = /[\r\n|]/;

/** True when `text` can be embedded in a script value without breaking parsing. */
export function isScriptSafe(text: string): boolean {
  return !UNSAFE_SCRIPT_CHARS.test(text);
}

/**
 * Renders card text for a single-line field. Forge writes multi-line oracle
 * text as a literal backslash-n escape (verified in `cardsfolder`), so real
 * newlines are encoded rather than rejected.
 */
export function escapeNewlines(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\\n');
}

/** `SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3` — the spell-ability form. */
export function renderSpellAbility(ability: ForgeAbility): string {
  return renderAbility('SP$', ability);
}

/**
 * `AB$ DealDamage | Cost$ 1 T | ValidTgts$ Any | NumDmg$ 1` — the activated
 * form. `AB$` rather than `SP$` is the whole of the difference in Forge's
 * grammar between "this is what the card does when it resolves" and "this is
 * what a player may pay for while it is on the battlefield".
 */
export function renderActivatedAbility(ability: ForgeAbility): string {
  return renderAbility('AB$', ability);
}

/** `DB$ GainLife | LifeAmount$ 2` — the sub-ability form used inside `SVar:`. */
export function renderSubAbility(ability: ForgeAbility): string {
  return renderAbility('DB$', ability);
}

/**
 * `Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1` — the body of an
 * `S:` line. A static ability names a mode rather than an effect API, so it does
 * not go through `renderAbility`.
 */
export function renderStaticAbility(abilityParams: readonly ForgeParam[]): string {
  return renderModeAbility('Continuous', abilityParams);
}

/**
 * The same `S:` body under a mode that is not `Continuous`.
 *
 * Forge splits what one printed sentence says across modes: a P/T change is
 * `Mode$ Continuous` and names `Affected$`, while a combat restriction is
 * `Mode$ CantAttack,CantBlock` and names `ValidCard$`. `Cast into Darkness`
 * ships as both lines at once for the single sentence "Enchanted creature gets
 * -2/-0 and can't block.", so a card whose clause mixes the two kinds writes
 * two `S:` lines rather than one, and the mode is what varies between them.
 */
export function renderModeAbility(mode: string, abilityParams: readonly ForgeParam[]): string {
  const parts = [`Mode$ ${mode}`, ...abilityParams.map(([key, value]) => `${key}$ ${value}`)];
  return parts.join(' | ');
}

function renderAbility(prefix: string, ability: ForgeAbility): string {
  const parts = [`${prefix} ${ability.api}`, ...ability.params.map(([key, value]) => `${key}$ ${value}`)];
  return parts.join(' | ');
}

/** Appends parameters, dropping any whose value is `undefined`. */
export function params(
  ...entries: ReadonlyArray<readonly [string, string | undefined]>
): readonly ForgeParam[] {
  const kept: ForgeParam[] = [];
  for (const [key, value] of entries) {
    if (value !== undefined) kept.push([key, value]);
  }
  return kept;
}
