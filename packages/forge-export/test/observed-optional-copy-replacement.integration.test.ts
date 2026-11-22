/** Installed-Forge board proof for the exact Glasspool Mimic and Phyrexian Metamorph scripts. */
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
      option.id === 'combat-blockers-commit',
  )?.id;
}

function untapped(session: ObservedSession, seat: number, name: string): number {
  return session.view.seats[seat]!.battlefield.filter((card) => card.name === name && !card.tapped).length;
}

function glasspoolCopyTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Glasspool pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-glasspool-copy',
          cards: [
            { name: 'Tundra', count: 30 },
            { name: 'Wall of Omens', count: 15 },
            { name: 'Glasspool Mimic', count: 15 },
          ],
        },
      },
      {
        name: 'Glasspool opponent',
        controller: 'local',
        deck: {
          name: 'z5q4-glasspool-opponent',
          cards: [
            { name: 'Plains', count: 40 },
            { name: 'Wall of Omens', count: 20 },
          ],
        },
      },
    ],
    seed: 'z5q4-glasspool-copy-outcomes',
    maximumTurns: 18,
  };
}

async function proveGlasspoolCopy(accept: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = glasspoolCopyTable();
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let mimicOid: string | undefined;
  let localWallOid: string | undefined;
  let opposingWallOid: string | undefined;
  let confirmed = false;
  let selected = false;
  let inventedRejected = false;
  let staleRejected = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Glasspool copy decision');
      const pilot = session.view.seats[0]!;
      const opponent = session.view.seats[1]!;
      const localWallCount = pilot.battlefield.filter((card) => card.name === 'Wall of Omens').length;
      localWallOid ??= pilot.battlefield.find((card) => card.name === 'Wall of Omens')?.oid;
      opposingWallOid ??= opponent.battlefield.find((card) => card.name === 'Wall of Omens')?.oid;
      const copied =
        mimicOid === undefined ? undefined : pilot.battlefield.find((card) => card.oid === mimicOid);
      const declined = mimicOid !== undefined && pilot.graveyard.some((card) => card.oid === mimicOid);
      const outcome = accept ? copied !== undefined : declined;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move = routineMove(decision);
      if (decision.kind === 'confirm-replacement' && decision.seat === 0 && mimicOid !== undefined) {
        const wanted = accept ? 'Apply the replacement' : 'Decline the replacement';
        const choice = decision.options.find((option) => option.text === wanted);
        expect(choice, trace.at(-1)).toBeDefined();
        if (!inventedRejected) {
          await expect(session.submit('confirm-replacement-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        move = choice!.id;
        confirmed = true;
      } else if (decision.kind === 'entity-selection' && decision.seat === 0 && accept) {
        const offeredOids = decision.options.flatMap((option) => option.targets.map((target) => target.oid));
        expect(offeredOids, trace.at(-1)).toContain(localWallOid);
        expect(offeredOids, trace.at(-1)).not.toContain(opposingWallOid);
        const wall = decision.options.find((option) => option.targets[0]?.oid === localWallOid);
        expect(wall, trace.at(-1)).toBeDefined();
        const staleSession = session;
        move = wall!.id;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        await expect(staleSession.submit(move)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        selected = true;
        continue;
      } else if (decision.kind === 'priority') {
        const seat = decision.seat;
        const wall = decision.options.find((option) => option.text.startsWith('Wall of Omens:'));
        const mimic = decision.options.find((option) => option.text.startsWith('Glasspool Mimic:'));
        const mimicInHand = pilot.hand?.find((card) => card.name === 'Glasspool Mimic');
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (seat === 0 ? decision.options.find((option) => option.text === 'Play Tundra')?.id : undefined) ??
          (seat === 1 ? decision.options.find((option) => option.text === 'Play Plains')?.id : undefined) ??
          (seat === 0 && localWallCount < 2 && untapped(session, 0, 'Tundra') >= 2 ? wall?.id : undefined) ??
          (seat === 1 && opposingWallOid === undefined && untapped(session, 1, 'Plains') >= 2
            ? wall?.id
            : undefined) ??
          (seat === 0 &&
          localWallCount >= 2 &&
          opposingWallOid !== undefined &&
          mimicOid === undefined &&
          untapped(session, 0, 'Tundra') >= 3
            ? mimic?.id
            : undefined) ??
          routineMove(decision);
        if (mimic !== undefined && move === mimic.id) {
          expect(mimicInHand, trace.at(-1)).toBeDefined();
          mimicOid = mimicInHand!.oid;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Glasspool copy move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(mimicOid, evidence).toMatch(/^forge-card-/u);
    expect(confirmed, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    if (accept) {
      expect(selected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(
        session.view.seats[0]!.battlefield.find((card) => card.oid === mimicOid),
        evidence,
      ).toMatchObject({
        name: 'Wall of Omens',
        power: 0,
        toughness: 4,
      });
      expect(
        session.view.seats[0]!.battlefield.find((card) => card.oid === mimicOid)?.typeLine,
        evidence,
      ).toContain('Shapeshifter');
    } else {
      expect(selected, evidence).toBe(false);
      expect(
        session.view.seats[0]!.graveyard.map((card) => card.oid),
        evidence,
      ).toContain(mimicOid);
    }
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves both Glasspool Mimic replacement outcomes and its controller-only copy domain',
  async () => {
    await proveGlasspoolCopy(false);
    await proveGlasspoolCopy(true);
  },
  480_000,
);

forgeIt(
  'proves Glasspool Shore enters tapped and later pays blue mana',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Glasspool Shore pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-glasspool-shore',
            cards: [
              { name: 'Glasspool Mimic', count: 36 },
              { name: 'Opt', count: 24 },
            ],
          },
        },
        {
          name: 'Glasspool Shore observer',
          controller: 'local',
          deck: { name: 'z5q4-glasspool-shore-observer', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-glasspool-shore-blue-mana',
      maximumTurns: 10,
    };
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let landPlayed = false;
    let observedTappedEntry = false;
    let optCast = false;
    let paidWithShore = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 700; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Glasspool Shore decision');
        const shore = session.view.seats[0]!.battlefield.find((card) => card.name === 'Glasspool Shore');
        observedTappedEntry ||= landPlayed && shore?.tapped === true;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'mana-payment' && optCast) {
          const source = decision.options.find((option) => option.targets[0]?.name === 'Glasspool Shore');
          expect(source, trace.at(-1)).toBeDefined();
          move = source!.id;
          paidWithShore = true;
        } else if (decision.kind === 'priority') {
          const playLand: (typeof decision.options)[number] | undefined =
            decision.seat === 0 && !landPlayed
              ? decision.options.find((option) => option.text === 'Play Glasspool Mimic')
              : undefined;
          const castOpt: (typeof decision.options)[number] | undefined =
            decision.seat === 0 && shore !== undefined && !shore.tapped && !optCast
              ? decision.options.find((option) => option.text.startsWith('Opt:'))
              : undefined;
          move =
            (paidWithShore && session.view.stack.length === 0
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            playLand?.id ??
            (decision.seat === 1
              ? decision.options.find((option) => option.text === 'Play Mountain')?.id
              : undefined) ??
            castOpt?.id ??
            routineMove(decision);
          landPlayed ||= move === playLand?.id;
          optCast ||= move === castOpt?.id;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Glasspool Shore move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(landPlayed, evidence).toBe(true);
      expect(observedTappedEntry, evidence).toBe(true);
      expect(optCast, evidence).toBe(true);
      expect(paidWithShore, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

interface MetamorphRun {
  readonly payment: 'life' | 'blue';
  readonly target: 'creature' | 'artifact';
  readonly cancelFirst: boolean;
}

async function proveMetamorph(run: MetamorphRun): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Metamorph pilot',
        controller: 'local',
        deck: {
          name: `z5q4-metamorph-${run.payment}-${run.target}`,
          cards: [
            { name: 'Tundra', count: 30 },
            { name: 'Wall of Omens', count: 10 },
            { name: 'Phyrexian Metamorph', count: 20 },
          ],
        },
      },
      {
        name: 'Metamorph artifact opponent',
        controller: 'local',
        deck: {
          name: 'z5q4-metamorph-artifact-opponent',
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Coldsteel Heart', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-metamorph-${run.payment}-${run.target}-${run.cancelFirst ? 'cancel' : 'direct'}`,
    maximumTurns: 22,
  };
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let wallOid: string | undefined;
  let heartOid: string | undefined;
  let metamorphOid: string | undefined;
  let castAttempts = 0;
  let paidLife = false;
  let canceled = false;
  let lifeBeforeCancel: number | undefined;
  let selected = false;
  let candidateDomainChecked = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Metamorph decision');
      const pilot = session.view.seats[0]!;
      const opponent = session.view.seats[1]!;
      wallOid ??= pilot.battlefield.find((card) => card.name === 'Wall of Omens')?.oid;
      heartOid ??= opponent.battlefield.find((card) => card.name === 'Coldsteel Heart')?.oid;
      const copied =
        metamorphOid === undefined ? undefined : pilot.battlefield.find((card) => card.oid === metamorphOid);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'mana-payment' && decision.seat === 0 && metamorphOid !== undefined) {
        const life = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
        const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
        if (run.payment === 'life' && !paidLife && life !== undefined) {
          move = life.id;
          paidLife = true;
        } else if (run.cancelFirst && castAttempts === 1 && paidLife && !canceled) {
          expect(cancel, trace.at(-1)).toBeDefined();
          lifeBeforeCancel = pilot.life;
          move = cancel!.id;
          canceled = true;
        } else {
          move = decision.options.find(
            (option) => option.id !== 'mana-payment-cancel' && option.id !== 'mana-payment-phyrexian-life',
          )?.id;
        }
      } else if (decision.kind === 'confirm-replacement' && decision.seat === 0) {
        move = decision.options.find((option) => option.text === 'Apply the replacement')?.id;
      } else if (decision.kind === 'entity-selection' && decision.seat === 0) {
        const offeredOids = decision.options.flatMap((option) => option.targets.map((target) => target.oid));
        expect(offeredOids, trace.at(-1)).toContain(wallOid);
        expect(offeredOids, trace.at(-1)).toContain(heartOid);
        expect(offeredOids, trace.at(-1)).not.toContain(metamorphOid);
        candidateDomainChecked = true;
        const wantedOid = run.target === 'creature' ? wallOid : heartOid;
        const wanted = decision.options.find((option) => option.targets[0]?.oid === wantedOid);
        expect(wanted, trace.at(-1)).toBeDefined();
        move = wanted!.id;
        selected = true;
      } else if (decision.kind === 'color-choice' && decision.seat === 1) {
        move = decision.options.find((option) => option.text.includes('R'))?.id;
      } else if (decision.kind === 'priority') {
        const seat = decision.seat;
        const wall = decision.options.find((option) => option.text.startsWith('Wall of Omens:'));
        const heart = decision.options.find((option) => option.text.startsWith('Coldsteel Heart:'));
        const metamorph = decision.options.find((option) => option.text.startsWith('Phyrexian Metamorph:'));
        const metamorphInHand = pilot.hand?.find((card) => card.name === 'Phyrexian Metamorph');
        move =
          (copied !== undefined
            ? decision.options.find((option) => option.text === 'Concede')?.id
            : undefined) ??
          (seat === 0 ? decision.options.find((option) => option.text === 'Play Tundra')?.id : undefined) ??
          (seat === 1 ? decision.options.find((option) => option.text === 'Play Mountain')?.id : undefined) ??
          (seat === 0 && wallOid === undefined && untapped(session, 0, 'Tundra') >= 2
            ? wall?.id
            : undefined) ??
          (seat === 1 && heartOid === undefined && untapped(session, 1, 'Mountain') >= 2
            ? heart?.id
            : undefined) ??
          (seat === 0 &&
          wallOid !== undefined &&
          heartOid !== undefined &&
          (run.payment === 'life'
            ? untapped(session, 0, 'Tundra') >= 3
            : untapped(session, 0, 'Tundra') >= 4) &&
          (castAttempts === 0 || (canceled && castAttempts === 1))
            ? metamorph?.id
            : undefined) ??
          routineMove(decision);
        if (metamorph !== undefined && move === metamorph.id) {
          expect(metamorphInHand, trace.at(-1)).toBeDefined();
          metamorphOid = metamorphInHand!.oid;
          castAttempts += 1;
          if (castAttempts > 1) paidLife = false;
        }
      } else {
        move = routineMove(decision);
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Metamorph move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
      if (move === 'mana-payment-cancel') {
        const restored = session.view.seats[0]!;
        expect(restored.life, trace.at(-1)).toBe(lifeBeforeCancel);
        expect(
          restored.hand?.some((card) => card.oid === metamorphOid),
          trace.at(-1),
        ).toBe(true);
        expect(
          session.view.stack.some((card) => card.oid === metamorphOid),
          trace.at(-1),
        ).toBe(false);
      }
    }
    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    const copied = session.view.seats[0]!.battlefield.find((card) => card.oid === metamorphOid);
    expect(castAttempts, evidence).toBe(run.cancelFirst ? 2 : 1);
    expect(canceled, evidence).toBe(run.cancelFirst);
    expect(candidateDomainChecked, evidence).toBe(true);
    expect(selected, evidence).toBe(true);
    expect(copied?.name, evidence).toBe(run.target === 'creature' ? 'Wall of Omens' : 'Coldsteel Heart');
    expect(copied?.typeLine, evidence).toContain('Artifact');
    expect(session.view.seats[0]!.life, evidence).toBe(run.payment === 'life' ? 18 : 20);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves Metamorph cancel rollback, life and blue payments, and creature and artifact copy domains',
  async () => {
    await proveMetamorph({ payment: 'life', target: 'creature', cancelFirst: true });
    await proveMetamorph({ payment: 'blue', target: 'artifact', cancelFirst: false });
  },
  600_000,
);
