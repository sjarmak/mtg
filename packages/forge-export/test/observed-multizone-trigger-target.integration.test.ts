/** Installed-Forge outcomes for the exact reviewed multizone and multi-target trigger routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

async function proveVenserTarget(route: 'battlefield' | 'stack'): Promise<void> {
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Venser pilot',
        controller: 'local',
        deck: {
          name: `z5q4-venser-${route}`,
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Venser, Shaper Savant', count: 30 },
          ],
        },
      },
      {
        name: 'Blade pilot',
        controller: 'local',
        deck: {
          name: `z5q4-venser-${route}-target`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Blade Splicer', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-venser-${route}`,
    maximumTurns: 24,
  };
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let bladeCast = false;
  let venserCast = false;
  let targetOid: string | undefined;
  let selected = false;
  let observed = false;
  const trace: string[] = [];
  const responseWindowTrace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing Venser decision');
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const bladeOnStack = session.view.stack.find((card) => card.name === 'Blade Splicer');
      const bladeOnBattlefield = opponent.battlefield.find((card) => card.name === 'Blade Splicer');
      if (route === 'stack') targetOid ??= bladeOnStack?.oid;
      if (route === 'battlefield') targetOid ??= bladeOnBattlefield?.oid;
      observed =
        selected &&
        targetOid !== undefined &&
        opponent.hand?.some((card) => card.oid === targetOid) === true &&
        !opponent.battlefield.some((card) => card.oid === targetOid) &&
        !session.view.stack.some((card) => card.oid === targetOid);
      const traceLine = `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind} stack=[${session.view.stack.map((card) => `${card.oid}:${card.name}`).join(',')}]: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
      trace.push(traceLine);
      if ((bladeCast && !venserCast) || session.view.stack.length > 0) {
        responseWindowTrace.push(traceLine);
      }

      let move: string | undefined;
      if (decision.kind === 'target-selection' && venserCast) {
        const target = decision.options.find((option) => option.targets[0]?.oid === targetOid);
        move = target?.id;
        selected ||= move !== undefined;
      } else if (decision.kind === 'priority') {
        const pilotMana = pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length;
        const opponentMana = opponent.battlefield.filter(
          (card) => card.name === 'Plains' && !card.tapped,
        ).length;
        const venser = decision.options.find((option) => option.text.startsWith('Venser, Shaper Savant:'));
        const blade = decision.options.find((option) => option.text.startsWith('Blade Splicer:'));
        const readyForVenser =
          route === 'stack'
            ? bladeOnStack !== undefined
            : bladeOnBattlefield !== undefined && session.view.stack.length === 0;
        move =
          (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
          (decision.seat === 1 &&
          !bladeCast &&
          opponentMana >= 3 &&
          (route === 'battlefield' || pilotMana >= 4)
            ? blade?.id
            : undefined) ??
          (decision.seat === 0 && readyForVenser && !venserCast && pilotMana >= 4 ? venser?.id : undefined);
        bladeCast ||= move !== undefined && move === blade?.id;
        venserCast ||= move !== undefined && move === venser?.id;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Venser move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `response window:\n${responseWindowTrace.join('\n')}\nlast decisions:\n${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(bladeCast, evidence).toBe(true);
    expect(venserCast, evidence).toBe(true);
    expect(targetOid, evidence).toMatch(/^forge-card-/u);
    expect(selected, evidence).toBe(true);
    expect(observed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt.each(['battlefield', 'stack'] as const)(
  "Venser returns the selected %s object to its owner's hand",
  proveVenserTarget,
  240_000,
);

forgeIt(
  'Ulamog exiles exactly two selected permanents on cast and twenty library cards on attack',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Ulamog pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-ulamog-ceaseless-trigger-target',
            cards: [
              { name: 'Ancient Tomb', count: 30 },
              { name: 'Ulamog, the Ceaseless Hunger', count: 30 },
            ],
          },
        },
        {
          name: 'Exile pilot',
          controller: 'local',
          deck: { name: 'z5q4-ulamog-ceaseless-target', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-ulamog-ceaseless-trigger-target',
      maximumTurns: 24,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let ulamogCast = false;
    const targetOids: string[] = [];
    let castOutcomeObserved = false;
    let attackerAdded = false;
    let attackCommitted = false;
    let libraryBeforeAttack: number | undefined;
    let exileBeforeAttack: number | undefined;
    let attackOutcomeObserved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Ulamog decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        castOutcomeObserved ||=
          targetOids.length === 2 &&
          targetOids.every((oid) => opponent.exile.some((card) => card.oid === oid)) &&
          pilot.battlefield.some((card) => card.name === 'Ulamog, the Ceaseless Hunger') &&
          session.view.stack.length === 0;
        attackOutcomeObserved ||=
          attackCommitted &&
          libraryBeforeAttack !== undefined &&
          exileBeforeAttack !== undefined &&
          opponent.librarySize === libraryBeforeAttack - 20 &&
          opponent.exile.length === exileBeforeAttack + 20 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && ulamogCast && targetOids.length < 2) {
          const target = decision.options.find(
            (option) =>
              option.targets[0]?.name === 'Plains' && !targetOids.includes(option.targets[0]?.oid ?? ''),
          );
          if (target?.targets[0] !== undefined) targetOids.push(target.targets[0].oid);
          move = target?.id;
        } else if (decision.kind === 'combat-attackers') {
          const ulamog = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.some((target) => target.name === 'Ulamog, the Ceaseless Hunger'),
          );
          if (castOutcomeObserved && !attackerAdded && ulamog !== undefined) {
            attackerAdded = true;
            libraryBeforeAttack = opponent.librarySize;
            exileBeforeAttack = opponent.exile.length;
            move = ulamog.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            attackCommitted ||= attackerAdded && move !== undefined;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const tombs = pilot.battlefield.filter(
            (card) => card.name === 'Ancient Tomb' && !card.tapped,
          ).length;
          const ulamog = decision.options.find((option) =>
            option.text.startsWith('Ulamog, the Ceaseless Hunger:'),
          );
          move =
            (attackOutcomeObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Ancient Tomb')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !ulamogCast && tombs >= 5 ? ulamog?.id : undefined);
          ulamogCast ||= move !== undefined && move === ulamog?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ulamog move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(ulamogCast, evidence).toBe(true);
      expect(targetOids).toHaveLength(2);
      expect(new Set(targetOids).size).toBe(2);
      expect(castOutcomeObserved, evidence).toBe(true);
      expect(attackerAdded, evidence).toBe(true);
      expect(attackCommitted, evidence).toBe(true);
      expect(attackOutcomeObserved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);
