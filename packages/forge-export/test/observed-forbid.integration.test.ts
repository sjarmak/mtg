/** Installed-Forge outcomes for Forbid's exact ordinary and Buyback routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function spec(route: 'ordinary' | 'buyback'): SessionSpec {
  const seed = `z5q4-forbid-${route}`;
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Spell pilot',
        controller: 'local',
        deck: {
          name: `${seed}-spell`,
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Lightning Bolt', count: 30 },
          ],
        },
      },
      {
        name: 'Forbid pilot',
        controller: 'local',
        deck: {
          name: `${seed}-forbid`,
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Forbid', count: 30 },
          ],
        },
      },
    ],
    seed,
    maximumTurns: 20,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
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

async function run(route: 'ordinary' | 'buyback'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  let boltOid: string | undefined;
  let forbidOid: string | undefined;
  let castAttempts = 0;
  let choseBuyback = 0;
  let declinedBuyback = false;
  let canceled = false;
  let rollbackObserved = false;
  let handBeforeCancel = -1;
  let graveBeforeCancel = -1;
  const discardedOids: string[] = [];
  let staleSnapshot: ObservedSession | undefined;
  let staleMove: string | undefined;
  let outcome = false;
  let lifeBefore = -1;
  const trace: string[] = [];
  try {
    const subject = spec(route);
    expect(await backend.supports(subject)).toEqual([]);
    const opened = await backend.open(subject);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Forbid decision');
      const spellPilot = session.view.seats[0];
      const forbidPilot = session.view.seats[1];
      if (forbidPilot.hand === null) throw new Error('Forge hid the Forbid pilot hand');
      boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid;
      forbidOid ??= session.view.stack.find((card) => card.name === 'Forbid')?.oid;
      if (canceled && !rollbackObserved && decision.kind === 'priority' && decision.seat === 1) {
        rollbackObserved =
          boltOid !== undefined &&
          session.view.stack.some((card) => card.oid === boltOid) &&
          forbidOid !== undefined &&
          forbidPilot.hand.some((card) => card.oid === forbidOid) &&
          forbidPilot.hand.length === handBeforeCancel + 1 &&
          forbidPilot.graveyard.length === graveBeforeCancel &&
          forbidPilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length >= 3;
      }
      const boltInGrave = boltOid !== undefined && spellPilot.graveyard.some((card) => card.oid === boltOid);
      const forbidSettled =
        forbidOid !== undefined &&
        (route === 'ordinary'
          ? forbidPilot.graveyard.some((card) => card.oid === forbidOid)
          : forbidPilot.hand.some((card) => card.oid === forbidOid));
      outcome =
        boltInGrave &&
        forbidSettled &&
        session.view.stack.length === 0 &&
        forbidPilot.life === lifeBefore &&
        (route === 'ordinary' ||
          (discardedOids.length === 2 &&
            discardedOids.every((oid) => forbidPilot.graveyard.some((card) => card.oid === oid))));
      trace.push(
        `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'optional-cost-choice' && decision.prompt.startsWith('Forbid:')) {
        const buyback = decision.options.find((option) => option.text.includes('Buyback'));
        move =
          route === 'buyback'
            ? buyback?.id
            : decision.options.find((option) => option.id.endsWith('-done'))?.id;
        choseBuyback += route === 'buyback' && move === buyback?.id ? 1 : 0;
        declinedBuyback ||= route === 'ordinary' && move?.endsWith('-done') === true;
      } else if (decision.kind === 'cost-discard-selection') {
        const candidates = decision.options.filter((option) => option.targets.length === 1);
        expect(candidates.length).toBeGreaterThanOrEqual(2);
        const handOids = new Set(forbidPilot.hand.map((card) => card.oid));
        expect(candidates.every((option) => handOids.has(option.targets[0]!.oid))).toBe(true);
        if (!canceled) {
          await expect(session.submit('cost-discard-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          handBeforeCancel = forbidPilot.hand.length;
          graveBeforeCancel = forbidPilot.graveyard.length;
          move = decision.options.find((option) => option.id === 'cost-discard-cancel')?.id;
          canceled = move !== undefined;
        } else {
          const selected = candidates.find((option) => !discardedOids.includes(option.targets[0]!.oid));
          if (selected === undefined) throw new Error('Forge offered no new Forbid discard object');
          discardedOids.push(selected.targets[0]!.oid);
          if (discardedOids.length === 1) {
            staleSnapshot = session;
            staleMove = selected.id;
          }
          move = selected.id;
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.id === 'target-player-1' : option.targets[0]?.oid === boltOid,
        )?.id;
      } else if (decision.kind === 'priority') {
        const mountains = spellPilot.battlefield.filter(
          (card) => card.name === 'Mountain' && !card.tapped,
        ).length;
        const islands = forbidPilot.battlefield.filter(
          (card) => card.name === 'Island' && !card.tapped,
        ).length;
        const castBolt =
          decision.seat === 0 && boltOid === undefined && mountains >= 1 && islands >= 3
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castForbid =
          decision.seat === 1 &&
          boltOid !== undefined &&
          session.view.stack.some((card) => card.oid === boltOid) &&
          !session.view.stack.some((card) => card.name === 'Forbid') &&
          (route === 'ordinary' ? castAttempts === 0 : castAttempts < 2)
            ? decision.options.find((option) => option.text.startsWith('Forbid:'))
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : decision.options.find((option) => option.text === 'Play Island')?.id) ??
          castForbid?.id ??
          castBolt?.id;
        if (castBolt !== undefined && move === castBolt.id) lifeBefore = forbidPilot.life;
        if (castForbid !== undefined && move === castForbid.id) {
          const sourceId = /^ability-(\d+)-/u.exec(castForbid.id)?.[1];
          if (sourceId === undefined) throw new Error('Forge omitted the Forbid source identity');
          forbidOid = `forge-card-${sourceId}`;
          castAttempts += 1;
        }
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Forbid move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
      if (staleSnapshot !== undefined && staleMove !== undefined) {
        await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleSnapshot = undefined;
        staleMove = undefined;
      }
    }
    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(boltOid, evidence).toMatch(/^forge-card-/u);
    expect(forbidOid, evidence).toMatch(/^forge-card-/u);
    expect(castAttempts, evidence).toBe(route === 'ordinary' ? 1 : 2);
    expect(outcome, evidence).toBe(true);
    if (route === 'ordinary') {
      expect(declinedBuyback, evidence).toBe(true);
      expect(canceled, evidence).toBe(false);
    } else {
      expect(choseBuyback, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(discardedOids, evidence).toHaveLength(2);
    }
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-360).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

forgeIt(
  'declines Buyback and sends the exact resolved Forbid to graveyard',
  async () => {
    await run('ordinary');
  },
  240_000,
);

forgeIt(
  'cancels and then pays Buyback with two exact hand objects',
  async () => {
    await run('buyback');
  },
  300_000,
);
