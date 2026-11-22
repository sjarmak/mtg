/** Installed-Forge outcomes for the exact copied-spell retarget cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;
type ChainRoute = 'decline' | 'keep' | 'retarget';
type MaliciousRoute = 'decline' | 'keep' | 'retarget';

function chainTable(route: ChainRoute): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Chain Lightning caster',
        controller: 'local',
        deck: {
          name: `z5q4-chain-lightning-${route}-caster`,
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Chain Lightning', count: 30 },
          ],
        },
      },
      {
        name: 'Chain Lightning payer',
        controller: 'local',
        deck: {
          name: `z5q4-chain-lightning-${route}-payer`,
          cards: [
            { name: 'Mountain', count: 50 },
            { name: 'Goblin Guide', count: 10 },
          ],
        },
      },
    ],
    seed: `z5q4-chain-lightning-${route}-outcomes`,
    maximumTurns: 18,
  };
}

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
      option.id === 'combat-blockers-commit',
  )?.id;
}

async function runChainLightning(route: ChainRoute): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let castStarted = false;
  let reciprocalPaymentAsked = false;
  let copyTargetAsked = false;
  let inventedRejected = false;
  let staleRejected = false;
  let outcome = false;
  try {
    const spec = chainTable(route);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;

    for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Chain Lightning decision');
      const caster = session.view.seats[0];
      const payer = session.view.seats[1];
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      if (
        reciprocalPaymentAsked &&
        (route === 'decline' || copyTargetAsked) &&
        session.view.stack.length === 0
      ) {
        outcome =
          route === 'decline'
            ? caster.life === 20 && payer.life === 17
            : route === 'keep'
              ? caster.life === 20 && payer.life === 14
              : caster.life === 17 && payer.life === 17;
      }

      let move: string | undefined;
      if (decision.kind === 'priority') {
        const cast =
          decision.seat === 0 &&
          !castStarted &&
          caster.battlefield.some((card) => card.name === 'Mountain' && !card.tapped) &&
          payer.battlefield.filter((card) => card.name === 'Mountain' && !card.tapped).length >= 2
            ? decision.options.find((option) => option.text.startsWith('Chain Lightning:'))
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          cast?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (cast !== undefined && move === cast.id) castStarted = true;
      } else if (decision.kind === 'target-selection' && decision.seat === 0 && castStarted) {
        move = decision.options.find((option) => option.id === 'target-player-1')?.id;
      } else if (decision.kind === 'mana-payment') {
        if (decision.seat === 1 && payer.life === 17) {
          reciprocalPaymentAsked = true;
          move = decision.options.find((option) =>
            route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
          )?.id;
        } else if (decision.seat === 0 && copyTargetAsked) {
          move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
        } else {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        }
      } else if (decision.kind === 'copy-target-selection') {
        copyTargetAsked = true;
        expect(decision.seat, trace.at(-1)).toBe(1);
        expect(
          decision.options.some((option) => option.id === 'copy-target-keep'),
          trace.at(-1),
        ).toBe(true);
        expect(
          decision.options.some((option) => option.id === 'copy-target-player-0'),
          trace.at(-1),
        ).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('copy-target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        move =
          route === 'keep'
            ? 'copy-target-keep'
            : decision.options.find((option) => option.id === 'copy-target-player-0')?.id;
        if (move === undefined) throw new Error('Forge offered no reviewed copy target');
        const stale = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        await expect(stale.submit(move)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else {
        move = routineMove(decision);
      }

      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Chain Lightning move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castStarted, evidence).toBe(true);
    expect(reciprocalPaymentAsked, evidence).toBe(true);
    expect(copyTargetAsked, evidence).toBe(route !== 'decline');
    expect(inventedRejected, evidence).toBe(route !== 'decline');
    expect(staleRejected, evidence).toBe(route !== 'decline');
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

for (const route of ['decline', 'keep', 'retarget'] as const) {
  forgeIt(
    `runs Chain Lightning's exact ${route} copied-spell route`,
    async () => {
      await runChainLightning(route);
    },
    200_000,
  );
}

function maliciousTable(route: MaliciousRoute): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Malicious Affliction caster',
        controller: 'local',
        deck: {
          name: `z5q4-malicious-affliction-${route}-caster`,
          cards: [
            { name: 'Swamp', count: 36 },
            { name: 'Doom Blade', count: 12 },
            { name: 'Malicious Affliction', count: 12 },
          ],
        },
      },
      {
        name: 'Morbid target builder',
        controller: 'local',
        deck: {
          name: `z5q4-malicious-affliction-${route}-targets`,
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Llanowar Elves', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-malicious-affliction-${route}-outcomes`,
    maximumTurns: 24,
  };
}

async function runMaliciousAffliction(route: MaliciousRoute): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let doomCast = false;
  let doomTargetOid: string | undefined;
  let maliciousCast = false;
  let maliciousTargetOid: string | undefined;
  let copyTargetOid: string | undefined;
  let triggerAnswered = false;
  let copyTargetAsked = false;
  let inventedRejected = false;
  let staleRejected = false;
  let outcome = false;
  try {
    const spec = maliciousTable(route);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;

    for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Malicious Affliction decision');
      const caster = session.view.seats[0];
      const targetBuilder = session.view.seats[1];
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      if (maliciousCast && triggerAnswered && session.view.stack.length === 0) {
        const doomDestroyed = targetBuilder.graveyard.some((card) => card.oid === doomTargetOid);
        const originalDestroyed = targetBuilder.graveyard.some((card) => card.oid === maliciousTargetOid);
        const retargetDestroyed =
          route !== 'retarget' || targetBuilder.graveyard.some((card) => card.oid === copyTargetOid);
        outcome = doomDestroyed && originalDestroyed && retargetDestroyed;
      }

      let move: string | undefined;
      if (decision.kind === 'priority') {
        const untappedSwamps = caster.battlefield.filter(
          (card) => card.name === 'Swamp' && !card.tapped,
        ).length;
        const liveElves = targetBuilder.battlefield.filter((card) => card.name === 'Llanowar Elves');
        const doomResolved =
          doomTargetOid !== undefined && targetBuilder.graveyard.some((card) => card.oid === doomTargetOid);
        const castDoom =
          decision.seat === 0 && !doomCast && untappedSwamps >= 4 && liveElves.length >= 3
            ? decision.options.find((option) => option.text.startsWith('Doom Blade:'))
            : undefined;
        const castMalicious =
          decision.seat === 0 &&
          doomResolved &&
          !maliciousCast &&
          untappedSwamps >= 2 &&
          liveElves.length >= 2
            ? decision.options.find((option) => option.text.startsWith('Malicious Affliction:'))
            : undefined;
        const playLand =
          decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Swamp')
            : decision.options.find((option) => option.text === 'Play Forest');
        const castElf =
          decision.seat === 1 &&
          targetBuilder.battlefield.some((card) => card.name === 'Forest' && !card.tapped)
            ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          playLand?.id ??
          castMalicious?.id ??
          castDoom?.id ??
          castElf?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (castDoom !== undefined && move === castDoom.id) doomCast = true;
        if (castMalicious !== undefined && move === castMalicious.id) maliciousCast = true;
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        const candidates = decision.options.filter((option) => option.targets.length === 1);
        if (!maliciousCast) {
          const selected = candidates[0];
          doomTargetOid = selected?.targets[0]?.oid;
          move = selected?.id;
        } else {
          const selected = candidates.find((option) => option.targets[0]?.oid !== doomTargetOid);
          maliciousTargetOid = selected?.targets[0]?.oid;
          move = selected?.id;
        }
      } else if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Malicious Affliction:')) {
        triggerAnswered = true;
        move = decision.options.find((option) =>
          route === 'decline' ? option.id === 'confirm-trigger-no' : option.id === 'confirm-trigger-yes',
        )?.id;
      } else if (decision.kind === 'copy-target-selection') {
        copyTargetAsked = true;
        expect(decision.seat, trace.at(-1)).toBe(0);
        const liveElfOids = targetBuilder.battlefield
          .filter((card) => card.name === 'Llanowar Elves')
          .map((card) => card.oid)
          .sort();
        expect(
          decision.options
            .filter((option) => option.id.startsWith('copy-target-card-'))
            .map((option) => option.targets[0]?.oid)
            .sort(),
          trace.at(-1),
        ).toEqual(liveElfOids);
        expect(decision.options.some((option) => option.id.startsWith('copy-target-player-'))).toBe(false);
        if (!inventedRejected) {
          await expect(session.submit('copy-target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        const selected =
          route === 'keep'
            ? decision.options.find((option) => option.id === 'copy-target-keep')
            : decision.options.find(
                (option) =>
                  option.id.startsWith('copy-target-card-') && option.targets[0]?.oid !== maliciousTargetOid,
              );
        move = selected?.id;
        copyTargetOid = route === 'keep' ? maliciousTargetOid : selected?.targets[0]?.oid;
        if (move === undefined) throw new Error('Forge offered no exact Malicious Affliction copy target');
        const stale = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        await expect(stale.submit(move)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else {
        move = routineMove(decision);
      }

      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Malicious Affliction move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(doomTargetOid, evidence).toMatch(/^forge-card-/u);
    expect(maliciousTargetOid, evidence).toMatch(/^forge-card-/u);
    expect(triggerAnswered, evidence).toBe(true);
    expect(copyTargetAsked, evidence).toBe(route !== 'decline');
    expect(inventedRejected, evidence).toBe(route !== 'decline');
    expect(staleRejected, evidence).toBe(route !== 'decline');
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-340).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

for (const route of ['decline', 'keep', 'retarget'] as const) {
  forgeIt(
    `runs Malicious Affliction's exact ${route} morbid-copy route`,
    async () => {
      await runMaliciousAffliction(route);
    },
    200_000,
  );
}
