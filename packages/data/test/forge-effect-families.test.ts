import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_DECISION_FAMILIES,
  loadLegacyCubeDecisionLedger,
} from '../src/legacy-cube/decision-ledger';
import {
  familiesOfCalls,
  loadForgeControllerMethodFamilies,
  parseForgeControllerMethodFamilies,
} from '../src/printed-card/forge-controller-method-families';
import {
  effectClassFamily,
  loadForgeEffectControllerCalls,
  modeClasses,
  parseApiTypeEffects,
  parseForgeEffectControllerCalls,
  parseJavapClasses,
} from '../src/printed-card/forge-effect-controller-calls';
import { loadForgeSyntaxReview } from '../src/printed-card/forge-syntax-review';

const review = loadForgeSyntaxReview();
const calls = loadForgeEffectControllerCalls();
const methods = loadForgeControllerMethodFamilies();
const abilityApi = review.entries.filter((entry) => entry.kind === 'ability-api');

const audited = [
  ...calls.effects.map((effect) => ({ token: effect.apiType, controllerCalls: effect.controllerCalls })),
  ...calls.modes.map((mode) => ({ token: mode.token, controllerCalls: mode.controllerCalls })),
];

describe('ability-api families against the effect classes bytecode', () => {
  it('reads the jar the syntax review table is pinned to', () => {
    expect(calls.forge).toEqual(review.forge);
    expect(methods.forge).toEqual(review.forge);
  });

  it('audits every ability-api entry in the table', () => {
    const auditedTokens = new Set(audited.map((row) => row.token));
    expect(abilityApi.filter((entry) => !auditedTokens.has(entry.token)).map((entry) => entry.token)).toEqual(
      [],
    );
  });

  it('translates every callback an audited class calls', () => {
    const called = new Set([calls.baseEffectCalls, ...audited.map((row) => row.controllerCalls)].flat());
    const translated = new Set(methods.methods.map((row) => row.method));
    expect([...called].filter((method) => !translated.has(method))).toEqual([]);
    expect([...translated].filter((method) => !called.has(method))).toEqual([]);
  });

  it('gives each entry every family its direct callbacks raise', () => {
    const byToken = new Map(abilityApi.map((entry) => [entry.token, entry]));
    const missing = audited.flatMap((row) => {
      const entry = byToken.get(row.token);
      if (entry === undefined) return [];
      return [...familiesOfCalls(row.controllerCalls, methods)]
        .filter((family) => !entry.families.includes(family))
        .map((family) => `${row.token}: ${family}`);
    });
    expect(missing).toEqual([]);
  });

  it('marks an entry mapped exactly when it has families, in canonical order', () => {
    const rank = (family: string): number =>
      LEGACY_CUBE_DECISION_FAMILIES.indexOf(family as (typeof LEGACY_CUBE_DECISION_FAMILIES)[number]);
    for (const entry of abilityApi) {
      expect(entry.disposition === 'mapped', entry.token).toBe(entry.families.length > 0);
      expect(entry.families.map(rank), entry.token).toEqual(
        [...entry.families.map(rank)].sort((a, b) => a - b),
      );
    }
  });

  it('gives DigUntil the ordering its callbacks ask for', () => {
    const digUntil = abilityApi.find((entry) => entry.token === 'DigUntil');
    expect(digUntil?.families).toContain('ordering');
    expect(calls.effects.find((effect) => effect.apiType === 'DigUntil')?.controllerCalls).toContain(
      'orderMoveToZoneList',
    );
  });
});

