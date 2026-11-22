/**
 * Which `PlayerController` callbacks each Forge ability effect class calls.
 *
 * The shared syntax review table says which decision families an `ability-api`
 * token can raise. Whether it says enough is a question about bytecode: the
 * effect class the token names calls the controller, and each callback belongs
 * to a family. `tools/forge-effect-controller-calls.ts` reads the calls out of
 * the reviewed jar with `javap -c -p` and commits them here as data, so the
 * check that a table entry misses no family runs without the jar.
 *
 * "Calls" means direct calls: the effect class, its nested and anonymous
 * classes, and the effect-package superclasses it extends (lambdas compile into
 * the class that declares them). A callback reached through an engine helper the
 * effect class hands the work to (`GameAction`, `Player`, `CostPayment`) is not
 * in this record; that is why the table's families are a floor the calls must
 * fit inside, never an equality.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';

export const FORGE_EFFECT_CONTROLLER_CALLS_PATH = fileURLToPath(
  new URL('../../data/forge-effect-controller-calls-v1.json', import.meta.url),
);

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const MethodList = z.array(z.string().min(1));

export const ForgeEffectControllerCallsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  forge: z.strictObject({ version: z.string().min(1), jarSha256: Sha256 }),
  /** The one command whose output every row below is read from. */
  command: z.string().min(1),
  /**
   * Callbacks `SpellAbilityEffect`'s shared helpers call (`addToCombat`, `getNewChooser`).
   * An effect reaches them only by calling the helper, which is a call into a class the
   * effect does not own, so they are recorded here and not attributed to any row.
   */
  baseEffectCalls: MethodList,
  effects: z.array(
    z.strictObject({
      apiType: z.string().min(1),
      effectClass: z.string().min(1),
      /** Every class read for this row, in the order the calls were collected. */
      classes: z.array(z.string().min(1)).min(1),
      /** Distinct callback names the classes call, sorted. */
      controllerCalls: MethodList,
    }),
  ),
  /**
   * `ability-api` tokens that name no `ApiType` (trigger modes, static-ability modes,
   * replacement events). `classes` is empty when Forge has no class named after the token.
   */
  modes: z.array(
    z.strictObject({
      token: z.string().min(1),
      classes: z.array(z.string().min(1)),
      controllerCalls: MethodList,
    }),
  ),
});
export type ForgeEffectControllerCalls = z.infer<typeof ForgeEffectControllerCallsSchema>;

export function parseForgeEffectControllerCalls(value: unknown): ForgeEffectControllerCalls {
  const parsed = ForgeEffectControllerCallsSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('Forge effect controller calls', parsed.error.message);
  const seen = new Set<string>();
  for (const key of [
    ...parsed.data.effects.map((effect) => effect.apiType),
    ...parsed.data.modes.map((mode) => mode.token),
  ]) {
    if (seen.has(key))
      throw new InvalidInputError('Forge effect controller calls', `duplicate token: ${key}`);
    seen.add(key);
  }
  return parsed.data;
}

export function loadForgeEffectControllerCalls(
  path: string = FORGE_EFFECT_CONTROLLER_CALLS_PATH,
): ForgeEffectControllerCalls {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Forge effect controller calls',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  return parseForgeEffectControllerCalls(value);
}

export const EFFECT_PACKAGE = 'forge/game/ability/effects/';
/** The class every effect extends; its own calls are reported once, as `baseEffectCalls`. */
export const BASE_EFFECT_CLASS = 'forge/game/ability/SpellAbilityEffect';

/**
 * Reads `ApiType`'s static initializer: each enum constant is built from its name
 * and the effect class it runs, and the two are not related by spelling
 * (`AddOrRemoveCounter` runs `CountersPutOrRemoveEffect`).
 */
