/** Installed-Forge proof for Priest of Fell Rites' two exact graveyard routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Priest pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-priest-of-fell-rites-outcomes',
        cards: [
          { name: 'Mana Confluence', count: 36 },
          { name: 'Selfless Spirit', count: 12 },
          { name: 'Priest of Fell Rites', count: 12 },
        ],
      },
    },
    {
      name: 'Priest observer',
      controller: 'local',
      deck: { name: 'z5q4-priest-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-priest-of-fell-rites-exact-outcomes',
  maximumTurns: 40,
};

function publicPosition(view: TableView): unknown {
  return {
    turn: view.turn,
    priority: view.priority,
    stack: view.stack,
    seats: view.seats.map((seat) => ({
      life: seat.life,
      hand: seat.hand,
      handSize: seat.handSize,
      librarySize: seat.librarySize,
      graveyard: seat.graveyard,
      exile: seat.exile,
      battlefield: seat.battlefield,
    })),
  };
}

function abilityMoveFrom(oid: string): string {
  return `ability-${oid.replace(/^forge-card-/u, '')}-`;
}

forgeIt(
  'rolls target cancellation back, pays the fixed activation, then Unearths with haste and exile',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let spiritOid: string | null = null;
    let priestOid: string | null = null;
    let spiritSacrificed = false;
    let pendingActivation: 'cancel' | 'resolve' | null = null;
    let beforeCanceledActivation: unknown = null;
    let cancellationRolledBack = false;
    let lifeBeforeReanimate: number | null = null;
    let targetInventedRejected = false;
    let targetStaleRejected = false;
    let reanimateResolved = false;
    let reanimateTurn: number | null = null;
    let sorceryAbsenceObserved = false;
    let unearthSubmitted = false;
    let unearthActionInventedRejected = false;
    let unearthActionStaleRejected = false;
    let unearthManaPayments = 0;
    const unearthManaSources = new Set<string>();
    let unearthTurn: number | null = null;
    let unearthResolved = false;
    let hastyAttackOffered = false;
    let hastyAttackCommitted = false;
    let hastyAttackDamageObserved = false;
    let unearthExileObserved = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Priest of Fell Rites decision');
        const pilot = session.view.seats[0];
        if (pilot.hand === null) throw new Error('Forge hid the local seat hand');
        spiritOid ??=
          pilot.battlefield.find((card) => card.name === 'Selfless Spirit')?.oid ??
          pilot.graveyard.find((card) => card.name === 'Selfless Spirit')?.oid ??
          null;
        priestOid ??= pilot.battlefield.find((card) => card.name === 'Priest of Fell Rites')?.oid ?? null;
        if (
          !reanimateResolved &&
          lifeBeforeReanimate !== null &&
          spiritOid !== null &&
          priestOid !== null &&
          pilot.life === lifeBeforeReanimate - 3 &&
          pilot.battlefield.some((card) => card.oid === spiritOid) &&
          pilot.graveyard.some((card) => card.oid === priestOid) &&
          session.view.stack.length === 0
        ) {
          reanimateResolved = true;
          reanimateTurn = session.view.turn.number;
        }
        unearthResolved ||=
          unearthSubmitted &&
          priestOid !== null &&
          pilot.battlefield.some((card) => card.oid === priestOid) &&
          session.view.stack.length === 0;
        unearthExileObserved ||=
          unearthResolved &&
          priestOid !== null &&
          pilot.exile.some((card) => card.oid === priestOid) &&
          !pilot.battlefield.some((card) => card.oid === priestOid) &&
          !pilot.graveyard.some((card) => card.oid === priestOid);
        hastyAttackDamageObserved ||= hastyAttackCommitted && session.view.seats[1]!.life === 18;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} active=${String(session.view.turn.active)} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;

        if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          move = source?.id ?? decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          if (unearthSubmitted && !unearthResolved && source !== undefined && move === source.id) {
            unearthManaPayments += 1;
            const oid = source.targets[0]?.oid;
            if (oid === undefined) throw new Error('Forge exposed a mana source without an object');
            unearthManaSources.add(oid);
          }
        } else if (decision.kind === 'target-selection') {
          if (pendingActivation === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThan(0);
          expect(
            candidates.every((option) =>
              pilot.graveyard.some(
                (card) => card.oid === option.targets[0]?.oid && card.typeLine.includes('Creature'),
              ),
            ),
          ).toBe(true);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          targetInventedRejected = true;
          if (pendingActivation === 'cancel') {
            move = decision.options.find((option) => option.id === 'target-cancel')?.id;
            if (move === undefined) throw new Error('Forge offered no target cancellation');
          } else {
            const selected = candidates.find((option) => option.targets[0]?.oid === spiritOid);
            if (selected === undefined) throw new Error('Forge offered no exact Selfless Spirit target');
            move = selected.id;
            staleSession = session;
            staleMove = move;
          }
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) =>
              ['Mana Confluence', 'Mountain'].includes(option.targets[0]?.name ?? ''),
            )?.id;
        } else if (decision.kind === 'combat-attackers') {
          const addPriest = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              priestOid !== null &&
              option.targets[0]?.oid === priestOid,
          );
          if (unearthResolved && !hastyAttackOffered && addPriest !== undefined) {
            expect(session.view.turn.number).toBe(unearthTurn);
            hastyAttackOffered = true;
            move = addPriest.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            hastyAttackCommitted ||= hastyAttackOffered && move !== undefined;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence');
          const untappedLands = lands.filter((card) => !card.tapped).length;
          const spirit = pilot.battlefield.find((card) => card.name === 'Selfless Spirit');
          const priest = pilot.battlefield.find((card) => card.name === 'Priest of Fell Rites');
          const sacrificeSpirit = decision.options.find(
            (option) => option.text.startsWith('Selfless Spirit:') && option.text.includes('indestructible'),
          );
          const castSpirit = decision.options.find((option) => option.text.startsWith('Selfless Spirit:'));
          const castPriest = decision.options.find((option) =>
            option.text.startsWith('Priest of Fell Rites:'),
          );
          const reanimate = decision.options.find(
            (option) =>
              option.text.startsWith('Priest of Fell Rites:') &&
              option.text.includes('Return target creature card'),
          );
          const unearth = decision.options.find(
            (option) =>
              option.text.startsWith('Priest of Fell Rites:') &&
              option.text.includes('Unearth') &&
              priestOid !== null &&
              option.id.startsWith(abilityMoveFrom(priestOid)),
          );
          for (const exactAction of [reanimate, unearth]) {
            if (exactAction === undefined) continue;
            expect(decision.seat).toBe(0);
            expect(session.view.turn.active).toBe(0);
            expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
            expect(session.view.stack).toEqual([]);
          }
          if (
            reanimateResolved &&
            !unearthSubmitted &&
            !(
              decision.seat === 0 &&
              session.view.turn.active === 0 &&
              (session.view.turn.step === 'MAIN1' || session.view.turn.step === 'MAIN2') &&
              session.view.stack.length === 0
            )
          ) {
            expect(unearth).toBeUndefined();
            sorceryAbsenceObserved = true;
          }

          move =
            (unearthExileObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (!spiritSacrificed && spirit === undefined && untappedLands >= 2 ? castSpirit?.id : undefined) ??
            (!spiritSacrificed && spirit !== undefined ? sacrificeSpirit?.id : undefined) ??
            (spiritSacrificed && priestOid === null && priest === undefined && untappedLands >= 2
              ? castPriest?.id
              : undefined) ??
            (!cancellationRolledBack && reanimate !== undefined ? reanimate.id : undefined) ??
            (cancellationRolledBack &&
            !reanimateResolved &&
            pendingActivation === null &&
            reanimate !== undefined
              ? reanimate.id
              : undefined) ??
            (reanimateResolved &&
            sorceryAbsenceObserved &&
            !unearthSubmitted &&
            unearth !== undefined &&
            reanimateTurn !== null &&
            session.view.turn.step === 'MAIN1' &&
            session.view.turn.number > reanimateTurn &&
            untappedLands >= 5
              ? unearth.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;

          if (!spiritSacrificed && sacrificeSpirit !== undefined && move === sacrificeSpirit.id) {
            spiritSacrificed = true;
          }
          if (reanimate !== undefined && move === reanimate.id) {
            pendingActivation = cancellationRolledBack ? 'resolve' : 'cancel';
            if (pendingActivation === 'cancel') beforeCanceledActivation = publicPosition(session.view);
            else lifeBeforeReanimate = pilot.life;
          }
          if (unearth !== undefined && move === unearth.id) {
            await expect(session.submit('priority-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            unearthActionInventedRejected = true;
            unearthSubmitted = true;
            unearthTurn = session.view.turn.number;
            staleSession = session;
            staleMove = move;
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Priest of Fell Rites move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (pendingActivation === 'cancel' && move === 'target-cancel') {
          expect(publicPosition(session.view)).toEqual(beforeCanceledActivation);
          cancellationRolledBack = true;
          pendingActivation = null;
        } else if (pendingActivation === 'resolve' && move.startsWith('target-')) {
          pendingActivation = null;
        }
        if (staleSession !== null && staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleMove.startsWith('target-')) targetStaleRejected = true;
          else unearthActionStaleRejected = true;
        }
      }

      const evidence = `${trace.slice(-620).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(spiritOid, evidence).toMatch(/^forge-card-/u);
      expect(priestOid, evidence).toMatch(/^forge-card-/u);
      expect(cancellationRolledBack, evidence).toBe(true);
      expect(targetInventedRejected, evidence).toBe(true);
      expect(targetStaleRejected, evidence).toBe(true);
      expect(reanimateResolved, evidence).toBe(true);
      expect(sorceryAbsenceObserved, evidence).toBe(true);
      expect(unearthActionInventedRejected, evidence).toBe(true);
      expect(unearthActionStaleRejected, evidence).toBe(true);
      expect(unearthManaPayments, evidence).toBe(5);
      expect(unearthManaSources.size, evidence).toBe(5);
      expect(unearthResolved, evidence).toBe(true);
      expect(hastyAttackOffered, evidence).toBe(true);
      expect(hastyAttackCommitted, evidence).toBe(true);
      expect(hastyAttackDamageObserved, evidence).toBe(true);
      expect(unearthExileObserved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-620).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);
