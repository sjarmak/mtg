/** Installed-Forge outcomes for Goldspan Dragon and Magda's exact Treasure routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type Decision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
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

function line(session: ObservedSession, decision: Decision): string {
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

forgeIt(
  'creates Treasures from both Goldspan triggers and spends one exact granted ability for two red mana',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Goldspan pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-goldspan-exact-treasures',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Goldspan Dragon', count: 14 },
              { name: 'Lightning Bolt', count: 10 },
              { name: 'Lightning Strike', count: 6 },
            ],
          },
        },
        {
          name: 'Goldspan observer',
          controller: 'engine',
          deck: { name: 'goldspan-observer', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-goldspan-trigger-and-double-mana',
      maximumTurns: 24,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let goldspanOid: string | undefined;
    let boltOid: string | undefined;
    let strikeOid: string | undefined;
    let spellTargetTreasure: string | undefined;
    let attackTreasure: string | undefined;
    let attacked = false;
    let grantedManaSelections = 0;
    let inventedRejected = false;
    let staleRejected = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Goldspan decision');
        const local = session.view.seats[0];
        if (local.hand === null) throw new Error('Forge hid the Goldspan pilot hand');
        const goldspan = local.battlefield.find((card) => card.name === 'Goldspan Dragon');
        goldspanOid ??= goldspan?.oid;
        const treasures = local.battlefield.filter((card) => card.name === 'Treasure Token');
        if (boltOid !== undefined && local.graveyard.some((card) => card.oid === boltOid)) {
          spellTargetTreasure ??= treasures[0]?.oid;
        }
        if (attacked && treasures.length >= 2) {
          attackTreasure ??= treasures.find((card) => card.oid !== spellTargetTreasure)?.oid;
        }
        const complete =
          strikeOid !== undefined &&
          local.graveyard.some((card) => card.oid === strikeOid) &&
          spellTargetTreasure !== undefined &&
          attackTreasure !== undefined &&
          grantedManaSelections === 1 &&
          treasures.length === 1 &&
          session.view.seats[1].life === 13 &&
          session.view.stack.length === 0;
        trace.push(line(session, decision));

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          const treasureRed = decision.options
            .filter(
              (option) =>
                option.id.endsWith('-R') && option.targets.some((target) => target.name === 'Treasure Token'),
            )
            .sort((left, right) => right.id.localeCompare(left.id))[0];
          if (strikeOid !== undefined && treasureRed !== undefined && grantedManaSelections === 0) {
            if (!inventedRejected) {
              await expect(session.submit('mana-source-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            const stale = session;
            move = treasureRed.id;
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            grantedManaSelections += 1;
            await expect(stale.submit(move)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
        } else if (decision.kind === 'target-selection') {
          move =
            (strikeOid !== undefined && !local.graveyard.some((card) => card.oid === strikeOid)
              ? decision.options.find((option) => option.id === 'target-player-1')?.id
              : undefined) ??
            (boltOid !== undefined && !local.graveyard.some((card) => card.oid === boltOid)
              ? decision.options.find((option) => option.targets.some((target) => target.oid === goldspanOid))
                  ?.id
              : undefined);
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0) {
          const attack = decision.options.find((option) =>
            option.targets.some((target) => target.oid === goldspanOid),
          );
          move =
            (!attacked ? attack?.id : undefined) ??
            decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          attacked ||= move === attack?.id;
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const castGoldspan = decision.options.find((option) => option.text.startsWith('Goldspan Dragon:'));
          const castBolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const castStrike = decision.options.find((option) => option.text.startsWith('Lightning Strike:'));
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (goldspan === undefined && lands >= 5 ? castGoldspan?.id : undefined) ??
            (goldspan !== undefined && boltOid === undefined ? castBolt?.id : undefined) ??
            (attackTreasure !== undefined && strikeOid === undefined && session.view.turn.step === 'MAIN2'
              ? castStrike?.id
              : undefined);
          if (castBolt !== undefined && move === castBolt.id) {
            boltOid = local.hand.find((card) => card.name === 'Lightning Bolt')?.oid;
          }
          if (castStrike !== undefined && move === castStrike.id) {
            strikeOid = local.hand.find((card) => card.name === 'Lightning Strike')?.oid;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Goldspan move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(goldspanOid, evidence).toMatch(/^forge-card-/u);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(spellTargetTreasure, evidence).toMatch(/^forge-card-/u);
      expect(attacked, evidence).toBe(true);
      expect(attackTreasure, evidence).toMatch(/^forge-card-/u);
      expect(strikeOid, evidence).toMatch(/^forge-card-/u);
      expect(grantedManaSelections, evidence).toBe(1);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(
        session.view.seats[0].battlefield.filter((card) => card.name === 'Treasure Token'),
        evidence,
      ).toHaveLength(1);
      expect(session.view.seats[1].life, evidence).toBe(13);
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
  'rolls Magda payment back, then sacrifices five exact Treasures and finds only an eligible Dragon',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Magda pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-magda-five-treasures',
            cards: [
              { name: 'Mountain', count: 35 },
              { name: 'Magda, Brazen Outlaw', count: 15 },
              { name: 'Goldspan Dragon', count: 10 },
            ],
          },
        },
        {
          name: 'Ragavan observer',
          controller: 'local',
          deck: {
            name: 'z5q4-opposing-treasure',
            cards: [
              { name: 'Mountain', count: 30 },
              { name: 'Ragavan, Nimble Pilferer', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-magda-exact-five-treasure-payment',
      maximumTurns: 30,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let magdaOid: string | undefined;
    let ragavanOid: string | undefined;
    let opposingTreasureOid: string | undefined;
    let activationCount = 0;
    let picksBeforeCancel = 0;
    let canceled = false;
    let rollbackObserved = false;
    const paidTreasures = new Set<string>();
    let inventedRejected = false;
    let duplicateRejected = false;
    let staleRejected = false;
    let foundGoldspanOid: string | undefined;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Magda decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (local.hand === null || opponent.hand === null) throw new Error('Forge hid a local hand');
        magdaOid ??= local.battlefield.find((card) => card.name === 'Magda, Brazen Outlaw')?.oid;
        ragavanOid ??= opponent.battlefield.find((card) => card.name === 'Ragavan, Nimble Pilferer')?.oid;
        opposingTreasureOid ??= opponent.battlefield.find((card) => card.name === 'Treasure Token')?.oid;
        const ownTreasures = local.battlefield.filter((card) => card.name === 'Treasure Token');
        if (canceled && !rollbackObserved) rollbackObserved = ownTreasures.length === 5;
        foundGoldspanOid ??= local.battlefield.find((card) => card.name === 'Goldspan Dragon')?.oid;
        const complete = foundGoldspanOid !== undefined && paidTreasures.size === 5;
        trace.push(line(session, decision));

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.every((option) => option.targets[0]?.name === 'Treasure Token')).toBe(true);
          expect(candidates.some((option) => option.targets[0]?.oid === opposingTreasureOid)).toBe(false);
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          const candidate = candidates[0];
          if (candidate === undefined) throw new Error('Forge offered no Magda Treasure');
          if (!canceled && picksBeforeCancel < 2) {
            move = candidate.id;
            picksBeforeCancel += 1;
          } else if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
          } else {
            const oid = candidate.targets[0]?.oid;
            if (oid === undefined) throw new Error('Magda Treasure choice had no identity');
            if (paidTreasures.size === 0 && !duplicateRejected) {
              const staleChoice = candidate.id;
              const advanced = await session.submit(staleChoice);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              paidTreasures.add(oid);
              await expect(session.submit(staleChoice)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              duplicateRejected = true;
              continue;
            }
            const stale = session;
            move = candidate.id;
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            paidTreasures.add(oid);
            if (!staleRejected) {
              await expect(stale.submit(move)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'zone-card-selection') {
          expect(decision.options.some((option) => option.targets[0]?.name === 'Mountain')).toBe(false);
          const goldspan = decision.options.find((option) => option.targets[0]?.name === 'Goldspan Dragon');
          if (goldspan === undefined) throw new Error('Magda offered no eligible Dragon');
          move = goldspan.id;
        } else if (decision.kind === 'combat-attackers') {
          const attackerOid = decision.seat === 0 ? magdaOid : ragavanOid;
          move =
            decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.some((target) => target.oid === attackerOid),
            )?.id ?? decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const seat = decision.seat;
          const view = seatViewOf(session.view, seat);
          const hand = view.hand;
          if (hand === null) throw new Error('Forge hid the active local hand');
          const landName = seat === 0 ? 'Mountain' : 'Mountain';
          const cast = decision.options.find((option) =>
            option.text.startsWith(seat === 0 ? 'Magda, Brazen Outlaw:' : 'Ragavan, Nimble Pilferer:'),
          );
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Magda, Brazen Outlaw:') && option.text.includes('Search your library'),
          );
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === `Play ${landName}`)?.id ??
            (seat === 0 &&
            magdaOid === undefined &&
            view.battlefield.filter((card) => card.name === 'Mountain').length >= 2
              ? cast?.id
              : undefined) ??
            (seat === 1 &&
            ragavanOid === undefined &&
            view.battlefield.some((card) => card.name === 'Mountain')
              ? cast?.id
              : undefined) ??
            (seat === 0 && ownTreasures.length === 5 && activationCount < 2 ? activate?.id : undefined);
          if (activate !== undefined && move === activate.id) activationCount += 1;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Magda move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-480).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(magdaOid, evidence).toMatch(/^forge-card-/u);
      expect(ragavanOid, evidence).toMatch(/^forge-card-/u);
      expect(opposingTreasureOid, evidence).toMatch(/^forge-card-/u);
      expect(activationCount, evidence).toBe(2);
      expect(picksBeforeCancel, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(paidTreasures.size, evidence).toBe(5);
      expect(inventedRejected, evidence).toBe(true);
      expect(duplicateRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(foundGoldspanOid, evidence).toMatch(/^forge-card-/u);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  480_000,
);
