/** Installed-Forge outcomes for Kalitas's exact replacement and sacrifice route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Kalitas pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-kalitas-outcomes',
          cards: [
            { name: 'Mana Confluence', count: 30 },
            { name: 'Kalitas, Traitor of Ghet', count: 10 },
            { name: 'Bloodghast', count: 10 },
            { name: 'Doom Blade', count: 10 },
          ],
        },
      },
      {
        name: 'Kalitas opposing objects',
        controller: 'local',
        deck: {
          name: 'z5q4-kalitas-opposing-objects',
          cards: [
            { name: 'Plains', count: 40 },
            { name: 'Blade Splicer', count: 20 },
          ],
        },
      },
    ],
    seed: 'z5q4-kalitas-installed-forge',
    maximumTurns: 30,
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
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function plusOneCounters(card: ObservedSession['view']['seats'][number]['battlefield'][number]): number {
  return Object.entries(card.counters)
    .filter(([kind]) => kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1'))
    .reduce((sum, [, count]) => sum + count, 0);
}

forgeIt(
  'Kalitas replaces only opposing nontoken deaths and pays its exact sacrifice cost through the human seat',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let splicerOid: string | undefined;
    let golemOid: string | undefined;
    let bloodghastOid: string | undefined;
    let kalitasOid: string | undefined;
    let firstDoomPending = false;
    let firstReplacementObserved = false;
    let replacementZombieOid: string | undefined;
    let activationPending = false;
    let canceled = false;
    let rollbackObserved = false;
    let canceledManaFloated = false;
    let inventedRejected = false;
    let staleRejected = false;
    let activationResolved = false;
    let secondDoomPending = false;
    let opposingTokenDiedNormally = false;
    let beforeActivation:
      | {
          readonly battlefield: ReadonlySet<string>;
          readonly hand: ReadonlySet<string>;
          readonly graveyard: ReadonlySet<string>;
          readonly exile: ReadonlySet<string>;
          readonly stack: number;
        }
      | undefined;

    try {
      const spec = table();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Kalitas decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a Kalitas test hand');
        const kalitas = pilot.battlefield.find((card) => card.name === 'Kalitas, Traitor of Ghet');
        const bloodghast = pilot.battlefield.find((card) => card.name === 'Bloodghast');
        const splicer = opponent.battlefield.find((card) => card.name === 'Blade Splicer');
        const golem = opponent.battlefield.find(
          (card) => card.typeLine.includes('Golem') && card.oid !== splicer?.oid,
        );
        const localZombies = pilot.battlefield.filter((card) => card.typeLine.includes('Zombie'));
        kalitasOid ??= kalitas?.oid;
        bloodghastOid ??= bloodghast?.oid;
        splicerOid ??= splicer?.oid;
        golemOid ??= golem?.oid;
        if (
          !firstReplacementObserved &&
          splicerOid !== undefined &&
          opponent.exile.some((card) => card.oid === splicerOid) &&
          localZombies.length === 1
        ) {
          firstReplacementObserved = true;
          replacementZombieOid = localZombies[0]?.oid;
        }
        if (canceled && !rollbackObserved && beforeActivation !== undefined) {
          rollbackObserved =
            pilot.battlefield.every((card) => beforeActivation!.battlefield.has(card.oid)) &&
            beforeActivation.battlefield.size === pilot.battlefield.length &&
            pilot.hand.every((card) => beforeActivation!.hand.has(card.oid)) &&
            beforeActivation.hand.size === pilot.hand.length &&
            pilot.graveyard.every((card) => beforeActivation!.graveyard.has(card.oid)) &&
            beforeActivation.graveyard.size === pilot.graveyard.length &&
            pilot.exile.every((card) => beforeActivation!.exile.has(card.oid)) &&
            beforeActivation.exile.size === pilot.exile.length &&
            session.view.stack.length === beforeActivation.stack;
        }
        if (
          canceled &&
          !staleRejected &&
          decision.kind === 'mana-payment' &&
          decision.options.some((option) => option.id.startsWith('mana-pool-'))
        ) {
          canceledManaFloated = true;
        }
        if (
          bloodghastOid !== undefined &&
          kalitas !== undefined &&
          pilot.graveyard.some((card) => card.oid === bloodghastOid) &&
          plusOneCounters(kalitas) === 2 &&
          session.view.stack.length === 0
        ) {
          activationResolved = true;
        }
        if (
          secondDoomPending &&
          golemOid !== undefined &&
          !opponent.battlefield.some((card) => card.oid === golemOid) &&
          !opponent.exile.some((card) => card.oid === golemOid) &&
          replacementZombieOid !== undefined &&
          pilot.battlefield.filter((card) => card.typeLine.includes('Zombie')).length === 1 &&
          session.view.stack.length === 0
        ) {
          opposingTokenDiedNormally = true;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection' && decision.seat === 0) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(new Set(candidates.map((option) => option.targets[0]?.oid)), trace.at(-1)).toEqual(
            new Set([bloodghastOid, replacementZombieOid]),
          );
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
            activationPending = false;
          } else {
            const selected = candidates.find((option) => option.targets[0]?.oid === bloodghastOid);
            if (selected === undefined) throw new Error('Forge omitted Bloodghast from the Kalitas cost');
            const stale = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(stale.submit(selected.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'target-selection' && decision.seat === 0) {
          const targetOid = secondDoomPending ? golemOid : splicerOid;
          const target = decision.options.find((option) => option.targets[0]?.oid === targetOid);
          if (target === undefined) throw new Error(`Forge omitted Doom Blade target ${String(targetOid)}`);
          move = target.id;
        } else if (decision.kind === 'priority') {
          const pilotLands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const opponentLands = opponent.battlefield.filter((card) => card.name === 'Plains').length;
          const doom = decision.options.find((option) => option.text.startsWith('Doom Blade:'));
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Kalitas, Traitor of Ghet:') &&
              option.text.includes('Put two +1/+1 counters'),
          );
          move =
            (opposingTokenDiedNormally
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && splicer === undefined && opponentLands >= 3
              ? decision.options.find((option) => option.text.startsWith('Blade Splicer:'))?.id
              : undefined) ??
            (decision.seat === 0 && bloodghast === undefined && bloodghastOid === undefined && pilotLands >= 2
              ? decision.options.find((option) => option.text.startsWith('Bloodghast:'))?.id
              : undefined) ??
            (decision.seat === 0 && kalitas === undefined && pilotLands >= 4
              ? decision.options.find((option) => option.text.startsWith('Kalitas, Traitor of Ghet:'))?.id
              : undefined) ??
            (decision.seat === 0 &&
            kalitas !== undefined &&
            splicer !== undefined &&
            golem !== undefined &&
            !firstDoomPending
              ? doom?.id
              : undefined) ??
            (decision.seat === 0 && firstReplacementObserved && !activationResolved && !activationPending
              ? activate?.id
              : undefined) ??
            (decision.seat === 0 && activationResolved && golem !== undefined && !secondDoomPending
              ? doom?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === doom?.id) {
            if (firstReplacementObserved) secondDoomPending = true;
            else firstDoomPending = true;
          }
          if (move === activate?.id) {
            activationPending = true;
            beforeActivation ??= {
              battlefield: new Set(pilot.battlefield.map((card) => card.oid)),
              hand: new Set(pilot.hand.map((card) => card.oid)),
              graveyard: new Set(pilot.graveyard.map((card) => card.oid)),
              exile: new Set(pilot.exile.map((card) => card.oid)),
              stack: session.view.stack.length,
            };
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Kalitas move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(splicerOid, evidence).toMatch(/^forge-card-/u);
      expect(golemOid, evidence).toMatch(/^forge-card-/u);
      expect(kalitasOid, evidence).toMatch(/^forge-card-/u);
      expect(bloodghastOid, evidence).toMatch(/^forge-card-/u);
      expect(firstReplacementObserved, evidence).toBe(true);
      expect(replacementZombieOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(canceledManaFloated, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(activationResolved, evidence).toBe(true);
      expect(opposingTokenDiedNormally, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);
