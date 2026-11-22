/**
 * Regenerates (or checks) `data/forge-effect-controller-calls-v1.json`: the
 * `PlayerController` callbacks each Forge ability effect class calls, read out of
 * the reviewed jar's bytecode. Forge is only ever a subprocess here (`javap`, `unzip`).
 *
 *   npx tsx packages/data/tools/forge-effect-controller-calls.ts --jar <forge jar> --check
 *   npx tsx packages/data/tools/forge-effect-controller-calls.ts --jar <forge jar> --write
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BASE_EFFECT_CLASS,
  EFFECT_PACKAGE,
  FORGE_EFFECT_CONTROLLER_CALLS_PATH,
  GAME_PACKAGE,
  MODE_CLASS_PREFIXES,
  effectClassFamily,
  loadForgeEffectControllerCalls,
  modeClasses,
  parseApiTypeEffects,
  parseJavapClasses,
  type ForgeEffectControllerCalls,
} from '../src/printed-card/forge-effect-controller-calls';
import { loadForgeSyntaxReview } from '../src/printed-card/forge-syntax-review';

const { values } = parseArgs({
  options: {
    jar: { type: 'string' },
    write: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.jar === undefined)
  throw new Error('--jar <forge-gui-desktop-*-jar-with-dependencies.jar> is required');
if (values.write === values.check) throw new Error('pass exactly one of --write and --check');
const jar = resolve(values.jar);

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const javap = (classNames: readonly string[]): string =>
  run('javap', ['-cp', jar, '-p', '-c', '-constants', ...classNames]);

const jarSha256 = createHash('sha256').update(readFileSync(jar)).digest('hex');
const pinned = loadForgeSyntaxReview().forge;
if (jarSha256 !== pinned.jarSha256) {
  throw new Error(
    `jar sha256 ${jarSha256} is not the reviewed jar ${pinned.jarSha256} (Forge ${pinned.version})`,
  );
}

const jarEntries = run('unzip', ['-Z1', jar]).split('\n');
const classNamesUnder = (prefix: string): string[] =>
  jarEntries
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.class'))
    .map((entry) => entry.slice(0, -'.class'.length).replaceAll('/', '.'));
const classes = new Map(
  parseJavapClasses(
    javap([
      ...classNamesUnder(BASE_EFFECT_CLASS),
      ...classNamesUnder(EFFECT_PACKAGE),
      ...MODE_CLASS_PREFIXES.flatMap(classNamesUnder),
    ]),
  ).map((cls) => [cls.name, cls]),
);
const distinctCalls = (family: readonly { readonly controllerCalls: readonly string[] }[]): string[] =>
  [...new Set(family.flatMap((cls) => cls.controllerCalls))].sort();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const baseCalls = distinctCalls(
  [...classes.values()].filter(
    (cls) => cls.name === BASE_EFFECT_CLASS || cls.name.startsWith(`${BASE_EFFECT_CLASS}$`),
  ),
);

const effects: ForgeEffectControllerCalls['effects'] = [
  ...parseApiTypeEffects(javap(['forge.game.ability.ApiType'])),
]
  .sort(([a], [b]) => byText(a, b))
  .map(([apiType, effectClass]) => {
    const family = effectClassFamily(effectClass, classes);
    if (family.length === 0) throw new Error(`${apiType}: effect class ${effectClass} was not in the jar`);
    return {
      apiType,
      effectClass,
      classes: family.map((cls) => cls.name.slice(EFFECT_PACKAGE.length)),
      controllerCalls: distinctCalls(family),
    };
  });

const apiTypes = new Set(effects.map((effect) => effect.apiType));
const modes: ForgeEffectControllerCalls['modes'] = loadForgeSyntaxReview()
  .entries.filter((entry) => entry.kind === 'ability-api' && !apiTypes.has(entry.token))
  .map((entry) => entry.token)
  .sort(byText)
  .map((token) => {
    const family = modeClasses(token, classes);
    return {
      token,
      classes: family.map((cls) => cls.name.slice(GAME_PACKAGE.length)),
      controllerCalls: distinctCalls(family),
    };
  });

const built: ForgeEffectControllerCalls = {
  schemaVersion: 1,
  forge: pinned,
  command: `javap -cp <forge-gui-desktop-${pinned.version}-jar-with-dependencies.jar> -p -c -constants forge.game.ability.ApiType forge.game.ability.SpellAbilityEffect forge.game.ability.effects.* forge.game.trigger.Trigger* forge.game.replacement.Replace* forge.game.staticability.StaticAbility*`,
  baseEffectCalls: baseCalls,
  effects,
  modes,
};
const text = `${JSON.stringify(built, null, 2)}\n`;

if (values.write) {
  writeFileSync(FORGE_EFFECT_CONTROLLER_CALLS_PATH, text);
  process.stdout.write(
    `wrote ${effects.length} effects and ${modes.length} modes to ${FORGE_EFFECT_CONTROLLER_CALLS_PATH}\n`,
  );
} else {
  const committed = JSON.stringify(loadForgeEffectControllerCalls(), null, 2);
  if (committed !== text.trimEnd()) {
    throw new Error(
      'committed forge-effect-controller-calls-v1.json differs from the jar; rerun with --write and review the diff',
    );
  }
  process.stdout.write(
    `forge-effect-controller-calls-v1.json matches the jar (${effects.length} effects, ${modes.length} modes)\n`,
  );
}