export function parseApiTypeEffects(javap: string): ReadonlyMap<string, string> {
  const effects = new Map<string, string>();
  let name: string | undefined;
  let effectClass: string | undefined;
  for (const line of javap.split('\n')) {
    const text = /\/\/ String (\S+)\s*$/u.exec(line);
    if (text?.[1] !== undefined) name = text[1];
    const cls = /\/\/ class (forge\/game\/ability\/effects\/[A-Za-z0-9_$]+)\s*$/u.exec(line);
    if (cls?.[1] !== undefined) effectClass = cls[1].slice(EFFECT_PACKAGE.length);
    if (/invokespecial .*"<init>":\(Ljava\/lang\/String;ILjava\/lang\/Class;\)V/u.test(line)) {
      if (name !== undefined && effectClass !== undefined) effects.set(name, effectClass);
      name = undefined;
      effectClass = undefined;
    }
  }
  return effects;
}

export interface JavapClass {
  /** Slash-separated binary name, `forge/game/ability/effects/DigEffect$1`. */
  readonly name: string;
  readonly superclass: string | undefined;
  /** Distinct `PlayerController` method names this class's bytecode calls. */
  readonly controllerCalls: readonly string[];
}

/** Splits one `javap -p -c` run over many classes into per-class call sets. */
export function parseJavapClasses(javap: string): readonly JavapClass[] {
  const classes: JavapClass[] = [];
  const blocks = javap.split(/^Compiled from /mu).slice(1);
  for (const block of blocks) {
    const header =
      /^[^\n]*\n(?:[a-z]+ )*(?:class|interface|enum) (\S+)(?: extends (\S+?))?(?: implements [^{]*)? \{/u.exec(
        block,
      );
    if (header?.[1] === undefined) continue;
    const calls = new Set<string>();
    for (const call of block.matchAll(
      /\/\/ (?:Interface)?Method forge\/game\/player\/PlayerController\.([A-Za-z0-9_$]+):/gu,
    )) {
      if (call[1] !== undefined) calls.add(call[1]);
    }
    classes.push({
      name: header[1].replaceAll('.', '/'),
      superclass: header[2]?.replaceAll('.', '/'),
      controllerCalls: [...calls].sort(),
    });
  }
  return classes;
}

/**
 * The classes whose calls belong to one effect: the effect, everything nested in
 * it, and each effect-package superclass up the chain. `SpellAbilityEffect` lives
 * outside that package, so the walk stops there on its own.
 */
export function effectClassFamily(
  effectClass: string,
  classes: ReadonlyMap<string, JavapClass>,
): readonly JavapClass[] {
  const family: JavapClass[] = [];
  const seen = new Set<string>();
  const add = (simpleName: string): void => {
    const root = `${EFFECT_PACKAGE}${simpleName}`;
    for (const cls of classes.values()) {
      if (cls.name === root || cls.name.startsWith(`${root}$`)) {
        if (!seen.has(cls.name)) family.push(cls);
        seen.add(cls.name);
      }
    }
    const parent = classes.get(root)?.superclass;
    if (parent !== undefined && parent.startsWith(EFFECT_PACKAGE)) {
      add(parent.slice(EFFECT_PACKAGE.length));
    }
  };
  add(effectClass);
  return family;
}

/** Every class path below sits under this prefix in the jar; rows store the rest. */
export const GAME_PACKAGE = 'forge/game/';

/** The packages whose classes are named after a trigger mode, replacement event or static-ability mode. */
export const MODE_CLASS_PREFIXES = [
  'forge/game/trigger/Trigger',
  'forge/game/replacement/Replace',
  'forge/game/staticability/StaticAbility',
] as const;

/**
 * The classes Forge names after a token that is not an `ApiType`, with everything nested in
 * them. A token can list several modes (`CantAttack,CantBlock`); each is looked up on its own.
 */
export function modeClasses(token: string, classes: ReadonlyMap<string, JavapClass>): readonly JavapClass[] {
  const roots = token.split(',').flatMap((mode) => MODE_CLASS_PREFIXES.map((prefix) => `${prefix}${mode}`));
  return [...classes.values()].filter((cls) =>
    roots.some((root) => cls.name === root || cls.name.startsWith(`${root}$`)),
  );
}