describe('callback to family translation', () => {
  it('agrees with the Legacy Cube ledger wherever it borrows from it', () => {
    const ledger = loadLegacyCubeDecisionLedger().controllerSurface.abstractCallbacks;
    const named = (signature: string): string => /(\w+)\(/u.exec(signature)?.[1] ?? signature;
    for (const row of methods.methods) {
      const overloads = ledger.filter((callback) => named(callback.signature) === row.method);
      if (row.basis === 'reviewed-here') {
        expect(overloads, `${row.method} is in the ledger, so it should not be reviewed here`).toEqual([]);
        continue;
      }
      expect(overloads.length, row.method).toBeGreaterThan(0);
      for (const overload of overloads) {
        expect(overload.disposition, row.method).toBe(row.disposition);
        expect(overload.families, row.method).toEqual(row.families);
      }
    }
  });

  it('refuses a callback with no row and a decision that names no family', () => {
    expect(() => familiesOfCalls(['invented'], methods)).toThrow(/no translation for callback invented/u);
    const decision = methods.methods.find((row) => row.disposition === 'decision')!;
    expect(() =>
      parseForgeControllerMethodFamilies({ ...methods, methods: [{ ...decision, families: [] }] }),
    ).toThrow(/a decision has families/u);
    expect(() => parseForgeControllerMethodFamilies({ ...methods, methods: [decision, decision] })).toThrow(
      /duplicate method/u,
    );
    const reviewed = methods.methods.find((row) => row.basis === 'reviewed-here')!;
    const { note: _note, ...bare } = reviewed;
    expect(() => parseForgeControllerMethodFamilies({ ...methods, methods: [bare] })).toThrow(
      /carry a note/u,
    );
  });

  it('refuses one token audited twice', () => {
    const effect = calls.effects[0]!;
    expect(() => parseForgeEffectControllerCalls({ ...calls, effects: [effect, effect] })).toThrow(
      /duplicate token/u,
    );
  });
});

const BYTECODE = `Compiled from "DigEffect.java"
public class forge.game.ability.effects.DigEffect extends forge.game.ability.SpellAbilityEffect {
  public void resolve(forge.game.spellability.SpellAbility);
    Code:
       0: aload_1
       1: invokevirtual #4                  // Method forge/game/player/PlayerController.chooseCardsForZoneChange:()V
       2: invokeinterface #5                // InterfaceMethod forge/game/player/PlayerController.confirmAction:()V
       3: invokevirtual #6                  // Method forge/game/player/Player.getController:()V
}
Compiled from "DigEffect.java"
class forge.game.ability.effects.DigEffect$1 implements java.util.function.Function {
  Code:
       0: invokevirtual #7                  // Method forge/game/player/PlayerController.orderMoveToZoneList:()V
}
Compiled from "DigUntilEffect.java"
public class forge.game.ability.effects.DigUntilEffect extends forge.game.ability.effects.DigEffect {
}
Compiled from "TriggerChangesZone.java"
public class forge.game.trigger.TriggerChangesZone extends forge.game.trigger.Trigger {
  Code:
       0: invokevirtual #8                  // Method forge/game/player/PlayerController.vote:()V
}
Compiled from "ReplaceDraw.java"
public class forge.game.replacement.ReplaceDraw extends forge.game.replacement.ReplacementEffect {
}
`;

describe('javap parsing', () => {
  const classes = new Map(parseJavapClasses(BYTECODE).map((cls) => [cls.name, cls]));

  it('splits classes and keeps only PlayerController calls', () => {
    expect(classes.get('forge/game/ability/effects/DigEffect')?.controllerCalls).toEqual([
      'chooseCardsForZoneChange',
      'confirmAction',
    ]);
    expect(classes.get('forge/game/ability/effects/DigEffect$1')?.superclass).toBeUndefined();
    expect(classes.get('forge/game/ability/effects/DigUntilEffect')?.superclass).toBe(
      'forge/game/ability/effects/DigEffect',
    );
  });

  it('collects an effect with its nested classes and effect-package superclasses', () => {
    const names = effectClassFamily('DigUntilEffect', classes).map((cls) => cls.name);
    expect(names).toEqual([
      'forge/game/ability/effects/DigUntilEffect',
      'forge/game/ability/effects/DigEffect',
      'forge/game/ability/effects/DigEffect$1',
    ]);
  });

  it('finds a mode class by token, splitting a token that lists several modes', () => {
    expect(modeClasses('ChangesZone', classes).map((cls) => cls.name)).toEqual([
      'forge/game/trigger/TriggerChangesZone',
    ]);
    expect(modeClasses('ChangesZone,Draw', classes).map((cls) => cls.name)).toEqual([
      'forge/game/trigger/TriggerChangesZone',
      'forge/game/replacement/ReplaceDraw',
    ]);
    expect(modeClasses('NoSuchMode', classes)).toEqual([]);
  });

  it('reads the class an api type runs from the enum initializer', () => {
    const initializer = `
       0: ldc           #2                  // String AddOrRemoveCounter
       2: iconst_0
       3: ldc           #3                  // class forge/game/ability/effects/CountersPutOrRemoveEffect
       5: invokespecial #4                  // Method "<init>":(Ljava/lang/String;ILjava/lang/Class;)V
       8: ldc           #5                  // String Draw
      10: ldc           #6                  // class forge/game/ability/effects/DrawEffect
      12: invokespecial #4                  // Method "<init>":(Ljava/lang/String;ILjava/lang/Class;)V
`;
    expect([...parseApiTypeEffects(initializer)]).toEqual([
      ['AddOrRemoveCounter', 'CountersPutOrRemoveEffect'],
      ['Draw', 'DrawEffect'],
    ]);
  });
});
