/** Installed-Forge outcomes for the exact Pia/Siege-Gang chosen-sacrifice cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function damageSpec(source: 'Pia and Kiran Nalaar' | 'Siege-Gang Commander'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${source} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${source.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`,
          cards: [
            { name: 'Mountain', count: 42 },
            { name: source, count: 18 },
          ],
        },
      },
      {
        name: 'Damage observer',
        controller: 'engine',
        deck: { name: 'z5q4-pia-siege-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-${source}-chosen-sacrifice-outcome`,
    maximumTurns: 24,
  };
}

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
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

function piaSpec(opponent: 'engine' | 'local'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Pia Nalaar pilot',
        controller: 'local',
        deck: {
          name: `z5q4-pia-nalaar-${opponent}`,
          cards: [
            { name: 'Mountain', count: 42 },
            { name: 'Pia Nalaar', count: 18 },
          ],
        },
      },
      {
        name: 'Pia observer',
        controller: opponent,
        deck:
          opponent === 'local'
            ? {
                name: 'z5q4-pia-nalaar-blocker',
                cards: [
                  { name: 'Mountain', count: 30 },
                  { name: 'Goblin Guide', count: 30 },
                ],
              }
            : { name: 'z5q4-pia-nalaar-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-pia-nalaar-${opponent}-outcome`,
    maximumTurns: 40,
  };
}

forgeIt.each([
  ['Pia and Kiran Nalaar', 'Thopter Token', 2, 2],
  ['Siege-Gang Commander', 'Goblin Token', 3, 4],
] as const)(
  '%s creates exact tokens, rolls back cancellation, and sacrifices the selected identity for two damage',
  async (sourceName, tokenName, tokenCount, candidateCount) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourceOid: string | undefined;
    let tokenOids: readonly string[] = [];
    let activationAttempts = 0;
    let canceled = false;
    let rollbackObserved = false;
    let selectedTokenOid: string | undefined;
    let staleRejected = false;
    let completed = false;
    let cancellationBoard: readonly string[] = [];
    let cancellationTappedMountains = 0;
    try {
      const spec = damageSpec(sourceName);
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error(`Forge offered no ${sourceName} decision`);
        const local = session.view.seats[0];
        const source = local.battlefield.find((card) => card.name === sourceName);
        const tokens = local.battlefield.filter((card) => card.name === tokenName);
        sourceOid ??= source?.oid;
        if (tokenOids.length === 0 && tokens.length === tokenCount) {
          tokenOids = tokens.map((card) => card.oid);
          for (const token of tokens) {
            expect(token).toMatchObject({ power: 1, toughness: 1 });
            expect(token.typeLine).toContain(sourceName === 'Siege-Gang Commander' ? 'Goblin' : 'Artifact');
          }
        }
        if (canceled && !rollbackObserved) {
          const boardMatches =
            local.battlefield
              .map((card) => card.oid)
              .sort()
              .join(',') === [...cancellationBoard].sort().join(',');
          const tappedMountains = local.battlefield.filter(
            (card) => card.name === 'Mountain' && card.tapped,
          ).length;
          rollbackObserved =
            boardMatches &&
            tappedMountains === cancellationTappedMountains &&
            session.view.stack.length === 0;
          trace.push(
            `rollback board=${String(boardMatches)} tapped=${tappedMountains}/${cancellationTappedMountains} stack=${session.view.stack.length}`,
          );
        }
        completed =
          selectedTokenOid !== undefined &&
          sourceOid !== undefined &&
          session.view.seats[1].life === 18 &&
          !local.battlefield.some((card) => card.oid === selectedTokenOid) &&
          local.battlefield.some((card) => card.oid === sourceOid) &&
          local.battlefield.filter((card) => tokenOids.includes(card.oid)).length === tokenCount - 1 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).toHaveLength(candidateCount);
          expect(
            candidates.every((option) => {
              const candidateOid = option.targets[0]?.oid;
              const candidate = local.battlefield.find((card) => card.oid === candidateOid);
              return candidate?.typeLine.includes(
                sourceName === 'Siege-Gang Commander' ? 'Goblin' : 'Artifact',
              );
            }),
          ).toBe(true);
          const selected = candidates.find((option) => option.targets[0]?.name === tokenName);
          if (selected === undefined) throw new Error(`Forge offered no ${tokenName} sacrifice`);
          await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
          } else {
            selectedTokenOid = selected.targets[0]!.oid;
            const staleSession = session;
            const staleMove = selected.id;
            const advanced = await session.submit(staleMove);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
        } else if (decision.kind === 'priority') {
          const mountains = local.battlefield.filter((card) => card.name === 'Mountain');
          const untappedMountains = mountains.filter((card) => !card.tapped).length;
          const cast = decision.options.find((option) => option.text.startsWith(`${sourceName}:`));
          const activate = decision.options.find(
            (option) => option.text.startsWith(`${sourceName}:`) && option.text.includes('deals 2 damage'),
          );
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (source === undefined && mountains.length >= (sourceName === 'Siege-Gang Commander' ? 5 : 4)
              ? cast?.id
              : undefined) ??
            (tokenOids.length === tokenCount &&
            untappedMountains >= (sourceName === 'Siege-Gang Commander' ? 2 : 3) &&
            activationAttempts < 2
              ? activate?.id
              : undefined);
          if (activate !== undefined && move === activate.id) {
            if (activationAttempts === 0) {
              cancellationBoard = local.battlefield.map((card) => card.oid);
              cancellationTappedMountains = local.battlefield.filter(
                (card) => card.name === 'Mountain' && card.tapped,
              ).length;
            }
            activationAttempts += 1;
          }
        }

        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error(`Forge offered no ${sourceName} move`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenOids, evidence).toHaveLength(tokenCount);
      expect(activationAttempts, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(selectedTokenOid, evidence).toMatch(/^forge-card-/u);
      expect(staleRejected, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-480).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);

forgeIt(
  'Pia Nalaar creates the exact Thopter and grants its selected artifact creature +1/+0 only this turn',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let piaCastTurn: number | null = null;
    let tokenOid: string | null = null;
    let pumpSelected = false;
    let pumpObserved = false;
    let pumpTurn: number | null = null;
    let expiryObserved = false;
    try {
      const spec = piaSpec('engine');
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Pia Nalaar pump decision');
        const pilot = session.view.seats[0];
        const pia = pilot.battlefield.find((card) => card.name === 'Pia Nalaar');
        const token = pilot.battlefield.find((card) => card.oid === tokenOid);
        if (tokenOid === null) {
          const created = pilot.battlefield.filter((card) => card.name === 'Thopter Token');
          if (created.length === 1) {
            expect(created[0]).toMatchObject({
              name: 'Thopter Token',
              typeLine: 'Artifact Creature - Thopter',
              power: 1,
              toughness: 1,
            });
            tokenOid = created[0]!.oid;
          }
        }
        if (pumpSelected && token?.power === 2 && token.toughness === 1) {
          pumpObserved = true;
          pumpTurn ??= session.view.turn.number;
        }
        expiryObserved ||=
          pumpObserved &&
          pumpTurn !== null &&
          session.view.turn.number > pumpTurn &&
          token?.power === 1 &&
          token.toughness === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          const target = decision.options.find((option) => option.targets[0]?.oid === tokenOid);
          if (target === undefined) throw new Error("Forge omitted Pia Nalaar's exact artifact target");
          expect(
            decision.options
              .filter((option) => option.targets.length === 1)
              .every((option) => {
                const oid = option.targets[0]?.oid;
                return pilot.battlefield.find((card) => card.oid === oid)?.typeLine.includes('Artifact');
              }),
          ).toBe(true);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          pumpSelected = true;
          move = target.id;
        } else if (decision.kind === 'priority') {
          const mountains = pilot.battlefield.filter((card) => card.name === 'Mountain');
          const untappedMountains = mountains.filter((card) => !card.tapped).length;
          const cast = decision.options.find(
            (option) =>
              option.text.startsWith('Pia Nalaar:') &&
              !option.text.includes('gets +1/+0') &&
              !option.text.includes("can't block"),
          );
          const pump = decision.options.find(
            (option) => option.text.startsWith('Pia Nalaar:') && option.text.includes('gets +1/+0'),
          );
          move =
            (expiryObserved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (pia === undefined && mountains.length >= 3 ? cast?.id : undefined) ??
            (!pumpSelected && tokenOid !== null && untappedMountains >= 2 ? pump?.id : undefined);
          if (cast !== undefined && move === cast.id) piaCastTurn = session.view.turn.number;
        }

        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Pia Nalaar pump move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-480).join('\n')}\nstate=${JSON.stringify({ piaCastTurn, tokenOid, pumpSelected, pumpObserved, pumpTurn, expiryObserved })}\nview=${JSON.stringify(session.view)}`;
      expect(piaCastTurn, evidence).not.toBeNull();
      expect(tokenOid, evidence).toMatch(/^forge-card-/u);
      expect(pumpObserved, evidence).toBe(true);
      expect(expiryObserved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-520).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);

forgeIt(
  'Pia Nalaar cancels and pays the exact selected artifact sacrifice, prevents blocking for one turn, then expires',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let piaCastTurn: number | null = null;
    let piaOid: string | null = null;
    let tokenOid: string | null = null;
    let blockerOid: string | null = null;
    let activationAttempts = 0;
    let pendingCannotBlock = false;
    let canceled = false;
    let cancellationPending = false;
    let cancellationBoard: readonly string[] = [];
    let cancellationTappedMountains = 0;
    let rollbackObserved = false;
    let staleRejected = false;
    let restrictionResolved = false;
    let attackRound: 0 | 1 | 2 = 0;
    let attackerAdded = false;
    let restrictionObserved = false;
    let expiryObserved = false;
    try {
      const spec = piaSpec('local');
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Pia Nalaar restriction decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const pia = pilot.battlefield.find((card) => card.name === 'Pia Nalaar');
        const blocker = opponent.battlefield.find((card) => card.name === 'Goblin Guide');
        piaOid ??= pia?.oid ?? null;
        blockerOid ??= blocker?.oid ?? null;
        if (tokenOid === null) {
          tokenOid = pilot.battlefield.find((card) => card.name === 'Thopter Token')?.oid ?? null;
        }
        restrictionResolved ||=
          staleRejected && tokenOid !== null && !pilot.battlefield.some((card) => card.oid === tokenOid);
        if (
          attackRound === 1 &&
          attackerAdded &&
          session.view.turn.step === 'COMBAT_END' &&
          blocker !== undefined &&
          !blocker.tapped &&
          opponent.life === 18
        ) {
          restrictionObserved = true;
          attackerAdded = false;
        }
        if (cancellationPending && decision.kind === 'priority') {
          rollbackObserved =
            pilot.battlefield
              .map((card) => card.oid)
              .sort()
              .join(',') === [...cancellationBoard].sort().join(',') &&
            pilot.battlefield.filter((card) => card.name === 'Mountain' && card.tapped).length ===
              cancellationTappedMountains &&
            session.view.stack.length === 0;
          canceled = true;
          cancellationPending = false;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (!pendingCannotBlock || blockerOid === null) {
            throw new Error(`unexpected Pia Nalaar target decision: ${decision.prompt}`);
          }
          const target = decision.options.find((option) => option.targets[0]?.oid === blockerOid);
          if (target === undefined) throw new Error('Forge omitted the exact opposing creature target');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          move = target.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).toHaveLength(1);
          expect(candidates[0]?.targets[0]?.oid).toBe(tokenOid);
          await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (!canceled && !cancellationPending) {
            const cancel = decision.options.find((option) => option.id === 'cost-sacrifice-cancel');
            if (cancel === undefined) throw new Error('Forge omitted Pia Nalaar cost cancellation');
            cancellationPending = true;
            pendingCannotBlock = false;
            move = cancel.id;
          } else {
            const selected = candidates[0]!;
            const staleSession = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(staleSession.submit(selected.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            pendingCannotBlock = false;
            continue;
          }
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === piaOid,
          );
          if (!attackerAdded && restrictionResolved && add !== undefined) {
            attackRound = restrictionObserved ? 2 : 1;
            attackerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          const blockOffered = decision.options.some(
            (option) => option.id.startsWith('combat-block-add-') && option.targets[0]?.oid === blockerOid,
          );
          if (attackRound === 1) {
            expect(blockOffered).toBe(false);
            restrictionObserved = true;
          } else if (attackRound === 2) {
            expect(blockOffered).toBe(true);
            expiryObserved = true;
          }
          attackerAdded = false;
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const mountains = pilot.battlefield.filter((card) => card.name === 'Mountain');
          const untappedMountains = mountains.filter((card) => !card.tapped).length;
          const opponentMountains = opponent.battlefield.filter((card) => card.name === 'Mountain');
          const castPia = decision.options.find(
            (option) =>
              option.text.startsWith('Pia Nalaar:') &&
              !option.text.includes('gets +1/+0') &&
              !option.text.includes("can't block"),
          );
          const castBlocker = decision.options.find((option) => option.text.startsWith('Goblin Guide:'));
          const cannotBlock = decision.options.find(
            (option) => option.text.startsWith('Pia Nalaar:') && option.text.includes("can't block"),
          );
          move =
            (expiryObserved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (decision.seat === 1 && blocker === undefined && opponentMountains.some((card) => !card.tapped)
              ? castBlocker?.id
              : undefined) ??
            (decision.seat === 0 && pia === undefined && mountains.length >= 3 ? castPia?.id : undefined) ??
            (decision.seat === 0 &&
            piaCastTurn !== null &&
            session.view.turn.number > piaCastTurn &&
            tokenOid !== null &&
            blockerOid !== null &&
            untappedMountains >= 1 &&
            activationAttempts < 2
              ? cannotBlock?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castPia !== undefined && move === castPia.id) piaCastTurn = session.view.turn.number;
          if (cannotBlock !== undefined && move === cannotBlock.id) {
            if (activationAttempts === 0) {
              cancellationBoard = pilot.battlefield.map((card) => card.oid);
              cancellationTappedMountains = pilot.battlefield.filter(
                (card) => card.name === 'Mountain' && card.tapped,
              ).length;
            }
            activationAttempts += 1;
            pendingCannotBlock = true;
          }
        }

        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Pia Nalaar restriction move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-620).join('\n')}\nstate=${JSON.stringify({ piaCastTurn, piaOid, tokenOid, blockerOid, activationAttempts, canceled, rollbackObserved, staleRejected, restrictionResolved, attackRound, restrictionObserved, expiryObserved })}\nview=${JSON.stringify(session.view)}`;
      expect(piaOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenOid, evidence).toMatch(/^forge-card-/u);
      expect(blockerOid, evidence).toMatch(/^forge-card-/u);
      expect(activationAttempts, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(restrictionObserved, evidence).toBe(true);
      expect(expiryObserved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-660).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);
