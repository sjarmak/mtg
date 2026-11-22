/** Installed-Forge outcomes for the exact Starnheim Unleashed and Alrund's Epiphany Foretell cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function tableFor(name: 'Starnheim Unleashed' | "Alrund's Epiphany", seed: string): SessionSpec {
  const land = name === "Alrund's Epiphany" ? 'Island' : 'Plains';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${name} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${seed}`,
          cards: [
            { name: land, count: 36 },
            { name, count: 24 },
          ],
        },
      },
      {
        name: 'Quiet pilot',
        controller: 'engine',
        deck: { name: `z5q4-${seed}-quiet`, cards: [{ name: 'Plains', count: 60 }] },
      },
    ],
    seed: `z5q4-${seed}-installed-forge`,
    maximumTurns: 24,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'discard-selection') {
    return (
      decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
      decision.options.find((option) =>
        option.targets.some((target) => target.name === 'Plains' || target.name === 'Island'),
      )?.id ??
      decision.options.find((option) => option.targets.length === 1)?.id
    );
  }
  if (decision.kind === 'combat-attackers') {
    return decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
  }
  if (decision.kind === 'combat-blockers') {
    return decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' || option.text === 'Keep this hand' || option.text === 'Pass priority',
  )?.id;
}

function abilitySourceOid(moveId: string): string {
  const match = /^ability-(\d+)-\d+$/u.exec(moveId);
  if (match?.[1] === undefined) throw new Error(`priority move does not identify its source: ${moveId}`);
  return `forge-card-${match[1]}`;
}

function traceLine(session: ObservedSession, decision: ObservedDecision): string {
  return `${session.view.turn.number}/${session.view.turn.step} active=${String(session.view.turn.active)} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

forgeIt(
  'casts Starnheim normally for one exact Angel Warrior',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let cast = false;
    let payments = 0;
    const trace: string[] = [];
    try {
      const table = tableFor('Starnheim Unleashed', 'starnheim-normal');
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no ordinary Starnheim decision');
        const pilot = session.view.seats[0];
        const angels = pilot.battlefield.filter((card) => card.name === 'Angel Warrior Token');
        const resolved =
          sourceOid !== undefined &&
          angels.length === 1 &&
          pilot.graveyard.some((card) => card.oid === sourceOid) &&
          session.view.stack.every((card) => card.oid !== sourceOid);
        trace.push(traceLine(session, decision));

        let move = routineMove(decision);
        if (decision.kind === 'mana-payment') {
          payments += 1;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Plains');
          const untapped = lands.filter((card) => !card.tapped).length;
          const ordinary = decision.options.find(
            (option) =>
              option.text.startsWith('Starnheim Unleashed:') &&
              option.text.includes('Create a 4/4 white Angel Warrior'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!cast && untapped >= 4 ? ordinary?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (!cast && ordinary !== undefined && move === ordinary.id) {
            sourceOid = abilitySourceOid(ordinary.id);
            cast = true;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no ordinary Starnheim move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const angels = session.view.seats[0].battlefield.filter((card) => card.name === 'Angel Warrior Token');
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(payments, evidence).toBe(4);
      expect(angels, evidence).toHaveLength(1);
      expect(angels[0], evidence).toMatchObject({
        typeLine: expect.stringMatching(/Creature.*Angel.*Warrior/u),
        power: 4,
        toughness: 4,
      });
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === sourceOid),
        evidence,
      ).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-220).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  240_000,
);

forgeIt(
  'cancels and then foretells Starnheim for {2}, waits a turn, and casts X=2 for two Angels',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let foretellAttempts = 0;
    let paymentPhase: 'foretell-cancel' | 'foretell' | 'cast' | null = null;
    let cancelPaid = 0;
    let foretellPaid = 0;
    let castPaid = 0;
    let canceled = false;
    let cancellationRestored = false;
    let foretold = false;
    let foretellTurn: number | undefined;
    let sameTurnCastRefused = false;
    let laterCast = false;
    let announcedX = false;
    let inventedRejected = false;
    let staleRejected = false;
    const trace: string[] = [];
    try {
      const table = tableFor('Starnheim Unleashed', 'starnheim-foretell');
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no foretold Starnheim decision');
        const pilot = session.view.seats[0];
        const angels = pilot.battlefield.filter((card) => card.name === 'Angel Warrior Token');
        const resolved =
          laterCast &&
          sourceOid !== undefined &&
          angels.length === 2 &&
          pilot.graveyard.some((card) => card.oid === sourceOid);
        trace.push(traceLine(session, decision));

        let move = routineMove(decision);
        if (decision.kind === 'number' && laterCast) {
          expect(
            decision.options.some((option) => option.id === 'number-2'),
            trace.at(-1),
          ).toBe(true);
          move = 'number-2';
          announcedX = true;
        } else if (decision.kind === 'mana-payment') {
          if (paymentPhase === 'foretell-cancel') {
            if (cancelPaid === 0) {
              move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
              cancelPaid += 1;
            } else {
              move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
              canceled = true;
            }
          } else if (paymentPhase === 'foretell') {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
            foretellPaid += 1;
          } else if (paymentPhase === 'cast') {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
            castPaid += 1;
          }
        } else if (decision.kind === 'priority') {
          const untapped = pilot.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
          const foretell = decision.options.find(
            (option) => option.text.startsWith('Starnheim Unleashed:') && /foretell/iu.test(option.text),
          );
          const sourceNumber = sourceOid?.replace('forge-card-', '');
          const later = decision.options.find(
            (option) => sourceNumber !== undefined && option.id.startsWith(`ability-${sourceNumber}-`),
          );
          if (canceled && !cancellationRestored && sourceOid !== undefined) {
            cancellationRestored =
              pilot.hand?.some((card) => card.oid === sourceOid) === true &&
              pilot.exile.every((card) => card.oid !== sourceOid) &&
              pilot.battlefield.filter((card) => card.name === 'Plains').every((card) => !card.tapped) &&
              session.view.stack.every((card) => card.oid !== sourceOid);
            paymentPhase = null;
          }
          if (!foretold && sourceOid !== undefined && pilot.exile.some((card) => card.oid === sourceOid)) {
            foretold = true;
            foretellTurn = session.view.turn.number;
            paymentPhase = null;
          }
          if (foretold && !laterCast && session.view.turn.number === foretellTurn && decision.seat === 0) {
            expect(later, trace.at(-1)).toBeUndefined();
            sameTurnCastRefused = true;
          }
          if (!inventedRejected && foretell !== undefined && untapped >= 2) {
            await expect(session.submit('ability-invented-foretell')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!foretold && untapped >= 2 && foretell !== undefined ? foretell.id : undefined) ??
            (foretold && !laterCast && session.view.turn.number > (foretellTurn ?? Infinity) && untapped >= 5
              ? later?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (!foretold && foretell !== undefined && move === foretell.id) {
            sourceOid ??= abilitySourceOid(foretell.id);
            foretellAttempts += 1;
            paymentPhase = foretellAttempts === 1 ? 'foretell-cancel' : 'foretell';
            if (foretellAttempts === 1) {
              const staleSession = session;
              const staleMove = foretell.id;
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
          }
          if (
            foretold &&
            !laterCast &&
            later !== undefined &&
            move === later.id &&
            session.view.turn.number > (foretellTurn ?? Infinity)
          ) {
            laterCast = true;
            paymentPhase = 'cast';
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no foretold Starnheim move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const angels = session.view.seats[0].battlefield.filter((card) => card.name === 'Angel Warrior Token');
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(foretellAttempts, evidence).toBe(2);
      expect(cancelPaid, evidence).toBe(1);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(foretellPaid, evidence).toBe(2);
      expect(foretold, evidence).toBe(true);
      expect(sameTurnCastRefused, evidence).toBe(true);
      expect(laterCast, evidence).toBe(true);
      expect(announcedX, evidence).toBe(true);
      expect(castPaid, evidence).toBe(5);
      expect(angels, evidence).toHaveLength(2);
      expect(
        angels.every((card) => card.power === 4 && card.toughness === 4),
        evidence,
      ).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === sourceOid),
        evidence,
      ).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
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

forgeIt(
  'foretells Alrund for {2}, then creates two Birds, grants one extra turn, and exiles itself',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sourceOid: string | undefined;
    let paymentPhase: 'foretell' | 'cast' | null = null;
    let foretellPaid = 0;
    let castPaid = 0;
    let foretold = false;
    let foretellTurn: number | undefined;
    let laterCast = false;
    let resolvedTurn: number | undefined;
    const postResolutionTurns: Array<{ number: number; active: number }> = [];
    const trace: string[] = [];
    try {
      const table = tableFor("Alrund's Epiphany", 'alrunds-foretell');
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Alrund's Epiphany decision");
        const pilot = session.view.seats[0];
        const birds = pilot.battlefield.filter((card) => card.name === 'Bird Token');
        const resolved =
          laterCast &&
          sourceOid !== undefined &&
          birds.length === 2 &&
          pilot.exile.some((card) => card.oid === sourceOid) &&
          session.view.stack.every((card) => card.oid !== sourceOid);
        if (resolved && resolvedTurn === undefined) resolvedTurn = session.view.turn.number;
        if (resolvedTurn !== undefined) {
          const observed = { number: session.view.turn.number, active: session.view.turn.active };
          const previous = postResolutionTurns.at(-1);
          if (previous?.number !== observed.number || previous.active !== observed.active) {
            postResolutionTurns.push(observed);
          }
        }
        const resolvedTurnNow = resolvedTurn;
        const extraTurnProven =
          resolvedTurnNow !== undefined &&
          postResolutionTurns.some((turn) => turn.number === resolvedTurnNow + 1 && turn.active === 0) &&
          postResolutionTurns.some((turn) => turn.number === resolvedTurnNow + 2 && turn.active === 1);
        trace.push(traceLine(session, decision));

        let move = routineMove(decision);
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          if (paymentPhase === 'foretell') foretellPaid += 1;
          if (paymentPhase === 'cast') castPaid += 1;
        } else if (decision.kind === 'priority') {
          const untapped = pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length;
          const foretell = decision.options.find(
            (option) => option.text.startsWith("Alrund's Epiphany:") && /foretell/iu.test(option.text),
          );
          const sourceNumber = sourceOid?.replace('forge-card-', '');
          const later = decision.options.find(
            (option) => sourceNumber !== undefined && option.id.startsWith(`ability-${sourceNumber}-`),
          );
          if (!foretold && sourceOid !== undefined && pilot.exile.some((card) => card.oid === sourceOid)) {
            foretold = true;
            foretellTurn = session.view.turn.number;
            paymentPhase = null;
          }
          move =
            (extraTurnProven
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (!foretold && untapped >= 2 ? foretell?.id : undefined) ??
            (foretold && !laterCast && session.view.turn.number > (foretellTurn ?? Infinity) && untapped >= 6
              ? later?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          const selectedForetell = decision.options.find(
            (option) => option.id === move && /foretell/iu.test(option.text),
          );
          if (!foretold && selectedForetell !== undefined) {
            sourceOid ??= abilitySourceOid(selectedForetell.id);
            paymentPhase = 'foretell';
          }
          if (
            foretold &&
            !laterCast &&
            later !== undefined &&
            move === later.id &&
            session.view.turn.number > (foretellTurn ?? Infinity)
          ) {
            laterCast = true;
            paymentPhase = 'cast';
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error("Forge offered no Alrund's Epiphany move");
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nturns=${JSON.stringify(postResolutionTurns)}\nview=${JSON.stringify(session.view)}`;
      const birds = session.view.seats[0].battlefield.filter((card) => card.name === 'Bird Token');
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(foretellPaid, evidence).toBe(2);
      expect(castPaid, evidence).toBe(6);
      expect(birds, evidence).toHaveLength(2);
      expect(
        birds.every((card) => card.power === 1 && card.toughness === 1),
        evidence,
      ).toBe(true);
      expect(
        session.view.seats[0].exile.some((card) => card.oid === sourceOid),
        evidence,
      ).toBe(true);
      expect(resolvedTurn, evidence).toBeDefined();
      expect(
        postResolutionTurns.some((turn) => turn.number === resolvedTurn! + 1 && turn.active === 0),
        evidence,
      ).toBe(true);
      expect(
        postResolutionTurns.some((turn) => turn.number === resolvedTurn! + 2 && turn.active === 1),
        evidence,
      ).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-360).join('\n')}`, { cause });
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
